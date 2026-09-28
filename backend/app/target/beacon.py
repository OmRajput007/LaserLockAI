"""
beacon.py
=========
Optical Beacon Target Model and Multi-Target Manager for FSOC Simulation.

BeaconTarget:
  - Holds the 3D kinematic state (position, velocity, acceleration) of an FSOC beacon.
  - Delegates motion integration to a pluggable motion generator (any BaseTrajectory subclass).
  - Renders the optical spot onto a NumPy frame using three spot shapes:
      Square    — flat-top rectangular aperture (default, 10×10 px)
      Circle    — filled circular Airy-disk approximation
      Gaussian  — 2D Gaussian point-spread function (most physically accurate)
  - Maintains a rolling trajectory trail for 3D scene visualisation.

TargetManager:
  - Creates and manages 1..N BeaconTarget instances from SystemConfig.
  - Exposes primary_target, targets list, and update(dt) / reset() interface.
  - Provides set_position() for direct 3D coordinate override (test/debug).
"""

import math
import random
from typing import List, Tuple, Optional

import numpy as np

from backend.app.models.config_model import TargetConfig, MotionConfig
from backend.app.target.motion_generators import BaseTrajectory, create_motion_generator


class BeaconTarget:
    """
    Simulates a single optical beacon terminal (e.g., a UAV/satellite FSOC node).

    Attributes:
        target_id   : Unique integer identifier (1-based).
        shape       : Optical spot shape — "Square" | "Circle" | "Gaussian".
        size_pixels : Nominal spot dimension in pixels (default: 10).
        intensity   : Peak radiant intensity [0, 255].
        x, y, z     : Current 3D world-space position.
    """

    # Maximum trail length kept for visualisation
    MAX_TRAIL_LENGTH = 500

    def __init__(
        self,
        target_id: int = 1,
        shape: str = "Square",
        size_pixels: int = 10,
        intensity: float = 255.0,
        initial_x: float = 1000.0,
        initial_y: float = 1000.0,
        initial_z: float = 1000.0,
        motion_generator: Optional[BaseTrajectory] = None,
    ):
        self.target_id = target_id
        self.shape = shape
        self.size_pixels = size_pixels
        self.intensity = intensity

        # 3D kinematic state
        self.x = initial_x
        self.y = initial_y
        self.z = initial_z
        self.vx = 0.0
        self.vy = 0.0
        self.vz = 0.0
        self.ax = 0.0
        self.ay = 0.0
        self.az = 0.0

        # Pluggable motion generator (may be None for a static target)
        self._generator: Optional[BaseTrajectory] = motion_generator

        # Rolling trail for 3D visualisation
        self._trail: List[Tuple[float, float, float]] = [(initial_x, initial_y, initial_z)]

    # ------------------------------------------------------------------
    # Position / Velocity / Acceleration accessors
    # ------------------------------------------------------------------

    def get_position(self) -> Tuple[float, float, float]:
        return self.x, self.y, self.z

    def get_velocity(self) -> Tuple[float, float, float]:
        return self.vx, self.vy, self.vz

    def get_acceleration(self) -> Tuple[float, float, float]:
        return self.ax, self.ay, self.az

    def get_trail(self) -> List[Tuple[float, float, float]]:
        return list(self._trail)

    # ------------------------------------------------------------------
    # Kinematics update
    # ------------------------------------------------------------------

    def update(self, dt: float):
        """Advances target state by dt seconds using the attached motion generator."""
        if self._generator is None or dt <= 0:
            return

        pos, vel, acc = self._generator.evaluate(dt)
        self.x, self.y, self.z = pos
        self.vx, self.vy, self.vz = vel
        self.ax, self.ay, self.az = acc

        # Append to trail, trim if needed
        self._trail.append((self.x, self.y, self.z))
        if len(self._trail) > self.MAX_TRAIL_LENGTH:
            self._trail = self._trail[-self.MAX_TRAIL_LENGTH:]

    def set_position(self, x: float, y: float, z: float):
        """Directly overrides the 3D world position (for testing / manual control)."""
        self.x = x
        self.y = y
        self.z = z
        # Sync generator state if present
        if self._generator is not None:
            self._generator.x = x
            self._generator.y = y
            self._generator.z = z

    def reset(self, initial_mode: str = "Random", cx: float = 1000.0, cy: float = 1000.0, cz: float = 1000.0):
        """Resets target kinematic state and trail."""
        if self._generator is not None:
            self._generator.reset(initial_mode=initial_mode)
            self.x, self.y, self.z = self._generator.x, self._generator.y, self._generator.z
        else:
            if initial_mode == "Center":
                self.x, self.y, self.z = cx, cy, cz
            elif initial_mode == "Manual":
                pass
            else:
                self.x = random.uniform(200.0, 1800.0)
                self.y = random.uniform(200.0, 1800.0)
                self.z = cz

        self.vx = self.vy = self.vz = 0.0
        self.ax = self.ay = self.az = 0.0
        self._trail = [(self.x, self.y, self.z)]

    # ------------------------------------------------------------------
    # Frame rendering  (called by simulation engine, not by CV detector)
    # ------------------------------------------------------------------

    def render_to_frame(
        self,
        frame: np.ndarray,
        px: float,
        py: float,
        intensity_override: Optional[float] = None,
    ):
        """
        Renders the optical beacon spot onto frame at sensor pixel (px, py).

        Args:
            frame:              NumPy uint8 array — shape (H, W) mono or (H, W, 3) colour.
            px, py:             Sub-pixel sensor coordinates (float).
            intensity_override: If provided, overrides self.intensity (e.g. after atmospheric attenuation).
        """
        h, w = frame.shape[:2]
        is_color = (frame.ndim == 3 and frame.shape[2] == 3)
        intensity = float(intensity_override if intensity_override is not None else self.intensity)
        intensity = float(np.clip(intensity, 0.0, 255.0))
        half = self.size_pixels // 2

        # Integer centre (nearest pixel)
        cx_i = int(round(px))
        cy_i = int(round(py))

        if self.shape == "Square":
            x0 = max(0, cx_i - half)
            x1 = min(w, cx_i + half + 1)
            y0 = max(0, cy_i - half)
            y1 = min(h, cy_i + half + 1)
            if x1 > x0 and y1 > y0:
                val = int(round(intensity))
                if is_color:
                    frame[y0:y1, x0:x1] = np.maximum(frame[y0:y1, x0:x1], val)
                else:
                    frame[y0:y1, x0:x1] = np.maximum(frame[y0:y1, x0:x1], val)

        elif self.shape == "Circle":
            r = max(1, half)
            y_coords, x_coords = np.ogrid[
                max(0, cy_i - r):min(h, cy_i + r + 1),
                max(0, cx_i - r):min(w, cx_i + r + 1),
            ]
            mask = (x_coords - cx_i) ** 2 + (y_coords - cy_i) ** 2 <= r ** 2
            val = int(round(intensity))
            region_y = slice(max(0, cy_i - r), min(h, cy_i + r + 1))
            region_x = slice(max(0, cx_i - r), min(w, cx_i + r + 1))
            if is_color:
                for c in range(3):
                    channel = frame[region_y, region_x, c]
                    channel[mask] = np.maximum(channel[mask], val)
                    frame[region_y, region_x, c] = channel
            else:
                roi = frame[region_y, region_x]
                roi[mask] = np.maximum(roi[mask], val)
                frame[region_y, region_x] = roi

        elif self.shape == "Gaussian":
            # 2D Gaussian PSF: sigma = size_pixels / 4 so spot fills ~4σ diameter
            sigma = max(1.0, self.size_pixels / 4.0)
            r = int(math.ceil(3 * sigma))  # render within 3σ radius

            x0 = max(0, cx_i - r)
            x1 = min(w, cx_i + r + 1)
            y0 = max(0, cy_i - r)
            y1 = min(h, cy_i + r + 1)

            if x1 > x0 and y1 > y0:
                xs = np.arange(x0, x1, dtype=np.float32)
                ys = np.arange(y0, y1, dtype=np.float32)
                xx, yy = np.meshgrid(xs, ys)
                gauss = intensity * np.exp(
                    -((xx - px) ** 2 + (yy - py) ** 2) / (2.0 * sigma ** 2)
                )
                gauss_u8 = np.clip(gauss, 0, 255).astype(np.uint8)
                if is_color:
                    for c in range(3):
                        frame[y0:y1, x0:x1, c] = np.maximum(frame[y0:y1, x0:x1, c], gauss_u8)
                else:
                    frame[y0:y1, x0:x1] = np.maximum(frame[y0:y1, x0:x1], gauss_u8)


