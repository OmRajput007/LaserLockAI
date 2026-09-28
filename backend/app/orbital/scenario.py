"""
scenario.py
===========
OrbitalScenario: top-level controller for the Orbital Scenario physics layer.

Usage:
    scenario = OrbitalScenario(config)
    for _ in range(n_steps):
        telemetry = scenario.step(dt)

This class:
  - Owns the camera Platform and beacon Platform
  - Owns their motion integrators (CircularOrbitIntegrator or UAVLocalMotion)
  - Calls compute_link() each step
  - Returns OrbitalTelemetry (defined below)

The existing 2000-m local scene (SimulationEngine + TargetManager) is
UNTOUCHED. OrbitalScenario is a standalone module for Part 1.
"""

from __future__ import annotations
import math
from dataclasses import dataclass, field
from typing import Optional, Literal, Dict, Any, List

from backend.app.orbital.constants import (
    EARTH_RADIUS_KM,
    UAV_MAX_ALT_KM,
    ORBIT_MIN_ALT_KM,
    ORBIT_PRESETS,
)
from backend.app.orbital.platform import Platform, Vec3
from backend.app.orbital.orbital_mechanics import (
    CircularOrbitIntegrator,
    UAVLocalMotion,
    make_satellite_integrator,
    validate_satellite_altitude,
)
from backend.app.orbital.link_geometry import LinkConfig, LinkGeometry, compute_link


# ─────────────────────────────────────────────────────────────────────────────
# Telemetry produced each step
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class OrbitalTelemetry:
    """All physics outputs for one simulation tick in Orbital Scenario mode."""

    sim_time_s:   float = 0.0

    # Camera platform state
    camera:       dict  = field(default_factory=dict)

    # Beacon platform state
    beacon:       dict  = field(default_factory=dict)

    # Orbital integrator state (None if UAV)
    camera_orbit: Optional[dict] = None
    beacon_orbit: Optional[dict] = None

    # Link geometry
    link:         dict  = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "sim_time_s":   self.sim_time_s,
            "camera":       self.camera,
            "beacon":       self.beacon,
            "camera_orbit": self.camera_orbit,
            "beacon_orbit": self.beacon_orbit,
            "link":         self.link,
        }


# ─────────────────────────────────────────────────────────────────────────────
# Platform configuration dataclasses (pure Python, no Pydantic dependency here)
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class SatelliteConfig:
    """Configuration for a satellite platform."""
    preset:          str   = "LEO-550"
    altitude_km:     Optional[float] = None   # overrides preset if provided
    inclination_deg: float = 53.0
    phase_deg:       float = 0.0
    raan_deg:        float = 0.0


@dataclass
class UAVConfig:
    """Configuration for a UAV platform."""
    lat_deg:      float = 28.6
    lon_deg:      float = 77.2
    altitude_km:  float = 10.0
    pattern:      str   = "Circular"
    radius_km:    float = 50.0
    speed_km_s:   float = 0.25
    phase_deg:    float = 0.0


@dataclass
class OrbitalScenarioConfig:
    """
    Top-level configuration for an Orbital Scenario run.

    Either platform can be UAV or SATELLITE:
      camera_type: "UAV" | "SATELLITE"
      beacon_type: "UAV" | "SATELLITE"

    Preset "UAV below satellite": camera = SAT LEO-550, beacon = UAV 10 km.

    IMPORTANT: Orbit switching = re-initialisation, NOT live maneuver.
    A real LEO-550 → GEO Hohmann transfer requires ~3.8 km/s delta-v and ~5.3 h.
    This simulator simply reinitialises to the new orbit parameters.
    """
    camera_type:  Literal["UAV", "SATELLITE"] = "SATELLITE"
    beacon_type:  Literal["UAV", "SATELLITE"] = "UAV"

    camera_sat:   SatelliteConfig = field(default_factory=SatelliteConfig)
    camera_uav:   UAVConfig       = field(default_factory=UAVConfig)

    beacon_sat:   SatelliteConfig = field(default_factory=lambda: SatelliteConfig(phase_deg=180.0))
    beacon_uav:   UAVConfig       = field(default_factory=lambda: UAVConfig(altitude_km=10.0))

    link:         LinkConfig      = field(default_factory=LinkConfig)


# ─────────────────────────────────────────────────────────────────────────────
# OrbitalScenario
# ─────────────────────────────────────────────────────────────────────────────

