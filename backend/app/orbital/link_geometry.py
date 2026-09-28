"""
link_geometry.py
================
Line-of-sight geometry for the Orbital Scenario layer.

Provides one main function:
    compute_link(camera_platform, beacon_platform, cfg) -> LinkGeometry

Which returns:
  - range_km             : slant range between platforms
  - az_body_deg          : azimuth of beacon in camera body frame
  - el_body_deg          : elevation of beacon in camera body frame
  - link_state           : "LINK_OK" | "LINK_BLOCKED"
  - angular_rate_deg_s   : beacon angular rate seen by camera
  - intensity_fraction   : brightness scale (0..1) based on range²
  - atmosphere_path_frac : fraction of LOS samples below 20 km altitude

Body frames (Design Rule 7):
  - Satellite: LVLH  (z toward Earth center, x along velocity, y completes RH)
  - UAV:       ENU   (East, North, Up at camera position)

ASSUMPTION (v1): Earth is non-rotating.
"""

from __future__ import annotations
import math
from typing import Tuple, Literal
from dataclasses import dataclass

from backend.app.orbital.constants import (
    EARTH_RADIUS_KM,
    DEFAULT_ATMOSPHERE_MARGIN_KM,
    ATMOSPHERE_SAMPLING_POINTS,
    TURBULENCE_ALT_KM,
    BRIGHTNESS_REF_RANGE_KM,
    BRIGHTNESS_FLOOR,
    BRIGHTNESS_CEIL,
)
from backend.app.orbital.platform import Platform, Vec3


# ─────────────────────────────────────────────────────────────────────────────
# Config for link geometry (passed in; separate from OrbitalScenarioConfig so
# it can be used stand-alone in unit tests)
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class LinkConfig:
    atmosphere_margin_km: float = DEFAULT_ATMOSPHERE_MARGIN_KM
    ref_range_km:         float = BRIGHTNESS_REF_RANGE_KM
    intensity_floor:      float = BRIGHTNESS_FLOOR
    intensity_ceil:       float = BRIGHTNESS_CEIL


# ─────────────────────────────────────────────────────────────────────────────
# Result
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class LinkGeometry:
    range_km:             float
    az_body_deg:          float
    el_body_deg:          float
    link_state:           Literal["LINK_OK", "LINK_BLOCKED"]
    angular_rate_deg_s:   float
    intensity_fraction:   float
    atmosphere_path_frac: float
    min_los_clearance_km: float   # how close the LOS comes to Earth surface (km, can be negative)
    relative_speed_km_s:  float = 0.0  # relative velocity magnitude |v_beacon - v_camera| (km/s)


# ─────────────────────────────────────────────────────────────────────────────
# Math helpers
# ─────────────────────────────────────────────────────────────────────────────

def _norm(v: Vec3) -> float:
    return math.sqrt(v[0]**2 + v[1]**2 + v[2]**2)


def _unit(v: Vec3) -> Vec3:
    m = _norm(v)
    if m == 0.0:
        return (0.0, 0.0, 0.0)
    return (v[0]/m, v[1]/m, v[2]/m)


def _sub(a: Vec3, b: Vec3) -> Vec3:
    return (a[0]-b[0], a[1]-b[1], a[2]-b[2])


def _dot(a: Vec3, b: Vec3) -> float:
    return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]


def _cross(a: Vec3, b: Vec3) -> Vec3:
    return (
        a[1]*b[2] - a[2]*b[1],
        a[2]*b[0] - a[0]*b[2],
        a[0]*b[1] - a[1]*b[0],
    )


# ─────────────────────────────────────────────────────────────────────────────
# Body-frame projection
# ─────────────────────────────────────────────────────────────────────────────

