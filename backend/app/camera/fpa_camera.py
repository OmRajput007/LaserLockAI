import math
from typing import Tuple, Optional, List
from backend.app.models.config_model import CameraConfig


class FPACamera:
    """
    Simulates a Monochrome Focal Plane Array (FPA) camera mounted on a 2-axis Pan/Tilt gimbal.
    Features:
    - 640 x 480 Resolution
    - 4.0° x 3.0° Angular FOV
    - Pan/Tilt kinematics with rate limiting (max 5.0°/s) and physical angular limits
    - Rigorous 3D Projective Camera Geometry:
      r_camera = R_x(tilt) * R_y(-pan) * (P_world - C_world)
      pixel_u = cx + fx * (X_c / Z_c)
      pixel_v = cy - fy * (Y_c / Z_c)
    - FOV Frustum and 3D Cone vertex generation
    """

    def __init__(self, config: CameraConfig, world_width: int = 2000, world_height: int = 2000):
        self.config = config
        self.world_width = world_width
        self.world_height = world_height

        self.width = config.resolution_width    # 640
        self.height = config.resolution_height  # 480
        self.fov_h = config.fov_horizontal_deg  # 4.0°
        self.fov_v = config.fov_vertical_deg    # 3.0°

        # Optical center on sensor
        self.cx_px = self.width / 2.0   # 320.0
        self.cy_px = self.height / 2.0  # 240.0

        # Exact pin-hole focal lengths in pixels: fx = (W/2) / tan(FOV_h / 2)
        half_fov_h_rad = math.radians(self.fov_h / 2.0)
        half_fov_v_rad = math.radians(self.fov_v / 2.0)
        self.fx_px = (self.width / 2.0) / math.tan(half_fov_h_rad)
        self.fy_px = (self.height / 2.0) / math.tan(half_fov_v_rad)

        # Camera 3D optical center position
        self.pos_x = config.position_x  # 1000.0
        self.pos_y = config.position_y  # 1000.0
        self.pos_z = config.position_z  # 0.0

        # Gimbal orientation (degrees)
        self.pan_deg = config.initial_pan_deg
        self.tilt_deg = config.initial_tilt_deg

        # Target commanded setpoints (for smooth rate-limited tracking)
        self.target_pan_deg = self.pan_deg
        self.target_tilt_deg = self.tilt_deg

        # Instantaneous rates (deg/s)
        self.pan_rate = 0.0
        self.tilt_rate = 0.0

        # Constraints
        self.max_pan_speed = config.max_pan_speed_deg_s   # 5.0°/s
        self.max_tilt_speed = config.max_tilt_speed_deg_s # 5.0°/s
        self.pan_min = config.pan_min_limit_deg           # -180°
        self.pan_max = config.pan_max_limit_deg           # +180°
        self.tilt_min = config.tilt_min_limit_deg         # -85°
        self.tilt_max = config.tilt_max_limit_deg         # +85°

    def update_config(self, config: CameraConfig):
        """Updates camera optical parameters without clearing current gimbal angles."""
        self.config = config
        self.width = config.resolution_width
        self.height = config.resolution_height
        self.fov_h = config.fov_horizontal_deg
        self.fov_v = config.fov_vertical_deg
        self.cx_px = self.width / 2.0
        self.cy_px = self.height / 2.0
        half_fov_h_rad = math.radians(self.fov_h / 2.0)
        half_fov_v_rad = math.radians(self.fov_v / 2.0)
        self.fx_px = (self.width / 2.0) / math.tan(half_fov_h_rad)
        self.fy_px = (self.height / 2.0) / math.tan(half_fov_v_rad)
        self.max_pan_speed = config.max_pan_speed_deg_s
        self.max_tilt_speed = config.max_tilt_speed_deg_s
        self.pan_min = config.pan_min_limit_deg
        self.pan_max = config.pan_max_limit_deg
        self.tilt_min = config.tilt_min_limit_deg
        self.tilt_max = config.tilt_max_limit_deg

    @property
    def world_boresight(self) -> Tuple[float, float]:
        """Returns 2D (x, y) boresight intersection at nominal depth 1000."""
        bx, by, _ = self.get_world_boresight_at_range(1000.0)
        return bx, by

    def project_world_to_sensor(self, wx: float, wy: float, wz: float = 1000.0) -> Tuple[Optional[float], Optional[float], bool]:
        """Backward-compatible projection method."""
        u, v, in_fov, _, _, _ = self.project_3d_target(wx, wy, wz)
        return u, v, in_fov

    def get_boresight_error(self, wx: float, wy: float, wz: float = 1000.0) -> Tuple[float, float, float, bool]:
        """Backward-compatible boresight error calculation."""
        u, v, in_fov, _, _, _ = self.project_3d_target(wx, wy, wz)
        if u is not None and v is not None:
            err_x = u - self.cx_px
            err_y = v - self.cy_px
            total_err = math.sqrt(err_x ** 2 + err_y ** 2)
            return err_x, err_y, total_err, in_fov
        return 0.0, 0.0, 999.0, False

    def reset(self):
        """Resets gimbal angles to initial configuration."""
        self.pan_deg = self.config.initial_pan_deg
        self.tilt_deg = self.config.initial_tilt_deg
        self.target_pan_deg = self.pan_deg
        self.target_tilt_deg = self.tilt_deg
        self.pan_rate = 0.0
        self.tilt_rate = 0.0

    def set_target_angles(self, pan_deg: float, tilt_deg: float):
        """Commands a target gimbal angle setpoint, clamped to physical limits."""
        self.target_pan_deg = max(self.pan_min, min(self.pan_max, pan_deg))
        self.target_tilt_deg = max(self.tilt_min, min(self.tilt_max, tilt_deg))

    def set_angles(self, pan_deg: float, tilt_deg: float):
        """Immediately sets gimbal angles (e.g. for scenario initialization or testing)."""
        self.pan_deg = max(self.pan_min, min(self.pan_max, pan_deg))
        self.tilt_deg = max(self.tilt_min, min(self.tilt_max, tilt_deg))
        self.target_pan_deg = self.pan_deg
        self.target_tilt_deg = self.tilt_deg
        self.pan_rate = 0.0
        self.tilt_rate = 0.0

    def apply_rate_command(self, d_pan_deg_s: float, d_tilt_deg_s: float):
        """Sets operator manual slew rates or closed-loop PID rate commands, clamped to maximum slew speeds."""
        self.pan_rate = max(-self.max_pan_speed, min(self.max_pan_speed, d_pan_deg_s))
        self.tilt_rate = max(-self.max_tilt_speed, min(self.max_tilt_speed, d_tilt_deg_s))
        self.target_pan_deg = self.pan_deg
        self.target_tilt_deg = self.tilt_deg

    def update_kinematics(self, dt: float):
        """
        Advances gimbal actuator dynamics by dt.
        If a target angle setpoint is set, slews toward target at max speed (rate-limited).
        If a direct rate command is active, integrates velocity clamped to physical stops.
        """
        # 1. Closed-loop slew towards target setpoint if differ
        pan_diff = self.target_pan_deg - self.pan_deg
        if abs(pan_diff) > 0.001:
            step = math.copysign(min(abs(pan_diff), self.max_pan_speed * dt), pan_diff)
            self.pan_deg += step
            self.pan_rate = step / max(0.0001, dt)
        elif abs(self.pan_rate) > 0.0:
            self.pan_deg += self.pan_rate * dt
            self.target_pan_deg = self.pan_deg

        tilt_diff = self.target_tilt_deg - self.tilt_deg
        if abs(tilt_diff) > 0.001:
            step = math.copysign(min(abs(tilt_diff), self.max_tilt_speed * dt), tilt_diff)
            self.tilt_deg += step
            self.tilt_rate = step / max(0.0001, dt)
        elif abs(self.tilt_rate) > 0.0:
            self.tilt_deg += self.tilt_rate * dt
            self.target_tilt_deg = self.tilt_deg

        # Enforce physical mechanical limit stops
        if self.pan_deg < self.pan_min:
            self.pan_deg = self.pan_min
            self.pan_rate = 0.0
        elif self.pan_deg > self.pan_max:
            self.pan_deg = self.pan_max
            self.pan_rate = 0.0

        if self.tilt_deg < self.tilt_min:
            self.tilt_deg = self.tilt_min
            self.tilt_rate = 0.0
        elif self.tilt_deg > self.tilt_max:
            self.tilt_deg = self.tilt_max
            self.tilt_rate = 0.0

    def world_to_camera_transform(self, wx: float, wy: float, wz: float) -> Tuple[float, float, float]:
        """
        Transforms a 3D world coordinate (wx, wy, wz) into the Camera Coordinate Frame (Xc, Yc, Zc).
        Camera Frame definition:
        - +Zc: Optical boresight axis (depth forward into scene)
        - +Xc: Camera right axis (horizontal)
        - +Yc: Camera up axis (vertical)
        """
        # Relative translation from camera aperture
        dx = wx - self.pos_x
        dy = wy - self.pos_y
        dz = wz - self.pos_z

        pan_rad = math.radians(self.pan_deg)
        tilt_rad = math.radians(self.tilt_deg)

        # 1. Rotate about Y axis by -pan (Azimuth)
        # x1 =  dx * cos(pan) - dz * sin(pan)
        # z1 =  dx * sin(pan) + dz * cos(pan)
        x1 = dx * math.cos(pan_rad) - dz * math.sin(pan_rad)
        y1 = dy
        z1 = dx * math.sin(pan_rad) + dz * math.cos(pan_rad)

        # 2. Rotate about X axis by +tilt (Elevation)
        # Yc = y1 * cos(tilt) - z1 * sin(tilt)
        # Zc = y1 * sin(tilt) + z1 * cos(tilt)
        xc = x1
        yc = y1 * math.cos(tilt_rad) - z1 * math.sin(tilt_rad)
        zc = y1 * math.sin(tilt_rad) + z1 * math.cos(tilt_rad)

        return xc, yc, zc

    def project_3d_target(self, wx: float, wy: float, wz: float) -> Tuple[
        Optional[float],  # pixel_u (0..640)
        Optional[float],  # pixel_v (0..480)
        bool,             # is_in_fov
        float,            # azimuth_cam_deg
        float,            # elevation_cam_deg
        float,            # range_z_cam
    ]:
        """
        Projects a 3D target onto the 640x480 Focal Plane Array using true pin-hole optics.
        Returns:
            pixel_u, pixel_v, is_in_fov, azimuth_deg, elevation_deg, depth
        """
        xc, yc, zc = self.world_to_camera_transform(wx, wy, wz)

        # 1. Check if target is in front of the lens (zc > 0)
        if zc <= 0.01:
            # Target is behind the camera
            az_deg = math.degrees(math.atan2(xc, max(0.0001, zc)))
            el_deg = math.degrees(math.atan2(yc, max(0.0001, zc)))
            return None, None, False, az_deg, el_deg, zc

        # 2. Compute angular bearing in camera frame
        az_deg = math.degrees(math.atan2(xc, zc))
        el_deg = math.degrees(math.atan2(yc, zc))

        # 3. Pin-hole projection to FPA pixels
        # u = cx + fx * (xc / zc)
        # v = cy - fy * (yc / zc)  (minus sign: row index 0 is top)
        u = self.cx_px + self.fx_px * (xc / zc)
        v = self.cy_px - self.fy_px * (yc / zc)

        # 4. Rigorous FOV check (both angular and sensor boundary check)
        half_fov_h = self.fov_h / 2.0
        half_fov_v = self.fov_v / 2.0
        is_in_angular_fov = (abs(az_deg) <= half_fov_h) and (abs(el_deg) <= half_fov_v)
        is_in_sensor_bounds = (0.0 <= u <= float(self.width)) and (0.0 <= v <= float(self.height))

        is_in_fov = is_in_angular_fov and is_in_sensor_bounds

        if is_in_fov:
            return round(u, 2), round(v, 2), True, round(az_deg, 3), round(el_deg, 3), round(zc, 2)
        else:
            return round(u, 2), round(v, 2), False, round(az_deg, 3), round(el_deg, 3), round(zc, 2)

    def get_world_boresight_at_range(self, range_distance: float = 1000.0) -> Tuple[float, float, float]:
        """Calculates 3D world position where the optical boresight intersects at range_distance."""
        pan_rad = math.radians(self.pan_deg)
        tilt_rad = math.radians(self.tilt_deg)

        # Forward line-of-sight unit vector in world frame
        # In camera frame: [0, 0, 1]
        # In world frame:
        # dx = range * sin(pan) * cos(tilt)
        # dy = range * sin(tilt)
        # dz = range * cos(pan) * cos(tilt)
        bx = self.pos_x + range_distance * math.sin(pan_rad) * math.cos(tilt_rad)
        by = self.pos_y + range_distance * math.sin(tilt_rad)
        bz = self.pos_z + range_distance * math.cos(pan_rad) * math.cos(tilt_rad)
        return bx, by, bz

    def get_frustum_corners_at_range(self, range_distance: float = 1000.0) -> List[List[float]]:
        """
        Calculates the 4 corner coordinates in 3D world space of the rectangular FOV cone at range_distance.
        Order: Top-Left, Top-Right, Bottom-Right, Bottom-Left
        """
        half_w_cam = range_distance * math.tan(math.radians(self.fov_h / 2.0))
        half_h_cam = range_distance * math.tan(math.radians(self.fov_v / 2.0))

        camera_corners = [
            (-half_w_cam,  half_h_cam, range_distance), # Top-Left
            ( half_w_cam,  half_h_cam, range_distance), # Top-Right
            ( half_w_cam, -half_h_cam, range_distance), # Bottom-Right
            (-half_w_cam, -half_h_cam, range_distance), # Bottom-Left
        ]

        pan_rad = math.radians(self.pan_deg)
        tilt_rad = math.radians(self.tilt_deg)

        world_corners = []
        for xc, yc, zc in camera_corners:
            # Inverse rotate: first about X by -tilt, then about Y by +pan
            y1 = yc * math.cos(tilt_rad) + zc * math.sin(tilt_rad)
            z1 = -yc * math.sin(tilt_rad) + zc * math.cos(tilt_rad)
            x1 = xc

            wx = self.pos_x + (x1 * math.cos(pan_rad) + z1 * math.sin(pan_rad))
            wy = self.pos_y + y1
            wz = self.pos_z + (-x1 * math.sin(pan_rad) + z1 * math.cos(pan_rad))
            world_corners.append([round(wx, 2), round(wy, 2), round(wz, 2)])

        return world_corners
