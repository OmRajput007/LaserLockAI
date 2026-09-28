"""
constants.py
============
Physical and mission constants for the FSOC Orbital Scenario layer.

ASSUMPTION (v1): Earth-Centered Inertial (ECI) frame is used.
Earth rotation is IGNORED in v1 — i.e. the Earth is treated as non-rotating
for the purpose of LOS geometry and link-blocked tests.
This is documented here so Part 2/3 can add sidereal rotation when needed.
"""

# ── Gravitational parameter ───────────────────────────────────────────────────
GM_KM3_S2: float = 398600.4418       # km^3 / s^2  (WGS-84 / EGM96)

# ── Earth geometry ────────────────────────────────────────────────────────────
EARTH_RADIUS_KM: float = 6378.137    # km  (WGS-84 equatorial semi-major axis)

# ── Orbital gap: altitudes in this range are physically unstable ──────────────
# Below 300 km → severe drag.  UAVs go to max 20 km.
# Gap: 20 km < alt < 300 km → reject with warning.
UAV_MAX_ALT_KM: float     = 20.0     # km  maximum UAV altitude
ORBIT_MIN_ALT_KM: float   = 300.0    # km  minimum stable orbit altitude

# ── Link geometry defaults ────────────────────────────────────────────────────
DEFAULT_ATMOSPHERE_MARGIN_KM: float  = 100.0  # km  added to Earth radius for blocking test
ATMOSPHERE_SAMPLING_POINTS:   int    = 256    # samples along LOS for turbulence fraction
TURBULENCE_ALT_KM:            float  = 20.0   # km  below this = in atmosphere

# ── Brightness ────────────────────────────────────────────────────────────────
BRIGHTNESS_REF_RANGE_KM: float = 530.0  # km  reference range for 1× intensity
BRIGHTNESS_FLOOR: float        = 0.01   # minimum fractional intensity (clamped)
BRIGHTNESS_CEIL:  float        = 1.0    # maximum (base intensity)

# ── Presets ───────────────────────────────────────────────────────────────────
ORBIT_PRESETS = {
    "LEO-300":  {"altitude_km": 300.0,   "label": "LEO 300 km"},
    "LEO-550":  {"altitude_km": 550.0,   "label": "LEO 550 km (default)"},
    "LEO-2000": {"altitude_km": 2000.0,  "label": "LEO 2000 km"},
    "MEO":      {"altitude_km": 20200.0, "label": "MEO 20200 km (GPS)"},
    "GEO":      {"altitude_km": 35786.0, "label": "GEO 35786 km"},
}