class OrbitalScenario:
    """
    Orchestrates two-platform orbital scenario.

    Public interface:
        __init__(config: OrbitalScenarioConfig)
        step(dt: float) -> OrbitalTelemetry
        reset(config: OrbitalScenarioConfig)
        camera_platform: Platform   (read-only)
        beacon_platform: Platform   (read-only)
    """

    def __init__(self, config: OrbitalScenarioConfig = None):
        if config is None:
            config = OrbitalScenarioConfig()
        self._cfg = config
        self._sim_time: float = 0.0
        self._build(config)

    def _build(self, cfg: OrbitalScenarioConfig) -> None:
        """Constructs platforms and their integrators from config."""
        self._camera_plat = Platform()
        self._beacon_plat = Platform()

        # Camera integrator
        if cfg.camera_type == "SATELLITE":
            self._camera_integ: object = make_satellite_integrator(
                platform        = self._camera_plat,
                preset          = cfg.camera_sat.preset,
                altitude_km     = cfg.camera_sat.altitude_km,
                inclination_deg = cfg.camera_sat.inclination_deg,
                phase_deg       = cfg.camera_sat.phase_deg,
                raan_deg        = cfg.camera_sat.raan_deg,
            )
        else:
            c = cfg.camera_uav
            self._camera_integ = UAVLocalMotion(
                platform     = self._camera_plat,
                lat_deg      = c.lat_deg,
                lon_deg      = c.lon_deg,
                altitude_km  = c.altitude_km,
                pattern      = c.pattern,
                radius_km    = c.radius_km,
                speed_km_s   = c.speed_km_s,
                phase_deg    = c.phase_deg,
            )

        # Beacon integrator
        if cfg.beacon_type == "SATELLITE":
            self._beacon_integ: object = make_satellite_integrator(
                platform        = self._beacon_plat,
                preset          = cfg.beacon_sat.preset,
                altitude_km     = cfg.beacon_sat.altitude_km,
                inclination_deg = cfg.beacon_sat.inclination_deg,
                phase_deg       = cfg.beacon_sat.phase_deg,
                raan_deg        = cfg.beacon_sat.raan_deg,
            )
        else:
            b = cfg.beacon_uav
            self._beacon_integ = UAVLocalMotion(
                platform     = self._beacon_plat,
                lat_deg      = b.lat_deg,
                lon_deg      = b.lon_deg,
                altitude_km  = b.altitude_km,
                pattern      = b.pattern,
                radius_km    = b.radius_km,
                speed_km_s   = b.speed_km_s,
                phase_deg    = b.phase_deg,
            )

    # ── Public API ────────────────────────────────────────────────────────────

    @property
    def camera_platform(self) -> Platform:
        return self._camera_plat

    @property
    def beacon_platform(self) -> Platform:
        return self._beacon_plat

    def step(self, dt: float) -> OrbitalTelemetry:
        """Advances both platforms by dt seconds and returns full telemetry."""
        self._sim_time += dt

        # Advance each platform
        self._camera_integ.step(dt)
        self._beacon_integ.step(dt)

        # Link geometry
        link: LinkGeometry = compute_link(
            self._camera_plat,
            self._beacon_plat,
            self._cfg.link,
        )

        # Orbital integrator state (None if UAV)
        cam_orbit = None
        if isinstance(self._camera_integ, CircularOrbitIntegrator):
            cam_orbit = self._camera_integ.to_dict()

        bea_orbit = None
        if isinstance(self._beacon_integ, CircularOrbitIntegrator):
            bea_orbit = self._beacon_integ.to_dict()

        return OrbitalTelemetry(
            sim_time_s   = self._sim_time,
            camera       = self._camera_plat.to_dict(),
            beacon       = self._beacon_plat.to_dict(),
            camera_orbit = cam_orbit,
            beacon_orbit = bea_orbit,
            link         = {
                "range_km":             round(link.range_km, 3),
                "az_body_deg":          round(link.az_body_deg, 4),
                "el_body_deg":          round(link.el_body_deg, 4),
                "link_state":           link.link_state,
                "angular_rate_deg_s":   round(link.angular_rate_deg_s, 6),
                "intensity_fraction":   round(link.intensity_fraction, 6),
                "atmosphere_path_frac": round(link.atmosphere_path_frac, 4),
                "min_los_clearance_km": round(link.min_los_clearance_km, 3),
                "relative_speed_km_s":  round(link.relative_speed_km_s, 4),
                "is_in_fov":            abs(link.az_body_deg) <= 2.0 and abs(link.el_body_deg) <= 1.5,
            },
        )

    def reset(self, config: OrbitalScenarioConfig = None) -> None:
        """Re-initialises scenario (orbit switch = re-init, NOT live maneuver)."""
        self._sim_time = 0.0
        if config is not None:
            self._cfg = config
        self._build(self._cfg)
