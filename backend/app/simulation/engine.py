import time
import math
import cv2
import numpy as np
from typing import Optional, Tuple, List, Dict, Any

from backend.app.models.config_model import SystemConfig
from backend.app.models.telemetry_model import (
    SimulationTelemetry,
    TargetState,
    CameraState,
    TrackingTelemetry,
    DisturbanceTelemetry,
    DetectionTelemetry,
)
from backend.app.camera.fpa_camera import FPACamera
from backend.app.target.beacon import TargetManager, BeaconTarget
from backend.app.tracking.kalman_tracker import KalmanTracker
from backend.app.detection.detection_manager import DetectionManager
from backend.app.control.pid_controller import GimbalPIDController
from backend.app.disturbances.optical_disturbance_engine import OpticalDisturbanceEngine
from backend.app.analytics.metrics_base import AnalyticsEngine
from backend.app.orbital.scenario import OrbitalScenario, OrbitalScenarioConfig, OrbitalTelemetry
from backend.app.orbital.handover import HandoverConfig


class SimulationEngine:
    """
    Virtual testbench simulation engine for FSOC Mobile Terminal Coarse Alignment.
    Integrates:
    - 3D kinematic target simulation
    - 3D projective camera model with slew rate limits (5°/s)
    - Unified Detection Subsystem: Classical CV, AI Detector, CV+Kalman, AI+Kalman
    - Target Identification & False Bright Object Rejection
    - Closed-Loop Kalman Target Tracking & Full PAT State Machine
    - Continuous Closed-Loop 2-Axis PID Gimbal Pointing & Autonomous Search Patterns
    - Part 6 Disturbance & Multi-Noise Engine (Jitter, Atmosphere, Platform Motion, Noise)
    - Real-time telemetry streaming and HUD visualization
    """

    def __init__(self, config: SystemConfig):
        self.config = config
        self.is_running = False
        self.is_isolated = False
        self._cached_isolated_telem: Optional[Any] = None
        self.frame_number = 0
        self.sim_time = 0.0
        self.dt = 1.0 / config.camera.update_rate_hz  # 0.0333s for 30 Hz

        # 3D Camera & Target subsystems
        self.camera = FPACamera(config.camera)
        self.target_manager = TargetManager(config.target, config.motion)

        # Unified Detection Subsystem (Part 4)
        self.detector = DetectionManager(config.detection, config.camera)

        # Part 5: Closed-Loop Kalman Tracking & 2-Axis PID Controller
        self.tracker = KalmanTracker(config.tracking, config.camera)
        self.controller = GimbalPIDController(config.control)

        # Part 6: Physical Disturbance & Multi-Noise Engine
        self.disturbance = OpticalDisturbanceEngine(config.disturbance, config.camera)
        self.last_disturbance_telemetry = DisturbanceTelemetry()
        self.last_effective_intensity = float(config.target.intensity)
        self._last_jit_dx: float = 0.0
        self._last_jit_dy: float = 0.0

        self.analytics = AnalyticsEngine(config.performance)

        self.last_step_wall_time = time.time()
        self.measured_fps = config.camera.update_rate_hz
        self._current_frame: Optional[np.ndarray] = None
        self._scratch_float32: np.ndarray = np.empty((self.camera.height, self.camera.width), dtype=np.float32)
        self._scratch_float32_color: np.ndarray = np.empty((self.camera.height, self.camera.width, 3), dtype=np.float32)
        self._last_raw_jpeg: Optional[Tuple[int, bytes]] = None
        self._last_annotated_jpeg: Optional[Tuple[int, bytes]] = None
        self._last_annotated_no_telem_jpeg: Optional[Tuple[int, bytes]] = None
        self.last_tracking_telemetry: Optional[TrackingTelemetry] = None
        self.last_detection_telemetry: Optional[DetectionTelemetry] = None

        # Adaptive pursuit: ramp slew speed when target is lost
        self._lost_time: float = 0.0          # seconds spent in LOST / SEARCHING state
        self._adaptive_speed_factor: float = 1.0  # current multiplier on max slew speed
        self.ADAPTIVE_MAX_FACTOR: float = 4.0  # cap at 4× nominal slew speed
        self.ADAPTIVE_RAMP_TIME_S: float = 3.0 # time to reach max factor from 1×

        # Orbital Scenario physics layer (Part 1 & 2)
        self.orbital_scenario = OrbitalScenario()
        self.orbital_time_warp: float = 1.0
        self.last_orbital_telemetry: Optional[dict] = self.orbital_scenario.step(0.0).to_dict()
        self.scenario_mode: str = "Local"  # "Local" or "Orbital"
        # Last tracking state (for passing to orbital scenario handover manager)
        self._last_pat_state: str = "SEARCHING"

    def set_scenario_mode(self, mode: str):
        """Sets scenario mode: 'Local' or 'Orbital'."""
        self.scenario_mode = "Orbital" if mode.lower() == "orbital" else "Local"
        self.analytics.scenario_type = self.scenario_mode

    def update_config(self, new_config: SystemConfig, reset_state: bool = False):
        """Applies updated configuration parameters to all subsystems without resetting state unless requested."""
        self.config = new_config
        self.dt = 1.0 / new_config.camera.update_rate_hz
        self.camera.update_config(new_config.camera)
        self.target_manager.update_config(new_config.target, new_config.motion)
        self.detector.update_config(new_config.detection, new_config.camera)
        self.tracker.update_config(new_config.tracking, new_config.camera)
        self.controller.update_config(new_config.control)
        self.disturbance.update_config(new_config.disturbance, new_config.camera)
        if reset_state:
            self.analytics = AnalyticsEngine(new_config.performance)
            self.reset()

    def reset(self):
        """Resets the simulation testbench to initial conditions."""
        self.sim_time = 0.0
        self.frame_number = 0
        self.camera.reset()
        self.target_manager.reset()
        self.detector.reset()
        self.tracker.reset()
        self.controller.reset()
        self.analytics.reset()
        self._current_frame = None
        self._last_raw_jpeg = None
        self._last_annotated_jpeg = None
        self._last_annotated_no_telem_jpeg = None
        self.last_step_wall_time = time.time()
        self._lost_time = 0.0
        self._adaptive_speed_factor = 1.0
        self.orbital_scenario.reset()
        self.last_orbital_telemetry = self.orbital_scenario.step(0.0).to_dict()
        self._last_pat_state = "SEARCHING"
        if self.scenario_mode == "Orbital" and self.last_orbital_telemetry:
            link = self.last_orbital_telemetry.get("link", {})
            init_az = float(link.get("az_body_deg", 0.0))
            init_el = float(link.get("el_body_deg", 0.0))
            self.camera.pan_deg = init_az
            self.camera.tilt_deg = init_el
            self.camera.target_pan_deg = init_az
            self.camera.target_tilt_deg = init_el

    def start(self):
        """Starts the simulation clock and active stepping."""
        self.is_running = True

    def stop(self):
        """Stops/pauses the simulation testbench."""
        self.is_running = False

    def set_gimbal_target_angles(self, pan_deg: float, tilt_deg: float):
        """Commands a target gimbal angle setpoint for the camera pan/tilt sliders."""
        self.camera.set_target_angles(pan_deg, tilt_deg)

    def set_manual_gimbal_rates(self, pan_rate: float, tilt_rate: float):
        """Commands instantaneous pan/tilt slew rates for nudges (max 5°/s)."""
        self.camera.apply_rate_command(pan_rate, tilt_rate)

    def get_instantaneous_intensity(self, base_intensity: float) -> float:
        """
        Calculates instantaneous beacon intensity incorporating periodic optical flicker modulation.
        I(t) = I0 * [1 + m * sin(2π * f * t)]
        """
        if not self.config.target.flicker_enabled:
            return base_intensity
        f_hz = self.config.target.flicker_frequency_hz
        m = self.config.target.flicker_depth
        mod = 1.0 + m * math.sin(2.0 * math.pi * f_hz * self.sim_time)
        return float(np.clip(base_intensity * mod, 0.0, 255.0))

    def _inject_false_bright_objects(self, frame: np.ndarray):
        """
        Injects realistic synthetic false bright objects (glints, cloud edges, hot pixels)
        to enable testing of the Target Identification and Clutter Rejection engine.
        """
        h, w = frame.shape[:2]
        is_color = (frame.ndim == 3 and frame.shape[2] == 3)
        count = self.config.detection.false_bright_object_count

        # Object 1: Large solar glint / saturated reflection (22x22 = 484 px², fails size consistency)
        gx, gy, gsz = 160, 130, 22
        if 0 <= gx + gsz < w and 0 <= gy + gsz < h:
            if not is_color:
                frame[gy:gy+gsz, gx:gx+gsz] = np.maximum(frame[gy:gy+gsz, gx:gx+gsz], 245)
            else:
                frame[gy:gy+gsz, gx:gx+gsz] = np.maximum(frame[gy:gy+gsz, gx:gx+gsz], [240, 240, 240])

        if count >= 2:
            # Object 2: Secondary solar glint / cloud reflection (16x16 = 256 px², fails optical spot size)
            gx2, gy2, gsz2 = 450, 310, 16
            if 0 <= gx2 + gsz2 < w and 0 <= gy2 + gsz2 < h:
                if not is_color:
                    frame[gy2:gy2+gsz2, gx2:gx2+gsz2] = np.maximum(frame[gy2:gy2+gsz2, gx2:gx2+gsz2], 240)
                else:
                    frame[gy2:gy2+gsz2, gx2:gx2+gsz2] = np.maximum(frame[gy2:gy2+gsz2, gx2:gx2+gsz2], [240, 240, 240])

        if count >= 3:
            # Object 3: Elongated stray scratch reflection (25x4 = 100 px², fails circularity / aspect ratio)
            ex, ey = 420, 180
            if 0 <= ex + 25 < w and 0 <= ey + 4 < h:
                if not is_color:
                    frame[ey:ey+4, ex:ex+25] = 235
                else:
                    frame[ey:ey+4, ex:ex+25] = [235, 235, 235]

    def generate_raw_fpa_frame(self, dt: Optional[float] = None) -> np.ndarray:
        """
        Generates an actual 640x480 camera frame using OpenCV and NumPy.
        Supports:
        - Sensor baseline background level (ambient irradiance)
        - Gaussian sensor readout noise
        - Beacon optical spot geometry (Square, Circle, Gaussian)
        - Temporal optical flicker modulation
        - Color mode (Monochrome default, or Colour)
        - Strict FOV clipping: targets outside the camera FOV are NOT rendered!
        - False bright object injection for Target Identification testing
        - Part 6 Disturbance Chain: Camera Jitter, Platform Motion, Atmospheric Radiative Transfer,
          Motion Blur, Temporary Occlusion, Multi-Noise (Gaussian, S&P, Poisson).
        """
        delta_t = dt if dt is not None else self.dt

        # If isolated mode is engaged and a frame exists, return it without re-rendering
        if getattr(self, "is_isolated", False) and self._current_frame is not None:
            return self._current_frame
        h = self.camera.height
        w = self.camera.width
        is_color = (self.config.camera.color_mode == "Colour")
        bg_level = float(self.config.target.background_level)
        noise_sigma = float(self.config.target.noise_sigma)

        # 1. Base sensor background with baseline readout noise
        if not is_color:
            if noise_sigma > 0.01:
                if self._scratch_float32.shape != (h, w):
                    self._scratch_float32 = np.empty((h, w), dtype=np.float32)
                std_norm = np.random.standard_normal(size=(h, w)).astype(np.float32)
                np.multiply(std_norm, noise_sigma, out=self._scratch_float32)
                np.add(self._scratch_float32, bg_level, out=self._scratch_float32)
                np.clip(self._scratch_float32, 0.0, 255.0, out=self._scratch_float32)
                frame = np.empty((h, w), dtype=np.uint8)
                frame[:] = self._scratch_float32
            else:
                frame = np.full((h, w), int(round(bg_level)), dtype=np.uint8)
        else:
            if noise_sigma > 0.01:
                if self._scratch_float32_color.shape != (h, w, 3):
                    self._scratch_float32_color = np.empty((h, w, 3), dtype=np.float32)
                std_norm = np.random.standard_normal(size=(h, w, 3)).astype(np.float32)
                np.multiply(std_norm, noise_sigma, out=self._scratch_float32_color)
                np.add(self._scratch_float32_color, bg_level, out=self._scratch_float32_color)
                np.clip(self._scratch_float32_color, 0.0, 255.0, out=self._scratch_float32_color)
                frame = np.empty((h, w, 3), dtype=np.uint8)
                frame[:] = self._scratch_float32_color
            else:
                frame = np.full((h, w, 3), int(round(bg_level)), dtype=np.uint8)

        # 2. Advance disturbance temporal kinematics (Jitter, Platform motion, Shock)
        jit_dx, jit_dy = self.disturbance.step_temporal_kinematics(delta_t)
        self._last_jit_dx = jit_dx
        self._last_jit_dy = jit_dy

        primary = self.target_manager.primary_target
        primary_u_eff: Optional[float] = None
        primary_v_eff: Optional[float] = None

        if self.scenario_mode == "Orbital":
            link = self.last_orbital_telemetry.get("link", {}) if self.last_orbital_telemetry else {}
            range_km = float(link.get("range_km", 1000.0))
            target_depth = range_km * 1000.0
            az_body = float(link.get("az_body_deg", 0.0))
            el_body = float(link.get("el_body_deg", 0.0))
            link_state = link.get("link_state", "LINK_OK")
            intensity_frac = float(link.get("intensity_fraction", 1.0))
            atmosphere_path_frac = float(link.get("atmosphere_path_frac", 0.0))

            # Beacon intensity scaling per Part 1 rule with receiver AGC contrast preservation
            # (530 km reference = 1.0, scaled with 0.35 minimum AGC floor above detector noise floor)
            scaled_fraction = 0.35 + 0.65 * intensity_frac
            raw_intensity = self.get_instantaneous_intensity(primary.intensity) * scaled_fraction
            if self.config.disturbance.beacon_flicker_enabled:
                f_flicker = self.config.disturbance.beacon_flicker_frequency_hz
                d_flicker = self.config.disturbance.beacon_flicker_depth
                mod = 1.0 - d_flicker + d_flicker * (0.5 + 0.5 * math.sin(2.0 * math.pi * f_flicker * self.sim_time))
                raw_intensity *= mod

            # If LINK_BLOCKED or NO_COVERAGE, Earth occludes beacon - do NOT render!
            if link_state not in ("LINK_BLOCKED", "NO_COVERAGE"):
                u, v, in_fov, _, _ = self.camera.project_orbital_beacon(az_body, el_body)
                if in_fov and u is not None and v is not None:
                    u_eff = u + jit_dx
                    v_eff = v + jit_dy
                    primary_u_eff = u_eff
                    primary_v_eff = v_eff

                    if 0 <= u_eff <= w and 0 <= v_eff <= h and not self.disturbance.is_occluded:
                        _, _, _, eff_i = self.disturbance.compute_atmospheric_effects(
                            raw_intensity, target_depth, atmosphere_path_frac=atmosphere_path_frac
                        )
                        primary.render_to_frame(frame, u_eff, v_eff, intensity_override=eff_i)
        else:
            tx, ty, tz = primary.get_position()
            target_depth = tz if tz > 0 else 1000.0
            atmosphere_path_frac = 1.0

            # Beacon flicker modulation
            raw_intensity = self.get_instantaneous_intensity(primary.intensity)
            if self.config.disturbance.beacon_flicker_enabled:
                f_flicker = self.config.disturbance.beacon_flicker_frequency_hz
                d_flicker = self.config.disturbance.beacon_flicker_depth
                mod = 1.0 - d_flicker + d_flicker * (0.5 + 0.5 * math.sin(2.0 * math.pi * f_flicker * self.sim_time))
                raw_intensity *= mod

            # Render all active targets strictly inside camera FOV with jitter/platform displacement
            for t in self.target_manager.targets:
                ptx, pty, ptz = t.get_position()
                u, v, in_fov, _, _, _ = self.camera.project_3d_target(ptx, pty, ptz)

                if in_fov and u is not None and v is not None:
                    u_eff = u + jit_dx
                    v_eff = v + jit_dy

                    if t.target_id == primary.target_id:
                        primary_u_eff = u_eff
                        primary_v_eff = v_eff

                    if 0 <= u_eff <= w and 0 <= v_eff <= h and not self.disturbance.is_occluded:
                        t_depth = ptz if ptz > 0 else 1000.0
                        _, _, _, eff_i = self.disturbance.compute_atmospheric_effects(
                            raw_intensity, t_depth, atmosphere_path_frac=1.0
                        )
                        t.render_to_frame(frame, u_eff, v_eff, intensity_override=eff_i)

        # 4. Optional synthetic false bright objects (glints/reflections) for rejection testing
        if self.config.detection.inject_false_bright_objects:
            self._inject_false_bright_objects(frame)

        # 5. Process frame through physical optical disturbance engine
        disturbed_frame, eff_intensity, dist_telem = self.disturbance.process_frame(
            raw_frame=frame,
            beacon_u=primary_u_eff,
            beacon_v=primary_v_eff,
            beacon_intensity=raw_intensity,
            depth_m=target_depth,
            pan_rate=self.camera.pan_rate,
            tilt_rate=self.camera.tilt_rate,
            dt=delta_t,
            atmosphere_path_frac=atmosphere_path_frac,
        )

        self.last_disturbance_telemetry = dist_telem
        self.last_effective_intensity = eff_intensity
        self._current_frame = disturbed_frame
        return disturbed_frame

    def render_fpa_frame(self, annotated: bool = False, show_telemetry: bool = True) -> np.ndarray:
        """
        Returns the camera frame.
        If annotated=True, overlays camera crosshairs, detected bounding box,
        centroid marker, error vector, Kalman predictions, and tracking HUD metrics.
        If show_telemetry=False, HUD info panel and tracking text readouts are omitted.
        """
        if self._current_frame is None:
            self.generate_raw_fpa_frame()

        if annotated:
            return self.detector.annotate_frame(
                self._current_frame,
                self.detector.last_telemetry,
                tracking=self.last_tracking_telemetry,
                show_telemetry=show_telemetry,
            )
        return self._current_frame

    def get_encoded_frame(self, annotated: bool = False, quality: int = 80, show_telemetry: bool = True) -> bytes:
        """
        Returns compressed JPEG bytes for the current simulation frame.
        Caches encoded bytes by frame_number to eliminate duplicate cv2.imencode overhead
        when multiple streams, viewports, or snapshot requests occur on the same frame.
        """
        curr_frame_num = self.frame_number
        if annotated:
            if not show_telemetry:
                if self._last_annotated_no_telem_jpeg is not None and self._last_annotated_no_telem_jpeg[0] == curr_frame_num:
                    return self._last_annotated_no_telem_jpeg[1]
                frame = self.render_fpa_frame(annotated=True, show_telemetry=False)
                ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
                if ok:
                    b = buf.tobytes()
                    self._last_annotated_no_telem_jpeg = (curr_frame_num, b)
                    return b
            else:
                if self._last_annotated_jpeg is not None and self._last_annotated_jpeg[0] == curr_frame_num:
                    return self._last_annotated_jpeg[1]
                frame = self.render_fpa_frame(annotated=True, show_telemetry=True)
                ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
                if ok:
                    b = buf.tobytes()
                    self._last_annotated_jpeg = (curr_frame_num, b)
                    return b
        else:
            if self._last_raw_jpeg is not None and self._last_raw_jpeg[0] == curr_frame_num:
                return self._last_raw_jpeg[1]
            frame = self.render_fpa_frame(annotated=False)
            ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
            if ok:
                b = buf.tobytes()
                self._last_raw_jpeg = (curr_frame_num, b)
                return b
        raise RuntimeError("Failed to encode FPA frame to JPEG")

    def step(self, dt: Optional[float] = None) -> SimulationTelemetry:
        """
        Executes a discrete simulation step:
        1. Advances target kinematics (position, velocity, acceleration in 3D).
        2. Advances camera gimbal orientation respecting max 5°/s slew speed.
        3. Projects target into 3D camera frame and calculates FOV intersection.
        4. Generates actual camera frame with noise, jitter, and atmospheric transfer.
        5. Runs computer vision detection on the frame (WITHOUT ground-truth coordinates).
        6. Runs Kalman tracking filter & PAT state machine (SEARCHING, ACQUIRING, TRACKING, LOCKED, LOST, REACQUIRING).
        7. Computes continuous closed-loop PID gimbal rates or autonomous search rates (<= 5°/s).
        8. Computes center pixel error, angular error, confidence, and telemetry.
        """
        delta_t = dt if dt is not None else self.dt

        # If isolated mode is engaged, return cached telemetry immediately to eliminate CPU/GPU overhead
        if getattr(self, "is_isolated", False) and getattr(self, "_cached_isolated_telem", None) is not None:
            return self._cached_isolated_telem

        # FPS calculation
        now = time.time()
        wall_dt = now - self.last_step_wall_time
        if wall_dt > 0.0001:
            self.measured_fps = round(1.0 / wall_dt, 1)
        self.last_step_wall_time = now

        # 1. Kinematics step
        if self.scenario_mode == "Orbital":
            if delta_t > 0:
                self.sim_time += delta_t
                self.frame_number += 1
                self.camera.update_kinematics(delta_t)

            orb_dt = delta_t if self.is_running else (delta_t * self.orbital_time_warp if delta_t > 0 else 0.0)
            # Pass current PAT state so handover manager can correct the badge
            orb_telem = self.orbital_scenario.step(orb_dt, pat_state=self._last_pat_state)
            self.last_orbital_telemetry = orb_telem.to_dict()
            link = self.last_orbital_telemetry.get("link", {})
            range_km = float(link.get("range_km", 1000.0))
            target_depth = range_km * 1000.0
            az_body = float(link.get("az_body_deg", 0.0))
            el_body = float(link.get("el_body_deg", 0.0))
            link_state = link.get("link_state", "LINK_OK")
            # Handover can override link_state to NO_COVERAGE
            handover_dict = self.last_orbital_telemetry.get("handover")
            if handover_dict is not None:
                link_state = handover_dict.get("link_state", link_state)
            is_link_blocked = (link_state in ("LINK_BLOCKED", "NO_COVERAGE"))
            angular_rate_deg_s = float(link.get("angular_rate_deg_s", 0.0))
            atmosphere_path_frac = float(link.get("atmosphere_path_frac", 0.0))

            u_gt, v_gt, in_fov_gt, delta_az, delta_el = self.camera.project_orbital_beacon(az_body, el_body)
            if is_link_blocked:
                in_fov_gt = False
                u_gt = None
                v_gt = None
        else:
            if delta_t > 0:
                self.target_manager.update(delta_t)
                self.camera.update_kinematics(delta_t)
                self.sim_time += delta_t
                self.frame_number += 1

            if not self.is_running:
                orb_dt = delta_t * self.orbital_time_warp if delta_t > 0 else 0.0
                self.last_orbital_telemetry = self.orbital_scenario.step(orb_dt).to_dict()

            primary = self.target_manager.primary_target
            tx, ty, tz = primary.get_position()
            target_depth = tz if tz > 0 else 1000.0
            u_gt, v_gt, in_fov_gt, az_deg, el_deg, depth = self.camera.project_3d_target(tx, ty, tz)
            is_link_blocked = False
            range_km = target_depth / 1000.0
            angular_rate_deg_s = 0.0
            atmosphere_path_frac = 1.0

        # 3. Generate actual physical camera frame with full physical optical disturbances
        raw_frame = self.generate_raw_fpa_frame(dt=delta_t)

        # 4. Computer Vision Detection (Operates ONLY on raw image frame)
        detection_telemetry = self.detector.process_frame(
            raw_frame, flicker_intensity=round(self.last_effective_intensity, 1), dt=delta_t
        )
        if is_link_blocked:
            detection_telemetry.beacon_detected = False
            detection_telemetry.detected_centroid_x = None
            detection_telemetry.detected_centroid_y = None
            detection_telemetry.pixel_error_x = None
            detection_telemetry.pixel_error_y = None
            detection_telemetry.total_pixel_error = None
            detection_telemetry.angular_error_x_deg = None
            detection_telemetry.angular_error_y_deg = None
            detection_telemetry.confidence = 0.0
            detection_telemetry.candidates = []
            detection_telemetry.bbox = None

        # 5. Closed-Loop Kalman Target Tracking & Full PAT State Machine (Part 5)
        meas = None
        if not is_link_blocked and detection_telemetry.beacon_detected and detection_telemetry.detected_centroid_x is not None:
            meas = (detection_telemetry.detected_centroid_x, detection_telemetry.detected_centroid_y)

        tracking_telemetry = self.tracker.step(
            measurement=meas,
            confidence=detection_telemetry.confidence if not is_link_blocked else 0.0,
            dt=delta_t,
            current_pan_deg=self.camera.pan_deg,
            current_tilt_deg=self.camera.tilt_deg,
            is_link_blocked=is_link_blocked,
            slew_saturated=self.camera.slew_saturated,
            gimbal_limit=self.camera.gimbal_limit,
        )

        # -----------------------------------------------------------------------
        # 6. Gimbal Control
        # -----------------------------------------------------------------------
        if self.scenario_mode == "Local":
            is_target_lost = tracking_telemetry.state in ("LOST", "SEARCHING")
            if is_target_lost:
                self._lost_time += delta_t
                ramp = min(1.0, self._lost_time / max(self.ADAPTIVE_RAMP_TIME_S, 0.001))
                self._adaptive_speed_factor = 1.0 + (self.ADAPTIVE_MAX_FACTOR - 1.0) * ramp
            else:
                self._lost_time = 0.0
                self._adaptive_speed_factor = 1.0

            base_pan_speed  = self.camera.max_pan_speed
            base_tilt_speed = self.camera.max_tilt_speed
            self.camera.max_pan_speed  = base_pan_speed  * self._adaptive_speed_factor
            self.camera.max_tilt_speed = base_tilt_speed * self._adaptive_speed_factor

        if is_link_blocked:
            # Per Requirement 4: Camera holds position during link blockage
            self.camera.apply_rate_command(0.0, 0.0)
            tracking_telemetry.pan_cmd_deg_s = 0.0
            tracking_telemetry.tilt_cmd_deg_s = 0.0
        elif tracking_telemetry.state == "SEARCHING":
            pan_cmd, tilt_cmd = self.tracker.search_generator.generate_search_rates(
                self.camera.pan_deg, self.camera.tilt_deg, delta_t
            )
            self.camera.apply_rate_command(pan_cmd, tilt_cmd)
            tracking_telemetry.pan_cmd_deg_s = round(pan_cmd, 2)
            tracking_telemetry.tilt_cmd_deg_s = round(tilt_cmd, 2)
        elif tracking_telemetry.state in ["ACQUIRING", "TRACKING", "LOCKED", "REACQUIRING"]:
            if self.config.control.mode == "PID Coarse Pointing":
                az_err = tracking_telemetry.error_azimuth_deg if tracking_telemetry.error_azimuth_deg is not None else 0.0
                el_err = tracking_telemetry.error_elevation_deg if tracking_telemetry.error_elevation_deg is not None else 0.0
                pan_cmd, tilt_cmd = self.controller.compute_control(az_err, el_err, delta_t)
                self.camera.apply_rate_command(pan_cmd, tilt_cmd)

                # Check PID saturation for slew_saturated flag
                if self.controller.pan_pid.is_saturated or self.controller.tilt_pid.is_saturated:
                    self.camera.slew_saturated = True
                    tracking_telemetry.slew_saturated = True

                diag = self.controller.get_diagnostics()
                tracking_telemetry.pan_pid_p = diag["pan"]["p"]
                tracking_telemetry.pan_pid_i = diag["pan"]["i"]
                tracking_telemetry.pan_pid_d = diag["pan"]["d"]
                tracking_telemetry.pan_cmd_deg_s = diag["pan"]["cmd"]

                tracking_telemetry.tilt_pid_p = diag["tilt"]["p"]
                tracking_telemetry.tilt_pid_i = diag["tilt"]["i"]
                tracking_telemetry.tilt_pid_d = diag["tilt"]["d"]
                tracking_telemetry.tilt_cmd_deg_s = diag["tilt"]["cmd"]
        elif tracking_telemetry.state == "LOST":
            self.camera.apply_rate_command(0.0, 0.0)

        if self.scenario_mode == "Local":
            self.camera.max_pan_speed  = base_pan_speed
            self.camera.max_tilt_speed = base_tilt_speed

        self.last_tracking_telemetry = tracking_telemetry
        self.last_detection_telemetry = detection_telemetry
        # Persist PAT state for next step's handover manager call
        self._last_pat_state = tracking_telemetry.state

        # 7. Analytics step
        ang_err = None
        if tracking_telemetry.error_azimuth_deg is not None and tracking_telemetry.error_elevation_deg is not None:
            ang_err = math.sqrt(tracking_telemetry.error_azimuth_deg**2 + tracking_telemetry.error_elevation_deg**2)

        self.analytics.record_step(
            in_fov=in_fov_gt,
            total_error_px=tracking_telemetry.total_error_px,
            sim_time=self.sim_time,
            fps=self.measured_fps,
            is_detected=detection_telemetry.beacon_detected,
            centroid_x=detection_telemetry.detected_centroid_x,
            centroid_y=detection_telemetry.detected_centroid_y,
            gt_u=u_gt if in_fov_gt else None,
            gt_v=v_gt if in_fov_gt else None,
            angular_error_deg=ang_err,
            pan_deg=self.camera.pan_deg,
            tilt_deg=self.camera.tilt_deg,
            processing_time_ms=detection_telemetry.processing_time_ms,
            confidence=detection_telemetry.confidence,
            snr_db=detection_telemetry.snr_db,
            is_locked=tracking_telemetry.is_locked,
            target_state=tracking_telemetry.state,
            slew_saturated=self.camera.slew_saturated,
            gimbal_limit=self.camera.gimbal_limit,
            is_link_blocked=is_link_blocked,
            range_km=range_km,
            angular_rate_deg_s=angular_rate_deg_s,
            atmosphere_path_frac=atmosphere_path_frac,
            scenario_type=self.scenario_mode,
            handover_metrics=(
                self.last_orbital_telemetry.get("handover", {}).get("metrics")
                if self.last_orbital_telemetry and self.last_orbital_telemetry.get("handover")
                else None
            ),
        )

        # 8. Build telemetry packet
        bx, by, bz = self.camera.get_world_boresight_at_range(target_depth)
        frustum_corners = self.camera.get_frustum_corners_at_range(target_depth)

        jit_dx = getattr(self, "_last_jit_dx", 0.0)
        jit_dy = getattr(self, "_last_jit_dy", 0.0)

        if self.scenario_mode == "Orbital":
            u_px = (u_gt + jit_dx) if (u_gt is not None) else None
            v_px = (v_gt + jit_dy) if (v_gt is not None) else None

            target_states = [
                TargetState(
                    target_id=1,
                    world_x=round(self.disturbance.platform_offset_x, 2),
                    world_y=round(self.disturbance.platform_offset_y, 2),
                    world_z=round(target_depth, 2),
                    velocity_x=0.0,
                    velocity_y=0.0,
                    velocity_z=0.0,
                    acceleration_x=0.0,
                    acceleration_y=0.0,
                    acceleration_z=0.0,
                    pixel_x=round(u_px, 2) if (u_px is not None and -100 <= u_px <= self.camera.width + 100) else None,
                    pixel_y=round(v_px, 2) if (v_px is not None and -100 <= v_px <= self.camera.height + 100) else None,
                    azimuth_cam_deg=round(az_body, 4),
                    elevation_cam_deg=round(el_body, 4),
                    range_z_cam=target_depth,
                    is_in_fov=in_fov_gt,
                    shape=self.target_manager.primary_target.shape,
                    size_pixels=self.target_manager.primary_target.size_pixels,
                    intensity=round(self.last_effective_intensity, 1),
                    trajectory_trail=[],
                )
            ]
        else:
            target_states: List[TargetState] = []
            for t in self.target_manager.targets:
                px_t, py_t, pz_t = t.get_position()
                vx_t, vy_t, vz_t = t.get_velocity()
                ax_t, ay_t, az_t = t.get_acceleration()
                u_t, v_t, in_fov_t, az_t_deg, el_t_deg, depth_t = self.camera.project_3d_target(px_t, py_t, pz_t)
                u_t_disp = (u_t + jit_dx) if (u_t is not None) else None
                v_t_disp = (v_t + jit_dy) if (v_t is not None) else None
                eff_t_intensity = round(self.last_effective_intensity, 1) if t.target_id == primary.target_id else t.intensity
                target_states.append(
                    TargetState(
                        target_id=t.target_id,
                        world_x=round(px_t + self.disturbance.platform_offset_x, 2),
                        world_y=round(py_t + self.disturbance.platform_offset_y, 2),
                        world_z=round(pz_t, 2),
                        velocity_x=round(vx_t, 2),
                        velocity_y=round(vy_t, 2),
                        velocity_z=round(vz_t, 2),
                        acceleration_x=round(ax_t, 2),
                        acceleration_y=round(ay_t, 2),
                        acceleration_z=round(az_t, 2),
                        pixel_x=round(u_t_disp, 2) if (u_t_disp is not None and -100 <= u_t_disp <= self.camera.width + 100) else None,
                        pixel_y=round(v_t_disp, 2) if (v_t_disp is not None and -100 <= v_t_disp <= self.camera.height + 100) else None,
                        azimuth_cam_deg=az_t_deg,
                        elevation_cam_deg=el_t_deg,
                        range_z_cam=depth_t,
                        is_in_fov=in_fov_t,
                        shape=t.shape,
                        size_pixels=t.size_pixels,
                        intensity=eff_t_intensity,
                        trajectory_trail=t.get_trail()[-50:],  # Recent 50 points
                    )
                )

        telemetry = SimulationTelemetry(
            timestamp=time.time(),
            simulation_time_s=round(self.sim_time, 3),
            frame_number=self.frame_number,
            is_running=self.is_running,
            fps=self.measured_fps,
            target=target_states[0],
            targets=target_states,
            camera=CameraState(
                pan_deg=round(self.camera.pan_deg, 2),
                tilt_deg=round(self.camera.tilt_deg, 2),
                target_pan_deg=round(self.camera.target_pan_deg, 2),
                target_tilt_deg=round(self.camera.target_tilt_deg, 2),
                pan_rate_deg_s=round(self.camera.pan_rate, 2),
                tilt_rate_deg_s=round(self.camera.tilt_rate, 2),
                max_pan_speed_deg_s=self.camera.max_pan_speed,
                max_tilt_speed_deg_s=self.camera.max_tilt_speed,
                pan_min_limit_deg=self.camera.pan_min,
                pan_max_limit_deg=self.camera.pan_max,
                tilt_min_limit_deg=self.camera.tilt_min,
                tilt_max_limit_deg=self.camera.tilt_max,
                position_x=round(self.camera.pos_x, 2),
                position_y=round(self.camera.pos_y, 2),
                position_z=round(self.camera.pos_z, 2),
                world_center_x=round(bx, 2),
                world_center_y=round(by, 2),
                world_center_z=round(bz, 2),
                fov_horizontal_deg=self.camera.fov_h,
                fov_vertical_deg=self.camera.fov_v,
                resolution_width=self.camera.width,
                resolution_height=self.camera.height,
                update_rate_hz=self.camera.config.update_rate_hz,
                frustum_corners_world=frustum_corners,
                adaptive_speed_factor=round(self._adaptive_speed_factor, 2),
                lost_time_s=round(self._lost_time, 2),
                slew_saturated=self.camera.slew_saturated,
                gimbal_limit=self.camera.gimbal_limit,
            ),
            tracking=tracking_telemetry,
            detection=detection_telemetry,
            disturbance=self.last_disturbance_telemetry,
            atmospheric_condition=self.config.disturbance.atmospheric_condition,
            orbital=self.last_orbital_telemetry,
            handover=self.last_orbital_telemetry.get("handover") if self.last_orbital_telemetry else None,
        )

        self._cached_isolated_telem = telemetry
        return telemetry

    def update_orbital_config(self, config: OrbitalScenarioConfig) -> dict:
        """Re-initialises orbital scenario with updated config (orbit switch = re-init)."""
        self.scenario_mode = "Orbital"
        self.orbital_scenario.reset(config)
        self.last_orbital_telemetry = self.orbital_scenario.step(0.0).to_dict()
        self.analytics.scenario_type = "Orbital"
        self.analytics.camera_platform_type = config.camera_type
        self.analytics.beacon_platform_type = config.beacon_type
        if config.camera_type == "SATELLITE":
            self.analytics.camera_altitude_km = config.camera_sat.altitude_km or 550.0
            self.analytics.camera_orbit_preset = config.camera_sat.preset
        else:
            self.analytics.camera_altitude_km = config.camera_uav.altitude_km
            self.analytics.camera_orbit_preset = "UAV"
        if config.beacon_type == "SATELLITE":
            self.analytics.beacon_altitude_km = config.beacon_sat.altitude_km or 550.0
            self.analytics.beacon_orbit_preset = config.beacon_sat.preset
        else:
            self.analytics.beacon_altitude_km = config.beacon_uav.altitude_km
            self.analytics.beacon_orbit_preset = "UAV"

        # Point gimbal initially at beacon within limits
        link = self.last_orbital_telemetry.get("link", {})
        init_az = float(link.get("az_body_deg", 0.0))
        init_el = float(link.get("el_body_deg", 0.0))
        self.camera.pan_deg = max(self.camera.pan_min, min(self.camera.pan_max, init_az))
        self.camera.tilt_deg = max(self.camera.tilt_min, min(self.camera.tilt_max, init_el))
        self.camera.target_pan_deg = self.camera.pan_deg
        self.camera.target_tilt_deg = self.camera.tilt_deg
        return self.last_orbital_telemetry

    def reset_orbital(self) -> dict:
        """Resets the orbital scenario."""
        self.orbital_scenario.reset()
        self.last_orbital_telemetry = self.orbital_scenario.step(0.0).to_dict()
        if self.last_orbital_telemetry:
            link = self.last_orbital_telemetry.get("link", {})
            init_az = float(link.get("az_body_deg", 0.0))
            init_el = float(link.get("el_body_deg", 0.0))
            self.camera.pan_deg = max(self.camera.pan_min, min(self.camera.pan_max, init_az))
            self.camera.tilt_deg = max(self.camera.tilt_min, min(self.camera.tilt_max, init_el))
            self.camera.target_pan_deg = self.camera.pan_deg
            self.camera.target_tilt_deg = self.camera.tilt_deg
        return self.last_orbital_telemetry

    def set_orbital_time_warp(self, warp: float):
        """Sets preview time warp (1x, 10x, 60x). Ignored when simulation is active."""
        if not self.is_running:
            self.orbital_time_warp = max(1.0, float(warp))



from backend.app.config.manager import config_manager
sim_engine = SimulationEngine(config_manager.get_config())
