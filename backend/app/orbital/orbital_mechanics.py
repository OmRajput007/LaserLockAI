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
    UAV_MAX_ALT_KM, ORBIT_MIN_ALT_KM, ORBIT_DRAG_LIMIT_KM,
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

# Kepler's equation solver and anomaly converters
# ─────────────────────────────────────────────────────────────────────────────

def solve_kepler(M: float, e: float, tol: float = 1e-12, max_iter: int = 50) -> float:
    """
    Solves Kepler's equation M = E - e*sin(E) for Eccentric Anomaly E (radians).
    Uses Newton-Raphson iteration with a robust initial guess.
    """
    M = M % (2.0 * math.pi)
    if e == 0.0:
        return M

    # Robust initial guess for eccentric anomaly
    if e < 0.8:
        E = M
    else:
        E = math.pi if M == 0.0 else M + e * math.sin(M) + 0.5 * (e ** 2) * math.sin(2.0 * M)

    for _ in range(max_iter):
        f = E - e * math.sin(E) - M
        f_prime = 1.0 - e * math.cos(E)
        if abs(f_prime) < 1e-14:
            break
        delta = f / f_prime
        E -= delta
        if abs(delta) < tol:
            break

    return E % (2.0 * math.pi)


def eccentric_to_true_anomaly(E: float, e: float) -> float:
    """Computes true anomaly nu (radians) from eccentric anomaly E (radians)."""
    if e == 0.0:
        return E % (2.0 * math.pi)
    cos_E = math.cos(E)
    sin_E = math.sin(E)
    cos_nu = (cos_E - e) / (1.0 - e * cos_E)
    sin_nu = (math.sqrt(max(0.0, 1.0 - e * e)) * sin_E) / (1.0 - e * cos_E)
    return math.atan2(sin_nu, cos_nu) % (2.0 * math.pi)


def true_to_eccentric_anomaly(nu: float, e: float) -> float:
    """Computes eccentric anomaly E (radians) from true anomaly nu (radians)."""
    if e == 0.0:
        return nu % (2.0 * math.pi)
    cos_nu = math.cos(nu)
    sin_nu = math.sin(nu)
    cos_E = (e + cos_nu) / (1.0 + e * cos_nu)
    sin_E = (math.sqrt(max(0.0, 1.0 - e * e)) * sin_nu) / (1.0 + e * cos_nu)
    return math.atan2(sin_E, cos_E) % (2.0 * math.pi)


# ─────────────────────────────────────────────────────────────────────────────
# Altitude & Orbit Validation
# ─────────────────────────────────────────────────────────────────────────────

def validate_satellite_altitude(
    perigee_alt_km: float,
    apogee_alt_km: Optional[float] = None
) -> None:
    """
    Validates orbital elements:
    - Perigee altitude must be >= 150 km (drag limit).
    - Apogee altitude must be >= perigee altitude.
    - Rejects unstable boundary between UAV (<= 20 km) and orbit (>= 150 km).
    """
    if apogee_alt_km is None:
        apogee_alt_km = perigee_alt_km

    # If within unstable atmospheric gap or below drag limit
    if perigee_alt_km < ORBIT_DRAG_LIMIT_KM:
        raise ValueError(
            f"No stable orbit with perigee {perigee_alt_km:.1f} km below drag limit {ORBIT_DRAG_LIMIT_KM:.1f} km. "
            f"Perigee altitude must be >= {ORBIT_DRAG_LIMIT_KM:.1f} km."
        )
    if apogee_alt_km < perigee_alt_km:
        raise ValueError(
            f"Invalid apogee altitude ({apogee_alt_km:.1f} km): "
            f"Apogee altitude must be >= perigee altitude ({perigee_alt_km:.1f} km)."
        )


# ─────────────────────────────────────────────────────────────────────────────
# General Keplerian Orbit Integrator (Satellite)
# ─────────────────────────────────────────────────────────────────────────────

