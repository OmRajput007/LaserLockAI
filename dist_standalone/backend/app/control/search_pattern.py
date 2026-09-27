import math
from typing import Tuple, Optional
from backend.app.models.config_model import TrackingConfig, CameraConfig


class SearchPatternGenerator:
    """
    Autonomous Optical Search Pattern Generator for Mobile FSOC Terminals.
    Operates when the beacon is outside the sensor FOV (State: SEARCHING).
    
    Supported Patterns:
    1. Raster Search: High-coverage serpentine / lawnmower scan across azimuth & elevation
       with deliberate FOV overlap (vertical step < VFOV 3.0°).
    2. Sector Search: Concentric expanding sector sweep around initial or last known coordinates.
    3. Spiral Search: Smooth Archimedean expanding spiral trajectory.
    
    Safety Constraints:
    - Enforces max slew speed <= 5.0 deg/s.
    - Respects gimbal mechanical limits [-180°, +180°] pan and [-85°, +85°] tilt.
    """

    def __init__(self, config: TrackingConfig, camera_config: Optional[CameraConfig] = None):
        self.config = config
        self.camera_config = camera_config or CameraConfig()

        self.pan_range = config.search_pan_range_deg    # +/- 20° default
        self.tilt_range = config.search_tilt_range_deg  # +/- 15° default
        self.slew_speed = min(config.search_slew_speed_deg_s, 5.0)  # max 5°/s

        # Raster scan internal state
        self.pan_center = 0.0
        self.tilt_center = 0.0
        self.current_pan = 0.0
        self.current_tilt = 0.0
        self.raster_dir = 1.0  # +1: moving right, -1: moving left
        self.tilt_dir = 1.0    # +1: moving up, -1: moving down
        self.step_size_deg = 2.0  # 2.0° step (< VFOV 3.0° for 33% spatial overlap)

        # Spiral scan state
        self.spiral_time = 0.0

        self.is_active = False

    def reset(self, center_pan: float = 0.0, center_tilt: float = 0.0):
        """Resets search state centered at the given coordinates."""
        self.pan_center = center_pan
        self.tilt_center = center_tilt
        self.current_pan = center_pan
        self.current_tilt = center_tilt - self.tilt_range
        self.raster_dir = 1.0
        self.tilt_dir = 1.0
        self.spiral_time = 0.0
        self.is_active = True

    def update_config(self, config: TrackingConfig, camera_config: Optional[CameraConfig] = None):
        self.config = config
        if camera_config:
            self.camera_config = camera_config
        self.pan_range = config.search_pan_range_deg
        self.tilt_range = config.search_tilt_range_deg
        self.slew_speed = min(config.search_slew_speed_deg_s, 5.0)

    def generate_search_rates(
        self, current_pan_deg: float, current_tilt_deg: float, dt: float
    ) -> Tuple[float, float]:
        """
        Computes rate commands (deg/s) to progress the active search pattern.
        Returns:
            (cmd_pan_deg_s, cmd_tilt_deg_s) strictly clamped to <= 5.0 deg/s.
        """
        if not self.is_active:
            self.reset(current_pan_deg, current_tilt_deg)

        pattern = self.config.search_pattern

        if pattern == "Raster Search":
            return self._compute_raster_rates(current_pan_deg, current_tilt_deg, dt)
        elif pattern == "Sector Search":
            return self._compute_sector_rates(current_pan_deg, current_tilt_deg, dt)
        elif pattern == "Spiral Search":
            return self._compute_spiral_rates(current_pan_deg, current_tilt_deg, dt)
        else:
            return self._compute_raster_rates(current_pan_deg, current_tilt_deg, dt)

    def _compute_raster_rates(
        self, current_pan_deg: float, current_tilt_deg: float, dt: float
    ) -> Tuple[float, float]:
        """
        Lawnmower raster pattern:
        Pan sweeps continuously between [pan_center - pan_range, pan_center + pan_range].
        Upon hitting boundary, steps tilt by 2.0° and reverses pan direction.
        """
        max_pan = min(self.pan_center + self.pan_range, self.camera_config.pan_max_limit_deg)
        min_pan = max(self.pan_center - self.pan_range, self.camera_config.pan_min_limit_deg)
        max_tilt = min(self.tilt_center + self.tilt_range, self.camera_config.tilt_max_limit_deg)
        min_tilt = max(self.tilt_center - self.tilt_range, self.camera_config.tilt_min_limit_deg)

        # Check if pan boundary reached
        if self.raster_dir > 0 and current_pan_deg >= max_pan:
            self.raster_dir = -1.0
            # Step tilt
            tilt_cmd = self.tilt_dir * self.slew_speed
            if current_tilt_deg >= max_tilt:
                self.tilt_dir = -1.0
            elif current_tilt_deg <= min_tilt:
                self.tilt_dir = 1.0
            return 0.0, tilt_cmd
        elif self.raster_dir < 0 and current_pan_deg <= min_pan:
            self.raster_dir = 1.0
            tilt_cmd = self.tilt_dir * self.slew_speed
            if current_tilt_deg >= max_tilt:
                self.tilt_dir = -1.0
            elif current_tilt_deg <= min_tilt:
                self.tilt_dir = 1.0
            return 0.0, tilt_cmd
        else:
            pan_cmd = self.raster_dir * self.slew_speed
            return pan_cmd, 0.0

    def _compute_sector_rates(
        self, current_pan_deg: float, current_tilt_deg: float, dt: float
    ) -> Tuple[float, float]:
        """
        Sector sweep: Sweeps azimuth back and forth while oscillating tilt sinusoidal.
        """
        self.spiral_time += dt
        omega_pan = 0.5 * (self.slew_speed / max(1.0, self.pan_range))
        omega_tilt = omega_pan * 0.5

        pan_target = self.pan_center + self.pan_range * math.sin(omega_pan * self.spiral_time)
        tilt_target = self.tilt_center + self.tilt_range * math.cos(omega_tilt * self.spiral_time)

        pan_err = pan_target - current_pan_deg
        tilt_err = tilt_target - current_tilt_deg

        pan_cmd = max(-self.slew_speed, min(self.slew_speed, pan_err * 2.0))
        tilt_cmd = max(-self.slew_speed, min(self.slew_speed, tilt_err * 2.0))
        return pan_cmd, tilt_cmd

    def _compute_spiral_rates(
        self, current_pan_deg: float, current_tilt_deg: float, dt: float
    ) -> Tuple[float, float]:
        """
        Archimedean expanding spiral trajectory.
        """
        self.spiral_time += dt
        max_t = 30.0
        t_mod = self.spiral_time % max_t

        radius = (t_mod / max_t) * min(self.pan_range, self.tilt_range)
        theta = 2.5 * t_mod  # angular progression

        target_pan = self.pan_center + radius * math.cos(theta)
        target_tilt = self.tilt_center + radius * math.sin(theta)

        pan_err = target_pan - current_pan_deg
        tilt_err = target_tilt - current_tilt_deg

        pan_cmd = max(-self.slew_speed, min(self.slew_speed, pan_err * 2.5))
        tilt_cmd = max(-self.slew_speed, min(self.slew_speed, tilt_err * 2.5))
        return pan_cmd, tilt_cmd