def _az_el_in_body(
    los_vec: Vec3,           # unit vector from camera → beacon in ECI
    platform: Platform,
) -> Tuple[float, float]:
    """
    Projects the ECI unit LOS vector into the camera body frame and returns
    (azimuth_deg, elevation_deg).

    Body frame:
      Satellite → LVLH: x along vel, z toward Earth, y = z × x (completes RH)
      UAV       → ENU:  x = East, y = North, z = Up
    """
    pos = platform.pos_eci
    vel = platform.vel_eci

    if platform.platform_type == "SATELLITE":
        # z_hat: toward Earth center (nadir)
        r_hat = _unit(pos)
        z_hat = (-r_hat[0], -r_hat[1], -r_hat[2])   # nadir
        # x_hat: along velocity (prograde)
        x_hat = _unit(vel)
        # y_hat: completes right-hand system (y = z × x)
        y_hat = _unit(_cross(z_hat, x_hat))
    else:
        # UAV ENU body frame from ECI position
        # Up = radial
        r_hat = _unit(pos)
        z_hat = r_hat   # Up
        # Compute East (always perpendicular to Z-axis of Earth)
        z_axis = (0.0, 0.0, 1.0)
        east_raw = _cross(z_axis, z_hat)
        if _norm(east_raw) < 1e-9:
            east_raw = (1.0, 0.0, 0.0)
        x_hat = _unit(east_raw)  # East
        # North = Up × East
        y_hat = _unit(_cross(z_hat, x_hat))

    # Project LOS onto body axes
    bx = _dot(los_vec, x_hat)
    by = _dot(los_vec, y_hat)
    bz = _dot(los_vec, z_hat)

    # az measured from x toward y; el = angle above xy-plane
    az_rad = math.atan2(by, bx)
    el_rad = math.asin(max(-1.0, min(1.0, bz)))

    return math.degrees(az_rad), math.degrees(el_rad)


# ─────────────────────────────────────────────────────────────────────────────
# Earth blocking
# ─────────────────────────────────────────────────────────────────────────────

def _min_los_distance_from_earth_center(p1: Vec3, p2: Vec3) -> float:
    """
    Returns the minimum distance of the line segment p1→p2 from Earth's center.
    Uses the formula: d = |p1 + t*(p2-p1)| minimised over t ∈ [0,1].
    """
    d  = _sub(p2, p1)          # direction vector
    d2 = _dot(d, d)
    if d2 < 1e-12:
        return _norm(p1)
    # t* = −(p1·d) / |d|²
    t = -_dot(p1, d) / d2
    t = max(0.0, min(1.0, t))
    closest = (p1[0] + t*d[0], p1[1] + t*d[1], p1[2] + t*d[2])
    return _norm(closest)


def _is_link_blocked(p1: Vec3, p2: Vec3, margin_km: float) -> Tuple[bool, float]:
    """
    Returns (blocked, clearance_km).
    If both platforms are above the atmosphere margin shell, clearance is measured
    against (EARTH_RADIUS_KM + margin_km).
    If either platform is inside the atmosphere (e.g. UAV/ground station), the blocking
    boundary is the physical Earth surface EARTH_RADIUS_KM.
    If clearance_km < 0 → blocked by Earth.
    """
    h1 = _norm(p1) - EARTH_RADIUS_KM
    h2 = _norm(p2) - EARTH_RADIUS_KM
    effective_margin = margin_km if (h1 >= margin_km and h2 >= margin_km) else 0.0

    min_dist = _min_los_distance_from_earth_center(p1, p2)
    clearance = min_dist - (EARTH_RADIUS_KM + effective_margin)
    return clearance < 0.0, clearance



# ─────────────────────────────────────────────────────────────────────────────
# Atmosphere path fraction
# ─────────────────────────────────────────────────────────────────────────────

def _atmosphere_path_fraction(p1: Vec3, p2: Vec3) -> float:
    """
    Samples ATMOSPHERE_SAMPLING_POINTS uniformly along p1→p2.
    Returns the fraction of samples whose altitude < TURBULENCE_ALT_KM.

    If both endpoints are above 100 km and no sample dips below 20 km → 0.
    """
    low_count = 0
    for i in range(ATMOSPHERE_SAMPLING_POINTS):
        t = i / (ATMOSPHERE_SAMPLING_POINTS - 1)
        pt = (
            p1[0] + t * (p2[0]-p1[0]),
            p1[1] + t * (p2[1]-p1[1]),
            p1[2] + t * (p2[2]-p1[2]),
        )
        alt = _norm(pt) - EARTH_RADIUS_KM
        if alt < TURBULENCE_ALT_KM:
            low_count += 1
    return low_count / ATMOSPHERE_SAMPLING_POINTS