class KeplerianOrbitIntegrator:
    """
    Analytic propagator for general Keplerian ECI orbits (circular e=0 and elliptical 0 < e < 1).

    Elements:
      - Perigee altitude (km), Apogee altitude (km) -> derive semi-major axis a, eccentricity e
      - Inclination (deg)
      - RAAN (deg)
      - Argument of perigee (deg)
      - True anomaly at epoch (deg)

    Speed at every point is computed with the full vis-viva equation:
        v = sqrt(GM * (2/r - 1/a))
    """

    def __init__(
        self,
        platform: Platform,
        perigee_alt_km: Optional[float] = None,
        apogee_alt_km: Optional[float]  = None,
        altitude_km: Optional[float]    = None,   # backward compatibility for circular presets
        inclination_deg: float          = 53.0,
        raan_deg: float                 = 0.0,
        arg_perigee_deg: float          = 0.0,
        true_anomaly_deg: float         = 0.0,
        phase_deg: Optional[float]      = None,   # alias for true_anomaly_deg / starting phase
    ):
        # Resolve legacy circular altitude_km if passed
        if perigee_alt_km is None and altitude_km is not None:
            perigee_alt_km = altitude_km
        if perigee_alt_km is None:
            perigee_alt_km = 550.0

        if apogee_alt_km is None and altitude_km is not None:
            apogee_alt_km = altitude_km
        if apogee_alt_km is None:
            apogee_alt_km = perigee_alt_km

        if phase_deg is not None and true_anomaly_deg == 0.0:
            true_anomaly_deg = phase_deg

        validate_satellite_altitude(perigee_alt_km, apogee_alt_km)

        self.platform = platform
        self.perigee_alt_km = float(perigee_alt_km)
        self.apogee_alt_km  = float(apogee_alt_km)

        # Radii from Earth center (km)
        self.r_p_km = EARTH_RADIUS_KM + self.perigee_alt_km
        self.r_a_km = EARTH_RADIUS_KM + self.apogee_alt_km

        # Standard Keplerian orbital elements
        self.a_km = (self.r_p_km + self.r_a_km) / 2.0
        self.e    = (self.r_a_km - self.r_p_km) / (self.r_a_km + self.r_p_km)
        self.p_km = self.a_km * (1.0 - self.e ** 2)

        self.incl_rad  = math.radians(inclination_deg)
        self.raan_rad  = math.radians(raan_deg)
        self.arg_p_rad = math.radians(arg_perigee_deg)

        # Mean motion n (rad/s) and orbital period (s)
        self.mean_motion_rad_s = math.sqrt(GM_KM3_S2 / (self.a_km ** 3))
        self.period_s          = 2.0 * math.pi / self.mean_motion_rad_s

        # Epoch anomaly state
        self.nu_rad = math.radians(true_anomaly_deg) % (2.0 * math.pi)
        self.E_rad  = true_to_eccentric_anomaly(self.nu_rad, self.e)
        self.M_rad  = (self.E_rad - self.e * math.sin(self.E_rad)) % (2.0 * math.pi)

        # Dynamic state (radius, altitude, speed from vis-viva)
        self.r_km = self.a_km * (1.0 - self.e * math.cos(self.E_rad))
        self.altitude_km = self.r_km - EARTH_RADIUS_KM
        self.speed_km_s  = math.sqrt(GM_KM3_S2 * (2.0 / self.r_km - 1.0 / self.a_km))
        self.omega_rad_s = math.sqrt(GM_KM3_S2 * max(1e-9, self.p_km)) / (self.r_km ** 2)

        # Legacy alias for phase
        self.phase_rad = self.nu_rad

        # Initialise platform
        platform.platform_type = "SATELLITE"
        self._update_platform()

    # ── Orbital basis vectors (inertial ECI) ───────────────────────────────────

    def _orbit_basis(self) -> Tuple[Vec3, Vec3]:
        """
        Returns (p_hat, q_hat): unit vectors in ECI frame for the orbital plane.
        p_hat points toward perigee (true anomaly = 0).
        q_hat is in the orbit plane 90 deg ahead of perigee in direction of motion.
        """
        ra  = self.raan_rad
        inc = self.incl_rad
        w   = self.arg_p_rad

        px = math.cos(ra) * math.cos(w) - math.sin(ra) * math.sin(w) * math.cos(inc)
        py = math.sin(ra) * math.cos(w) + math.cos(ra) * math.sin(w) * math.cos(inc)
        pz = math.sin(w) * math.sin(inc)

        qx = -math.cos(ra) * math.sin(w) - math.sin(ra) * math.cos(w) * math.cos(inc)
        qy = -math.sin(ra) * math.sin(w) + math.cos(ra) * math.cos(w) * math.cos(inc)
        qz =  math.cos(w) * math.sin(inc)

        return (px, py, pz), (qx, qy, qz)

    def _update_platform(self) -> None:
        """Computes current ECI position and velocity using Keplerian geometry and full vis-viva."""
        p_hat, q_hat = self._orbit_basis()
        nu = self.nu_rad

        # Radius from eccentric anomaly: r = a * (1 - e * cos(E))
        self.r_km = self.a_km * (1.0 - self.e * math.cos(self.E_rad))
        self.altitude_km = self.r_km - EARTH_RADIUS_KM

        # ECI Position vector
        cos_nu, sin_nu = math.cos(nu), math.sin(nu)
        x = self.r_km * (cos_nu * p_hat[0] + sin_nu * q_hat[0])
        y = self.r_km * (cos_nu * p_hat[1] + sin_nu * q_hat[1])
        z = self.r_km * (cos_nu * p_hat[2] + sin_nu * q_hat[2])
        self.platform.pos_eci = (x, y, z)

        # Full vis-viva equation: v = sqrt(GM * (2/r - 1/a))
        self.speed_km_s = math.sqrt(GM_KM3_S2 * (2.0 / self.r_km - 1.0 / self.a_km))
        self.omega_rad_s = math.sqrt(GM_KM3_S2 * max(1e-9, self.p_km)) / (self.r_km ** 2)

        # Velocity components in orbital plane (perifocal)
        v_scale = math.sqrt(GM_KM3_S2 / max(1e-9, self.p_km))
        vp = -v_scale * sin_nu
        vq =  v_scale * (self.e + cos_nu)

        vx = vp * p_hat[0] + vq * q_hat[0]
        vy = vp * p_hat[1] + vq * q_hat[1]
        vz = vp * p_hat[2] + vq * q_hat[2]
        self.platform.vel_eci = (vx, vy, vz)

        self.phase_rad = self.nu_rad

    def step(self, dt: float) -> None:
        """
        Advances the Keplerian orbit by dt seconds.
        Mean anomaly -> Eccentric anomaly (Kepler) -> True anomaly -> r -> vis-viva speed.
        """
        self.M_rad  = (self.M_rad + self.mean_motion_rad_s * dt) % (2.0 * math.pi)
        self.E_rad  = solve_kepler(self.M_rad, self.e)
        self.nu_rad = eccentric_to_true_anomaly(self.E_rad, self.e)
        self._update_platform()
        self.platform.append_trail()

    # ── Derived quantities for telemetry ──────────────────────────────────────

    @property
    def omega_deg_s(self) -> float:
        return math.degrees(self.omega_rad_s)

    def to_dict(self) -> dict:
        return {
            "altitude_km":         round(self.altitude_km, 3),
            "perigee_alt_km":      round(self.perigee_alt_km, 3),
            "apogee_alt_km":       round(self.apogee_alt_km, 3),
            "semi_major_axis_km":  round(self.a_km, 3),
            "eccentricity":        round(self.e, 6),
            "radius_km":           round(self.r_km, 3),
            "speed_km_s":          round(self.speed_km_s, 6),
            "omega_deg_s":         round(self.omega_deg_s, 6),
            "period_s":            round(self.period_s, 2),
            "inclination_deg":     round(math.degrees(self.incl_rad), 3),
            "raan_deg":            round(math.degrees(self.raan_rad), 3),
            "arg_perigee_deg":     round(math.degrees(self.arg_p_rad), 3),
            "true_anomaly_deg":    round(math.degrees(self.nu_rad), 3),
            "mean_anomaly_deg":    round(math.degrees(self.M_rad), 3),
            "phase_deg":           round(math.degrees(self.nu_rad), 3),
        }


