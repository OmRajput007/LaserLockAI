"""
orbital_mechanics.py
====================
Motion integrators for the Orbital Scenario layer.

Provides:
  CircularOrbitIntegrator  – satellite on a circular ECI orbit (analytic)
  UAVLocalMotion           – UAV in a local ENU tangent plane, patterns reused
                             from the existing 2000-m scene, then converted to ECI.

ASSUMPTION (v1): Earth is non-rotating (sidereal rotation ignored).
                 Add sidereal rotation in v2 if needed.

Physical constants from constants.py; no other backend modules are modified.
"""

from __future__ import annotations
import math
import random
from typing import Tuple, Optional, Dict, Any, Literal

from backend.app.orbital.constants import (
    GM_KM3_S2, EARTH_RADIUS_KM,
    UAV_MAX_ALT_KM, ORBIT_MIN_ALT_KM,
    ORBIT_PRESETS,
)
from backend.app.orbital.platform import Platform, Vec3


# ─────────────────────────────────────────────────────────────────────────────
# Helper: ECI <-> lat-lon-alt
# ─────────────────────────────────────────────────────────────────────────────

def lla_to_eci(lat_deg: float, lon_deg: float, alt_km: float) -> Vec3:
    """
    Convert geodetic (lat, lon, alt) to ECI (x, y, z) km.
    Earth rotation ignored (v1 assumption): ECEF = ECI at t=0.
    """
    lat = math.radians(lat_deg)
    lon = math.radians(lon_deg)
    r = EARTH_RADIUS_KM + alt_km
    x = r * math.cos(lat) * math.cos(lon)
    y = r * math.cos(lat) * math.sin(lon)
    z = r * math.sin(lat)
    return (x, y, z)


def eci_to_altitude_km(pos: Vec3) -> float:
    x, y, z = pos
    return math.sqrt(x*x + y*y + z*z) - EARTH_RADIUS_KM


def enu_basis(lat_deg: float, lon_deg: float) -> Tuple[Vec3, Vec3, Vec3]:
    """
    Returns East, North, Up unit vectors in ECI at a given surface point.
    (Earth rotation ignored: ECEF ≡ ECI at t=0.)
    """
    lat = math.radians(lat_deg)
    lon = math.radians(lon_deg)
    # Up = radial direction
    up = (math.cos(lat)*math.cos(lon), math.cos(lat)*math.sin(lon), math.sin(lat))
    # East = d(up)/d(lon) normalised
    east = (-math.sin(lon), math.cos(lon), 0.0)
    # North = Up × East (right-hand)
    nx = up[1]*east[2] - up[2]*east[1]
    ny = up[2]*east[0] - up[0]*east[2]
    nz = up[0]*east[1] - up[1]*east[0]
    n_mag = math.sqrt(nx*nx + ny*ny + nz*nz)
    north = (nx/n_mag, ny/n_mag, nz/n_mag)
    return east, north, up


# ─────────────────────────────────────────────────────────────────────────────
# Altitude validation
# ─────────────────────────────────────────────────────────────────────────────

def validate_satellite_altitude(alt_km: float) -> None:
    """
    Raises ValueError if the altitude is in the unstable gap (20–300 km).
    Rule 5 from design spec.
    """
    if UAV_MAX_ALT_KM < alt_km < ORBIT_MIN_ALT_KM:
        raise ValueError(
            f"No stable orbit in the range {UAV_MAX_ALT_KM}–{ORBIT_MIN_ALT_KM} km. "
            f"Requested altitude: {alt_km:.1f} km. "
            f"Use UAV (≤ {UAV_MAX_ALT_KM} km) or orbit (≥ {ORBIT_MIN_ALT_KM} km)."
        )


# ─────────────────────────────────────────────────────────────────────────────
# Circular Orbit Integrator (Satellite)
# ─────────────────────────────────────────────────────────────────────────────