# ---------------------------------------------------------------------------
# TargetManager
# ---------------------------------------------------------------------------

class TargetManager:
    """
    Creates and manages all BeaconTarget instances for the simulation.

    One primary target (target_id=1) is always present.
    Additional targets (up to target_count) can be spawned for multi-target tests.
    """

    def __init__(self, target_config: TargetConfig, motion_config: MotionConfig):
        self.target_config = target_config
        self.motion_config = motion_config

        self.targets: List[BeaconTarget] = []
        self._build_targets()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _make_generator(self, target_id: int) -> BaseTrajectory:
        """Creates a motion generator for a given target, with slight offsets for extra targets."""
        cx = float(self.motion_config.screen_width) / 2.0
        cy = float(self.motion_config.screen_height) / 2.0
        cz = float(self.motion_config.world_depth_z) / 2.0

        # Slightly offset secondary targets so they don't overlap
        if target_id > 1:
            cx += (target_id - 1) * 100.0
            cy += (target_id - 1) * 80.0

        return create_motion_generator(
            trajectory_type=self.motion_config.trajectory_type,
            cx=cx,
            cy=cy,
            cz=cz,
            speed=self.motion_config.speed_pixels_per_s,
            world_width=float(self.motion_config.screen_width),
            world_height=float(self.motion_config.screen_height),
            world_depth=float(self.motion_config.world_depth_z),
        )

    def _build_targets(self):
        """Constructs the target list from configuration."""
        self.targets = []
        count = max(1, self.target_config.target_count)
        for i in range(count):
            tid = i + 1
            gen = self._make_generator(tid)
            gen.reset(initial_mode=self.target_config.initial_location_mode)

            t = BeaconTarget(
                target_id=tid,
                shape=self.target_config.shape,
                size_pixels=self.target_config.size_pixels,
                intensity=self.target_config.intensity,
                initial_x=gen.x,
                initial_y=gen.y,
                initial_z=gen.z,
                motion_generator=gen,
            )
            self.targets.append(t)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    @property
    def primary_target(self) -> BeaconTarget:
        """Returns the primary (first) beacon target."""
        return self.targets[0]

    def update(self, dt: float):
        """Advances all target kinematics by dt seconds."""
        for t in self.targets:
            t.update(dt)

    def reset(self):
        """Resets all targets to initial conditions."""
        for t in self.targets:
            t.reset(
                initial_mode=self.target_config.initial_location_mode,
                cx=float(self.motion_config.screen_width) / 2.0,
                cy=float(self.motion_config.screen_height) / 2.0,
                cz=float(self.motion_config.world_depth_z) / 2.0,
            )

    def set_position(self, x: float, y: float, z: float, target_id: int = 1):
        """Directly overrides position of target with given target_id (for testing/debugging)."""
        for t in self.targets:
            if t.target_id == target_id:
                t.set_position(x, y, z)
                return

    def update_config(self, target_config: TargetConfig, motion_config: MotionConfig):
        """
        Updates configuration and rebuilds targets if target count or type changed.
        Preserves current positions for live parameter changes.
        """
        count_changed = target_config.target_count != self.target_config.target_count
        traj_changed = motion_config.trajectory_type != self.motion_config.trajectory_type

        self.target_config = target_config
        self.motion_config = motion_config

        if count_changed or traj_changed:
            self._build_targets()
        else:
            # Just update visual properties in-place (no position reset)
            for t in self.targets:
                t.shape = target_config.shape
                t.size_pixels = target_config.size_pixels
                t.intensity = target_config.intensity
                if t._generator is not None:
                    t._generator.speed = motion_config.speed_pixels_per_s