# ─────────────────────────────────────────────────────────────────────────────
# Angular rate
# ─────────────────────────────────────────────────────────────────────────────

def _angular_rate_deg_s(
    camera_pos: Vec3, camera_vel: Vec3,
    beacon_pos: Vec3,  beacon_vel: Vec3,
    range_km: float,
) -> float:
    """
    Computes the angular rate of the beacon as seen from the camera (deg/s).
    Uses the transverse (perpendicular to LOS) component of relative velocity.

    ω = |v_rel_transverse| / range
    """
    # Relative position and velocity
    r_vec = _sub(beacon_pos, camera_pos)
    v_rel = _sub(beacon_vel, camera_vel)

    if range_km < 1e-6:
        return 0.0

    r_hat = _unit(r_vec)

    # Radial component of relative velocity
    v_radial = _dot(v_rel, r_hat)

    # Transverse component magnitude
    v_transverse_sq = _dot(v_rel, v_rel) - v_radial**2
    v_transverse = math.sqrt(max(0.0, v_transverse_sq))

    # ω in rad/s then convert to deg/s
    omega_rad_s = v_transverse / range_km   # (km/s) / km = rad/s
    return math.degrees(omega_rad_s)


# ─────────────────────────────────────────────────────────────────────────────
# Master function
# ─────────────────────────────────────────────────────────────────────────────

def compute_link(
    camera: Platform,
    beacon: Platform,
    cfg: LinkConfig = None,
) -> LinkGeometry:
    """
    Computes the full link geometry between two platforms.

    Args:
        camera   : Platform hosting the imaging system.
        beacon   : Platform carrying the optical beacon.
        cfg      : LinkConfig (uses defaults if None).

    Returns:
        LinkGeometry dataclass.
    """
    if cfg is None:
        cfg = LinkConfig()

    c_pos = camera.pos_eci
    b_pos = beacon.pos_eci
    c_vel = camera.vel_eci
    b_vel = beacon.vel_eci

    # ── Range ────────────────────────────────────────────────────────────────
    diff = _sub(b_pos, c_pos)
    range_km = _norm(diff)
    los_unit = _unit(diff) if range_km > 1e-9 else (1.0, 0.0, 0.0)

    # ── Body-frame az/el ─────────────────────────────────────────────────────
    az_deg, el_deg = _az_el_in_body(los_unit, camera)

    # ── Earth blocking ────────────────────────────────────────────────────────
    blocked, clearance = _is_link_blocked(c_pos, b_pos, cfg.atmosphere_margin_km)
    link_state: Literal["LINK_OK", "LINK_BLOCKED"] = "LINK_BLOCKED" if blocked else "LINK_OK"

    # ── Angular rate ─────────────────────────────────────────────────────────
    ang_rate = _angular_rate_deg_s(c_pos, c_vel, b_pos, b_vel, range_km)

    # ── Brightness fraction ───────────────────────────────────────────────────
    if range_km > 1e-6:
        frac = (cfg.ref_range_km / range_km) ** 2
    else:
        frac = cfg.intensity_ceil
    intensity_fraction = max(cfg.intensity_floor, min(cfg.intensity_ceil, frac))

    # ── Atmosphere path fraction ──────────────────────────────────────────────
    atm_frac = _atmosphere_path_fraction(c_pos, b_pos)

    # ── Relative speed ────────────────────────────────────────────────────────
    rel_speed = _norm(_sub(b_vel, c_vel))

    return LinkGeometry(
        range_km             = range_km,
        az_body_deg          = az_deg,
        el_body_deg          = el_deg,
        link_state           = link_state,
        angular_rate_deg_s   = ang_rate,
        intensity_fraction   = intensity_fraction,
        atmosphere_path_frac = atm_frac,
        min_los_clearance_km = clearance,
        relative_speed_km_s  = rel_speed,
    )
