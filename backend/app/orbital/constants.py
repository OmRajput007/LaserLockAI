"""
constants.py
============
Physical and mission constants for the FSOC Orbital Scenario layer.

ASSUMPTION (v1): Earth-Centered Inertial (ECI) frame is used.
Earth rotation is IGNORED in v1 — i.e. the Earth is treated as non-rotating
for the purpose of LOS geometry and link-blocked tests.
This is documented here so Part 2/3 can add sidereal rotation when needed.
"""

import math

# ── Gravitational parameter ───────────────────────────────────────────────────
GM_KM3_S2: float = 398600.4418       # km^3 / s^2  (WGS-84 / EGM96)

# ── Earth geometry ────────────────────────────────────────────────────────────
EARTH_RADIUS_KM: float = 6378.137    # km  (WGS-84 equatorial semi-major axis)

# ── Earth diurnal rotation (Spin: 15°/hour = 360°/24h) ────────────────────────
EARTH_ROTATION_DEG_PER_HOUR: float = 15.0                # deg / hour
EARTH_ROTATION_DEG_PER_SEC: float  = 15.0 / 3600.0       # deg / s (0.00416667 deg/s)
EARTH_ROTATION_RAD_PER_SEC: float  = math.radians(15.0) / 3600.0  # rad / s (~7.2722052e-5 rad/s)

# ── Orbital drag limit: perigee altitude below 150 km decays rapidly ─────────
UAV_MAX_ALT_KM: float     = 20.0     # km  maximum UAV altitude
ORBIT_DRAG_LIMIT_KM: float= 150.0    # km  drag limit (minimum perigee altitude)
ORBIT_MIN_ALT_KM: float   = 150.0    # km  minimum orbital perigee altitude (was 300 for circular)

# ── Link geometry defaults ────────────────────────────────────────────────────
DEFAULT_ATMOSPHERE_MARGIN_KM: float  = 100.0  # km  added to Earth radius for blocking test
ATMOSPHERE_SAMPLING_POINTS:   int    = 256    # samples along LOS for turbulence fraction
TURBULENCE_ALT_KM:            float  = 20.0   # km  below this = in atmosphere

# ── Brightness ────────────────────────────────────────────────────────────────
BRIGHTNESS_REF_RANGE_KM: float = 530.0  # km  reference range for 1× intensity
BRIGHTNESS_FLOOR: float        = 0.01   # minimum fractional intensity (clamped)
BRIGHTNESS_CEIL:  float        = 1.0    # maximum (base intensity)

# ── Presets (Standard Keplerian elements: perigee/apogee altitude, inc, raan, arg_perigee) ────
ORBIT_PRESETS = {
    "LEO-300": {
        "perigee_alt_km": 300.0,
        "apogee_alt_km": 300.0,
        "altitude_km": 300.0,
        "inclination_deg": 53.0,
        "raan_deg": 0.0,
        "arg_perigee_deg": 0.0,
        "label": "LEO 300 km",
    },
    "LEO-550": {
        "perigee_alt_km": 550.0,
        "apogee_alt_km": 550.0,
        "altitude_km": 550.0,
        "inclination_deg": 53.0,
        "raan_deg": 0.0,
        "arg_perigee_deg": 0.0,
        "label": "LEO 550 km (default)",
    },
    "LEO-2000": {
        "perigee_alt_km": 2000.0,
        "apogee_alt_km": 2000.0,
        "altitude_km": 2000.0,
        "inclination_deg": 53.0,
        "raan_deg": 0.0,
        "arg_perigee_deg": 0.0,
        "label": "LEO 2000 km",
    },
    "MEO": {
        "perigee_alt_km": 20200.0,
        "apogee_alt_km": 20200.0,
        "altitude_km": 20200.0,
        "inclination_deg": 55.0,
        "raan_deg": 0.0,
        "arg_perigee_deg": 0.0,
        "label": "MEO 20200 km (GPS)",
    },
    "GEO": {
        "perigee_alt_km": 35786.0,
        "apogee_alt_km": 35786.0,
        "altitude_km": 35786.0,
        "inclination_deg": 0.0,
        "raan_deg": 0.0,
        "arg_perigee_deg": 0.0,
        "label": "GEO 35786 km",
    },
    "GTO": {
        "perigee_alt_km": 200.0,
        "apogee_alt_km": 35786.0,
        "altitude_km": 17993.0,
        "inclination_deg": 28.5,
        "raan_deg": 0.0,
        "arg_perigee_deg": 0.0,
        "label": "GTO (200 x 35786 km)",
    },
}
