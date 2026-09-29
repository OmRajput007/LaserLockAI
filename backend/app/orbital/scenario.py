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
  - Optionally owns a SECOND satellite for handover (backup satellite)
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
    KeplerianOrbitIntegrator,
    CircularOrbitIntegrator,
    UAVLocalMotion,
    make_satellite_integrator,
    validate_satellite_altitude,
)
from backend.app.orbital.link_geometry import LinkConfig, LinkGeometry, compute_link
from backend.app.orbital.handover import (
    HandoverManager,
    HandoverConfig,
    HandoverTelemetry,
)


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

    # Handover (None when handover is not enabled)
    handover:     Optional[dict] = None

    # Second satellite (backup) state — None when not in handover mode
    backup_camera:       Optional[dict] = None
    backup_camera_orbit: Optional[dict] = None

    def to_dict(self) -> dict:
        return {
            "sim_time_s":         self.sim_time_s,
            "camera":             self.camera,
            "beacon":             self.beacon,
            "camera_orbit":       self.camera_orbit,
            "beacon_orbit":       self.beacon_orbit,
            "link":               self.link,
            "handover":           self.handover,
            "backup_camera":      self.backup_camera,
            "backup_camera_orbit":self.backup_camera_orbit,
        }


# ─────────────────────────────────────────────────────────────────────────────
# Platform configuration dataclasses (pure Python, no Pydantic dependency here)
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class SatelliteConfig:
    """Configuration for a satellite platform with full Keplerian elements."""
    preset:           str             = "LEO-550"
    altitude_km:      Optional[float] = None   # legacy circular alias
    perigee_alt_km:   Optional[float] = None
    apogee_alt_km:    Optional[float] = None
    inclination_deg:  float           = 53.0
    phase_deg:        float           = 0.0   # alias for true_anomaly_deg
    raan_deg:         float           = 0.0
    arg_perigee_deg:  float           = 0.0
    true_anomaly_deg: float           = 0.0


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

    Handover:
      enable_handover: if True, a backup satellite is added on the same orbit,
      offset by handover_config.phase_offset_deg along-track.
    """
    camera_type:  Literal["UAV", "SATELLITE"] = "SATELLITE"
    beacon_type:  Literal["UAV", "SATELLITE"] = "UAV"

    camera_sat:   SatelliteConfig = field(default_factory=SatelliteConfig)
    camera_uav:   UAVConfig       = field(default_factory=UAVConfig)

    beacon_sat:   SatelliteConfig = field(default_factory=lambda: SatelliteConfig(phase_deg=180.0))
    beacon_uav:   UAVConfig       = field(default_factory=lambda: UAVConfig(altitude_km=10.0))

    link:         LinkConfig      = field(default_factory=LinkConfig)

    # ── Handover additions ────────────────────────────────────────────────────
    enable_handover:  bool          = False
    handover_config:  HandoverConfig = field(default_factory=HandoverConfig)


# ─────────────────────────────────────────────────────────────────────────────
# OrbitalScenario
# ─────────────────────────────────────────────────────────────────────────────

class OrbitalScenario:
    """
    Orchestrates two-platform orbital scenario with optional handover.

    Public interface:
        __init__(config: OrbitalScenarioConfig)
        step(dt: float) -> OrbitalTelemetry
        reset(config: OrbitalScenarioConfig)
        camera_platform: Platform   (read-only) — the *active* satellite
        beacon_platform: Platform   (read-only)
        backup_platform: Optional[Platform]  — the backup satellite (if handover enabled)
        handover_manager: Optional[HandoverManager]
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
        self._backup_plat: Optional[Platform] = None
        self._backup_integ = None
        self._handover_mgr: Optional[HandoverManager] = None
        self._last_handover_telem: Optional[HandoverTelemetry] = None

        # Camera integrator
        if cfg.camera_type == "SATELLITE":
            self._camera_integ: object = make_satellite_integrator(
                platform         = self._camera_plat,
                preset           = cfg.camera_sat.preset,
                perigee_alt_km   = cfg.camera_sat.perigee_alt_km,
                apogee_alt_km    = cfg.camera_sat.apogee_alt_km,
                altitude_km      = cfg.camera_sat.altitude_km,
                inclination_deg  = cfg.camera_sat.inclination_deg,
                raan_deg         = cfg.camera_sat.raan_deg,
                arg_perigee_deg  = cfg.camera_sat.arg_perigee_deg,
                true_anomaly_deg = cfg.camera_sat.true_anomaly_deg if cfg.camera_sat.true_anomaly_deg != 0.0 else cfg.camera_sat.phase_deg,
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
                platform         = self._beacon_plat,
                preset           = cfg.beacon_sat.preset,
                perigee_alt_km   = cfg.beacon_sat.perigee_alt_km,
                apogee_alt_km    = cfg.beacon_sat.apogee_alt_km,
                altitude_km      = cfg.beacon_sat.altitude_km,
                inclination_deg  = cfg.beacon_sat.inclination_deg,
                raan_deg         = cfg.beacon_sat.raan_deg,
                arg_perigee_deg  = cfg.beacon_sat.arg_perigee_deg,
                true_anomaly_deg = cfg.beacon_sat.true_anomaly_deg if cfg.beacon_sat.true_anomaly_deg != 0.0 else cfg.beacon_sat.phase_deg,
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

        # ── Backup satellite for handover ─────────────────────────────────────
        if cfg.enable_handover and cfg.camera_type == "SATELLITE":
            self._backup_plat = Platform()
            # Same orbit, same inclination/RAAN/arg_p, but phase offset by
            # handover_config.phase_offset_deg
            base_ano = (
                cfg.camera_sat.true_anomaly_deg
                if cfg.camera_sat.true_anomaly_deg != 0.0
                else cfg.camera_sat.phase_deg
            )
            backup_phase = (base_ano + cfg.handover_config.phase_offset_deg) % 360.0
            self._backup_integ = make_satellite_integrator(
                platform         = self._backup_plat,
                preset           = cfg.camera_sat.preset,
                perigee_alt_km   = cfg.camera_sat.perigee_alt_km,
                apogee_alt_km    = cfg.camera_sat.apogee_alt_km,
                altitude_km      = cfg.camera_sat.altitude_km,
                inclination_deg  = cfg.camera_sat.inclination_deg,
                raan_deg         = cfg.camera_sat.raan_deg,
                arg_perigee_deg  = cfg.camera_sat.arg_perigee_deg,
                true_anomaly_deg = backup_phase,
            )
            self._handover_mgr = HandoverManager(cfg.handover_config)

    # ── Public API ────────────────────────────────────────────────────────────

    @property
    def camera_platform(self) -> Platform:
        """Returns the *active* satellite platform (may change after handover)."""
        if self._handover_mgr is not None:
            idx = self._handover_mgr.active_index
            return [self._camera_plat, self._backup_plat][idx]
        return self._camera_plat

    @property
    def beacon_platform(self) -> Platform:
        return self._beacon_plat

    @property
    def backup_platform(self) -> Optional[Platform]:
        return self._backup_plat

    @property
    def handover_manager(self) -> Optional[HandoverManager]:
        return self._handover_mgr

    def step(self, dt: float, pat_state: str = "SEARCHING") -> OrbitalTelemetry:
        """
        Advances both platforms by dt seconds and returns full telemetry.

        Parameters
        ----------
        dt        : simulation time step (s)
        pat_state : current PAT state from KalmanTracker (used by handover
                    manager to set the corrected pat_badge / link_state)
        """
        self._sim_time += dt

        # Advance each platform
        self._camera_integ.step(dt)
        self._beacon_integ.step(dt)

        # Advance backup satellite if present
        if self._backup_integ is not None:
            self._backup_integ.step(dt)

        # ── Handover step ─────────────────────────────────────────────────────
        handover_telem: Optional[HandoverTelemetry] = None
        if self._handover_mgr is not None and self._backup_plat is not None:
            handover_telem = self._handover_mgr.step(
                dt            = dt,
                sat_platforms = [self._camera_plat, self._backup_plat],
                beacon_platform = self._beacon_plat,
                current_pat_state = pat_state,
            )
            self._last_handover_telem = handover_telem

        # ── Active satellite is now determined by handover manager ────────────
        active_plat = self.camera_platform   # property handles index selection

        # Link geometry (active satellite → beacon)
        link: LinkGeometry = compute_link(
            active_plat,
            self._beacon_plat,
            self._cfg.link,
        )

        # ── Override link_state from handover manager if available ────────────
        effective_link_state = link.link_state
        if handover_telem is not None:
            effective_link_state = handover_telem.link_state

        # Orbital integrator state (None if UAV)
        cam_orbit = None
        if isinstance(self._camera_integ, (KeplerianOrbitIntegrator, CircularOrbitIntegrator)):
            cam_orbit = self._camera_integ.to_dict()

        bea_orbit = None
        if isinstance(self._beacon_integ, (KeplerianOrbitIntegrator, CircularOrbitIntegrator)):
            bea_orbit = self._beacon_integ.to_dict()

        # Backup orbit state
        backup_camera_dict = None
        backup_orbit_dict  = None
        if self._backup_plat is not None:
            backup_camera_dict = self._backup_plat.to_dict()
        if self._backup_integ is not None and isinstance(self._backup_integ, (KeplerianOrbitIntegrator, CircularOrbitIntegrator)):
            backup_orbit_dict = self._backup_integ.to_dict()

        # is_in_fov uses 2°/1.5° thresholds (camera FOV half-angles)
        is_in_fov = abs(link.az_body_deg) <= 2.0 and abs(link.el_body_deg) <= 1.5

        return OrbitalTelemetry(
            sim_time_s   = self._sim_time,
            camera       = active_plat.to_dict(),
            beacon       = self._beacon_plat.to_dict(),
            camera_orbit = cam_orbit,
            beacon_orbit = bea_orbit,
            link         = {
                "range_km":             round(link.range_km, 3),
                "az_body_deg":          round(link.az_body_deg, 4),
                "el_body_deg":          round(link.el_body_deg, 4),
                "link_state":           effective_link_state,
                "angular_rate_deg_s":   round(link.angular_rate_deg_s, 6),
                "intensity_fraction":   round(link.intensity_fraction, 6),
                "atmosphere_path_frac": round(link.atmosphere_path_frac, 4),
                "min_los_clearance_km": round(link.min_los_clearance_km, 3),
                "relative_speed_km_s":  round(link.relative_speed_km_s, 4),
                "is_in_fov":            is_in_fov,
            },
            handover           = handover_telem.to_dict() if handover_telem is not None else None,
            backup_camera      = backup_camera_dict,
            backup_camera_orbit= backup_orbit_dict,
        )

    def reset(self, config: OrbitalScenarioConfig = None) -> None:
        """Re-initialises scenario (orbit switch = re-init, NOT live maneuver)."""
        self._sim_time = 0.0
        if config is not None:
            self._cfg = config
        self._build(self._cfg)