# Backward compatibility alias
CircularOrbitIntegrator = KeplerianOrbitIntegrator


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
    preset: str = "LEO-550",
    perigee_alt_km: Optional[float] = None,
    apogee_alt_km: Optional[float]  = None,
    altitude_km: Optional[float]    = None,
    inclination_deg: Optional[float]= None,
    raan_deg: Optional[float]       = None,
    arg_perigee_deg: Optional[float]= None,
    true_anomaly_deg: float         = 0.0,
    phase_deg: Optional[float]      = None,
) -> KeplerianOrbitIntegrator:
    """
    Creates a KeplerianOrbitIntegrator from a named preset or explicit Keplerian elements.
    Presets: "LEO-300", "LEO-550", "LEO-2000", "MEO", "GEO", "GTO".
    """
    info = ORBIT_PRESETS.get(preset, ORBIT_PRESETS["LEO-550"])

    # Resolve perigee altitude
    if perigee_alt_km is None and altitude_km is None:
        perigee_alt_km = info.get("perigee_alt_km", info.get("altitude_km", 550.0))
    elif perigee_alt_km is None:
        perigee_alt_km = altitude_km

    # Resolve apogee altitude
    if apogee_alt_km is None and altitude_km is not None and perigee_alt_km == altitude_km:
        apogee_alt_km = altitude_km
    elif apogee_alt_km is None:
        apogee_alt_km = info.get("apogee_alt_km", perigee_alt_km)

    if inclination_deg is None:
        inclination_deg = info.get("inclination_deg", 53.0)

    if raan_deg is None:
        raan_deg = info.get("raan_deg", 0.0)

    if arg_perigee_deg is None:
        arg_perigee_deg = info.get("arg_perigee_deg", 0.0)

    if phase_deg is not None and true_anomaly_deg == 0.0:
        true_anomaly_deg = phase_deg

    validate_satellite_altitude(perigee_alt_km, apogee_alt_km)

    return KeplerianOrbitIntegrator(
        platform        = platform,
        perigee_alt_km  = perigee_alt_km,
        apogee_alt_km   = apogee_alt_km,
        inclination_deg = inclination_deg,
        raan_deg        = raan_deg,
        arg_perigee_deg = arg_perigee_deg,
        true_anomaly_deg= true_anomaly_deg,
    )