class CircularOrbitIntegrator:
    """
    Analytic propagator for a circular ECI orbit.

    State:
        phase_rad  : current argument of latitude (radians)
        inclination: orbital plane inclination (radians)
        r_km       : orbital radius from Earth centre (km)

    step(dt) updates the Platform passed at construction.

    NOTE: Orbit switching is a re-initialisation, NOT a live transfer.
    A real LEO-550 → GEO transfer costs ~3.8 km/s delta-v and ~5.3 hours.
    This simulator simply reinitialises to the new orbit.
    """

    def __init__(
        self,
        platform: Platform,
        altitude_km: float        = 550.0,
        inclination_deg: float    = 53.0,
        phase_deg: float          = 0.0,
        raan_deg: float           = 0.0,      # right ascension of ascending node
    ):
        validate_satellite_altitude(altitude_km)

        self.platform    = platform
        self.altitude_km = altitude_km
        self.r_km        = EARTH_RADIUS_KM + altitude_km
        self.incl_rad    = math.radians(inclination_deg)
        self.raan_rad    = math.radians(raan_deg)
        self.phase_rad   = math.radians(phase_deg)

        # Circular orbit speed (vis-viva with e=0)
        self.speed_km_s  = math.sqrt(GM_KM3_S2 / self.r_km)

        # Angular velocity (rad/s)
        self.omega_rad_s = math.sqrt(GM_KM3_S2 / self.r_km**3)

        # Orbital period (s)
        self.period_s    = 2.0 * math.pi / self.omega_rad_s

        # Initialise platform
        platform.platform_type = "SATELLITE"
        self._update_platform()

    # ── Orbital basis vectors (inertial) ──────────────────────────────────────

    def _orbit_basis(self) -> Tuple[Vec3, Vec3]:
        """
        Returns (p_hat, q_hat): unit vectors in the orbital plane.
        p_hat points toward ascending node crossing.
        q_hat = normal_hat × p_hat (90° ahead in orbit).

        Using RAAN and inclination to rotate from equatorial plane.
        """
        i   = self.incl_rad
        ra  = self.raan_rad

        # p_hat: direction of ascending node
        px = math.cos(ra)
        py = math.sin(ra)
        pz = 0.0

        # q_hat = (−sin i sin ra, sin i cos ra, cos i) rotated appropriately
        # q_hat = (−sin ra cos i... ) — standard derivation:
        qx = -math.sin(ra) * math.cos(i)
        qy =  math.cos(ra) * math.cos(i)
        qz =  math.sin(i)

        return (px, py, pz), (qx, qy, qz)

    def _update_platform(self) -> None:
        """Recomputes ECI pos/vel from current phase and stores into platform."""
        p_hat, q_hat = self._orbit_basis()
        ph = self.phase_rad

        # Position: r * (cos θ · p̂ + sin θ · q̂)
        cos_ph, sin_ph = math.cos(ph), math.sin(ph)
        x = self.r_km * (cos_ph * p_hat[0] + sin_ph * q_hat[0])
        y = self.r_km * (cos_ph * p_hat[1] + sin_ph * q_hat[1])
        z = self.r_km * (cos_ph * p_hat[2] + sin_ph * q_hat[2])
        self.platform.pos_eci = (x, y, z)

        # Velocity: r·ω * (−sin θ · p̂ + cos θ · q̂)
        v = self.r_km * self.omega_rad_s
        vx = v * (-sin_ph * p_hat[0] + cos_ph * q_hat[0])
        vy = v * (-sin_ph * p_hat[1] + cos_ph * q_hat[1])
        vz = v * (-sin_ph * p_hat[2] + cos_ph * q_hat[2])
        self.platform.vel_eci = (vx, vy, vz)

    def step(self, dt: float) -> None:
        """Advances the orbit by dt seconds (analytic, no numerical drift)."""
        self.phase_rad = (self.phase_rad + self.omega_rad_s * dt) % (2.0 * math.pi)
        self._update_platform()
        self.platform.append_trail()

    # ── Derived quantities for telemetry ──────────────────────────────────────

    @property
    def omega_deg_s(self) -> float:
        return math.degrees(self.omega_rad_s)

    def to_dict(self) -> dict:
        return {
            "altitude_km":     round(self.altitude_km, 3),
            "radius_km":       round(self.r_km, 3),
            "speed_km_s":      round(self.speed_km_s, 6),
            "omega_deg_s":     round(self.omega_deg_s, 6),
            "period_s":        round(self.period_s, 2),
            "inclination_deg": round(math.degrees(self.incl_rad), 3),
            "raan_deg":        round(math.degrees(self.raan_rad), 3),
            "phase_deg":       round(math.degrees(self.phase_rad), 3),
        }


