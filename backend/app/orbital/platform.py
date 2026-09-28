"""
platform.py
===========
Platform data model for the Orbital Scenario layer.

A Platform can be either a UAV or a SATELLITE.  It carries:
  - type                : "UAV" | "SATELLITE"
  - pos_eci             : (x, y, z) in km  — Earth-Centered Inertial
  - vel_eci             : (vx, vy, vz) in km/s — ECI velocity
  - trail               : rolling history of ECI positions (up to MAX_TRAIL)
  - altitude_km         : current altitude above Earth surface

The Platform does NOT contain the motion integrator; that lives in
OrbitalMechanics (satellite) or UAVLocalMotion (UAV).  This file is
deliberately thin so Part 2 (Three.js) can consume it directly.
"""

from __future__ import annotations
import math
from typing import Literal, List, Tuple, Deque
from collections import deque
from dataclasses import dataclass, field

from backend.app.orbital.constants import EARTH_RADIUS_KM

Vec3 = Tuple[float, float, float]

MAX_TRAIL: int = 2000  # bounded trail length for visualisation (Part 2)


@dataclass
class Platform:
    """Render-friendly state container for one FSOC terminal (camera or beacon)."""

    platform_type: Literal["UAV", "SATELLITE"] = "SATELLITE"

    # ECI position / velocity (km, km/s) — double precision
    pos_eci: Vec3 = (0.0, 0.0, 0.0)
    vel_eci: Vec3 = (0.0, 0.0, 0.0)

    # Rolling position trail for 3-D visualisation
    trail: Deque[Vec3] = field(default_factory=lambda: deque(maxlen=MAX_TRAIL))

    # ── Derived / cached ─────────────────────────────────────────────────────

    @property
    def altitude_km(self) -> float:
        """Altitude above WGS-84 equatorial surface in km."""
        x, y, z = self.pos_eci
        r = math.sqrt(x * x + y * y + z * z)
        return r - EARTH_RADIUS_KM

    @property
    def radius_km(self) -> float:
        """Distance from Earth center in km."""
        x, y, z = self.pos_eci
        return math.sqrt(x * x + y * y + z * z)

    @property
    def speed_km_s(self) -> float:
        """ECI speed magnitude in km/s."""
        vx, vy, vz = self.vel_eci
        return math.sqrt(vx * vx + vy * vy + vz * vz)

    # ── Trail management ─────────────────────────────────────────────────────

    def append_trail(self) -> None:
        """Append current ECI position to the rolling trail."""
        self.trail.append(self.pos_eci)

    def trail_list(self) -> List[Vec3]:
        """Return a plain list snapshot (for JSON serialisation / Three.js)."""
        return list(self.trail)

    # ── Dict export for telemetry ─────────────────────────────────────────────

    def to_dict(self) -> dict:
        x, y, z   = self.pos_eci
        vx, vy, vz = self.vel_eci
        return {
            "platform_type":  self.platform_type,
            "pos_eci_km":     {"x": x, "y": y, "z": z},
            "vel_eci_km_s":   {"x": vx, "y": vy, "z": vz},
            "altitude_km":    round(self.altitude_km, 3),
            "radius_km":      round(self.radius_km, 3),
            "speed_km_s":     round(self.speed_km_s, 6),
            "trail_length":   len(self.trail),
        }