# ─────────────────────────────────────────────────────────────────────────────
# UAV Local Motion (reuses existing pattern names)
# ─────────────────────────────────────────────────────────────────────────────

class UAVLocalMotion:
    """
    Drives a UAV platform using the same motion patterns as the local 2000-m scene
    (Straight Line, Circular, Figure of 8, Random, Spiral, Sinusoidal, Waypoint)
    but in a local ENU tangent plane, then converts to ECI.

    The ENU plane is anchored at (lat, lon, altitude_km).

    Existing motion_generators.py is NOT modified; the patterns are re-implemented
    here in km-scale ENU with the same mathematical formulae.
    """

    def __init__(
        self,
        platform: Platform,
        lat_deg: float           = 28.6,     # deg
        lon_deg: float           = 77.2,     # deg (New Delhi default)
        altitude_km: float       = 10.0,
        pattern: str             = "Circular",
        radius_km: float         = 50.0,     # for Circular pattern
        speed_km_s: float        = 0.25,     # ~250 m/s nominal UAV speed
        phase_deg: float         = 0.0,
    ):
        if altitude_km > UAV_MAX_ALT_KM:
            raise ValueError(
                f"UAV altitude {altitude_km:.1f} km exceeds max {UAV_MAX_ALT_KM} km."
            )

        self.platform    = platform
        self.lat_deg     = lat_deg
        self.lon_deg     = lon_deg
        self.altitude_km = altitude_km
        self.pattern     = pattern
        self.radius_km   = radius_km
        self.speed_km_s  = speed_km_s
        self.t           = 0.0

        # ENU basis vectors (Earth-rotation ignored)
        self.east, self.north, self.up = enu_basis(lat_deg, lon_deg)

        # ECI anchor point
        ax, ay, az = lla_to_eci(lat_deg, lon_deg, altitude_km)
        self.anchor_eci: Vec3 = (ax, ay, az)

        # Local ENU offset (km) — starts at 0
        self.e_km = radius_km * math.cos(math.radians(phase_deg))
        self.n_km = radius_km * math.sin(math.radians(phase_deg))
        self.u_km = 0.0  # UAV stays at fixed altitude above anchor

        # Motion-pattern internal state
        self._vx_local = 0.0   # km/s in E direction
        self._vy_local = 0.0   # km/s in N direction
        self._omega    = speed_km_s / max(radius_km, 0.001)  # rad/s for Circular
        self._angle    = math.radians(phase_deg)

        # Straight Line: random direction
        _dir = random.uniform(0, 2 * math.pi)
        self._sl_vx = speed_km_s * math.cos(_dir)
        self._sl_vy = speed_km_s * math.sin(_dir)

        platform.platform_type = "UAV"
        self._commit()

    def _commit(self) -> None:
        """Write local ENU offset → ECI position into the platform."""
        e, n = self.e_km, self.n_km
        ax, ay, az = self.anchor_eci
        ex, ey, ez = self.east
        nx, ny, nz = self.north
        px = ax + e * ex + n * nx
        py = ay + e * ey + n * ny
        pz = az + e * ez + n * nz
        self.platform.pos_eci = (px, py, pz)

    def step(self, dt: float) -> None:
        self.t += dt
        p = self.pattern

        if p == "Circular":
            self._angle += self._omega * dt
            self.e_km = self.radius_km * math.cos(self._angle)
            self.n_km = self.radius_km * math.sin(self._angle)
            vx = -self.radius_km * self._omega * math.sin(self._angle)
            vy =  self.radius_km * self._omega * math.cos(self._angle)
            self._set_vel(vx, vy)

        elif p == "Figure of 8":
            amp_e = self.radius_km
            amp_n = self.radius_km * 0.5
            omega = self.speed_km_s / max(amp_e, 0.001)
            self.e_km = amp_e * math.sin(omega * self.t)
            self.n_km = amp_n * math.sin(2 * omega * self.t)
            vx = amp_e * omega * math.cos(omega * self.t)
            vy = 2 * amp_n * omega * math.cos(2 * omega * self.t)
            self._set_vel(vx, vy)

        elif p == "Sinusoidal":
            self.e_km += self.speed_km_s * 0.5 * dt
            amp = self.radius_km
            freq = self.speed_km_s / (2 * math.pi * self.radius_km * 2)
            self.n_km = amp * math.sin(2 * math.pi * freq * self.t)
            vy = amp * 2 * math.pi * freq * math.cos(2 * math.pi * freq * self.t)
            self._set_vel(self.speed_km_s * 0.5, vy)

        elif p == "Random":
            # Simple random walk
            if int(self.t * 2) % 1 == 0 and abs(self.t * 2 - round(self.t * 2)) < dt:
                _dir = random.uniform(0, 2 * math.pi)
                self._sl_vx = self.speed_km_s * math.cos(_dir)
                self._sl_vy = self.speed_km_s * math.sin(_dir)
            self.e_km += self._sl_vx * dt
            self.n_km += self._sl_vy * dt
            bound = self.radius_km * 2
            if abs(self.e_km) > bound:
                self._sl_vx *= -1
                self.e_km = math.copysign(bound, self.e_km)
            if abs(self.n_km) > bound:
                self._sl_vy *= -1
                self.n_km = math.copysign(bound, self.n_km)
            self._set_vel(self._sl_vx, self._sl_vy)

        elif p == "Spiral":
            theta = self.speed_km_s / self.radius_km * self.t
            r = (self.radius_km / (2 * math.pi * 5)) * theta % self.radius_km
            self.e_km = r * math.cos(theta)
            self.n_km = r * math.sin(theta)
            omega = self.speed_km_s / self.radius_km
            self._set_vel(
                -r * omega * math.sin(theta),
                 r * omega * math.cos(theta),
            )

        else:  # "Straight Line" or default
            self.e_km += self._sl_vx * dt
            self.n_km += self._sl_vy * dt
            bound = self.radius_km * 2
            if abs(self.e_km) > bound:
                self._sl_vx *= -1
                self.e_km = math.copysign(bound, self.e_km)
            if abs(self.n_km) > bound:
                self._sl_vy *= -1
                self.n_km = math.copysign(bound, self.n_km)
            self._set_vel(self._sl_vx, self._sl_vy)

        self._commit()
        self.platform.append_trail()

    def _set_vel(self, ve_km_s: float, vn_km_s: float) -> None:
        """Set platform ECI velocity from local ENU components."""
        ex, ey, ez = self.east
        nx, ny, nz = self.north
        vx = ve_km_s * ex + vn_km_s * nx
        vy = ve_km_s * ey + vn_km_s * ny
        vz = ve_km_s * ez + vn_km_s * nz
        self.platform.vel_eci = (vx, vy, vz)


# ─────────────────────────────────────────────────────────────────────────────
# Factory
# ─────────────────────────────────────────────────────────────────────────────

def make_satellite_integrator(
    platform: Platform,
    preset: str  = "LEO-550",
    altitude_km: Optional[float]  = None,
    inclination_deg: float = 53.0,
    phase_deg:       float = 0.0,
    raan_deg:        float = 0.0,
) -> CircularOrbitIntegrator:
    """
    Creates a CircularOrbitIntegrator from a named preset or explicit altitude.
    Preset keys: "LEO-300", "LEO-550", "LEO-2000", "MEO", "GEO".
    """
    if altitude_km is None:
        info = ORBIT_PRESETS.get(preset, ORBIT_PRESETS["LEO-550"])
        altitude_km = info["altitude_km"]
    validate_satellite_altitude(altitude_km)
    return CircularOrbitIntegrator(
        platform        = platform,
        altitude_km     = altitude_km,
        inclination_deg = inclination_deg,
        phase_deg       = phase_deg,
        raan_deg        = raan_deg,
    )
