import math
import time
from typing import Optional, Tuple, Dict, Any, List
import numpy as np

from backend.app.models.config_model import TrackingConfig, CameraConfig
from backend.app.models.telemetry_model import TrackingTelemetry
from backend.app.tracking.tracker_base import BaseTracker
from backend.app.detection.kalman_filter import BeaconKalmanFilter
from backend.app.control.search_pattern import SearchPatternGenerator


class KalmanTracker(BaseTracker):
    """
    Closed-Loop FSOC Target Tracking & State Machine Engine (Part 5).
    
    Features:
    1. 4-State Discrete Linear Kalman Filter: [X, Y, Vx, Vy]^T
       - Predicts state during detection noise and temporary occlusion.
       - Generates (Measured, Predicted, Filtered) position triplets for HUD display.
    2. Comprehensive PAT Alignment State Machine:
       - SEARCHING: Beacon outside FOV; autonomous raster/sector search running.
       - ACQUIRING: First detected beacon; verifying spatial & temporal persistence (<= 2s req).
       - TRACKING: Beacon confirmed and actively tracked; closed-loop PID centering gimbal.
       - LOCKED: Coarse alignment achieved (error <= 10 px / 0.1°, conf >= 0.7, >= 5 consecutive frames).
       - LOST: Beacon obscured or lost from sensor (> 15 coasting frames).
       - REACQUIRING: Rediscovered after loss; re-establishing tracking (<= 1s req).
    3. Performance Metrics Tracking:
       - Acquisition time (<= 2.0 s requirement)
       - Reacquisition time (<= 1.0 s requirement)
       - Target loss rate percent (< 5% requirement)
       - Loss events, lost frames, cumulative loss duration
    """

    def __init__(self, config: TrackingConfig, camera_config: Optional[CameraConfig] = None):
        super().__init__(config)
        self.camera_config = camera_config or CameraConfig()
        self.dt = 1.0 / self.camera_config.update_rate_hz

        # Kinematic Kalman Filter
        self.kf = BeaconKalmanFilter(
            dt=self.dt,
            process_noise=config.process_noise_q,
            measurement_noise=config.measurement_noise_r,
            max_coast_frames=config.max_coast_frames,
        )

        # Autonomous Search Pattern Generator
        self.search_generator = SearchPatternGenerator(config, self.camera_config)

        # PAT State Machine
        self.state: str = "SEARCHING"  # SEARCHING | ACQUIRING | TRACKING | LOCKED | LOST | REACQUIRING
        self.consecutive_detect_frames: int = 0
        self.consecutive_lock_frames: int = 0
        self.lost_frames: int = 0

        # Performance Timers
        self.sim_time: float = 0.0
        self.acquisition_start_sim_time: Optional[float] = None
        self.acquisition_time_s: Optional[float] = None
        self.reacquisition_start_sim_time: Optional[float] = None
        self.reacquisition_time_s: Optional[float] = None

        self.loss_events_count: int = 0
        self.total_loss_duration_s: float = 0.0
        self.total_sim_duration_s: float = 0.0

        # Position Telemetry
        self.last_measured: Optional[Tuple[float, float]] = None
        self.last_predicted: Optional[Tuple[float, float]] = None
        self.last_filtered: Optional[Tuple[float, float]] = None
        self.last_velocity: Tuple[float, float] = (0.0, 0.0)

        # Calibrated Intrinsics for Angular Error: theta = arctan(E / f)
        fov_h_rad = math.radians(self.camera_config.fov_horizontal_deg)
        fov_v_rad = math.radians(self.camera_config.fov_vertical_deg)
        self.fx_px = (self.camera_config.resolution_width / 2.0) / math.tan(fov_h_rad / 2.0)
        self.fy_px = (self.camera_config.resolution_height / 2.0) / math.tan(fov_v_rad / 2.0)
        self.cx_px = self.camera_config.resolution_width / 2.0   # 320.0
        self.cy_px = self.camera_config.resolution_height / 2.0  # 240.0

    def reset(self):
        """Resets filter and state machine."""
        self.kf.reset()
        self.state = "SEARCHING"
        self.consecutive_detect_frames = 0
        self.consecutive_lock_frames = 0
        self.lost_frames = 0
        self.acquisition_start_sim_time = None
        self.acquisition_time_s = None
        self.reacquisition_start_sim_time = None
        self.reacquisition_time_s = None
        self.loss_events_count = 0
        self.total_loss_duration_s = 0.0
        self.total_sim_duration_s = 0.0
        self.last_measured = None
        self.last_predicted = None
        self.last_filtered = None
        self.last_velocity = (0.0, 0.0)
        self.search_generator.reset()

    def update_config(self, config: TrackingConfig, camera_config: Optional[CameraConfig] = None):
        self.config = config
        if camera_config:
            self.camera_config = camera_config
            self.dt = 1.0 / self.camera_config.update_rate_hz
            self.kf.update_dt(self.dt)
            fov_h_rad = math.radians(self.camera_config.fov_horizontal_deg)
            fov_v_rad = math.radians(self.camera_config.fov_vertical_deg)
            self.fx_px = (self.camera_config.resolution_width / 2.0) / math.tan(fov_h_rad / 2.0)
            self.fy_px = (self.camera_config.resolution_height / 2.0) / math.tan(fov_v_rad / 2.0)
            self.cx_px = self.camera_config.resolution_width / 2.0
            self.cy_px = self.camera_config.resolution_height / 2.0
        self.search_generator.update_config(config, self.camera_config)

    def step(
        self,
        measurement: Optional[Tuple[float, float]],
        confidence: float = 0.0,
        dt: Optional[float] = None,
        current_pan_deg: float = 0.0,
        current_tilt_deg: float = 0.0,
    ) -> TrackingTelemetry:
        """
        Executes a discrete closed-loop tracking update step:
        1. Propagates Kalman filter state prediction.
        2. Updates filter with measurement if beacon detected, or coasts if missing.
        3. Evaluates PAT State Machine transitions (SEARCHING, ACQUIRING, TRACKING, LOCKED, LOST, REACQUIRING).
        4. Calculates pixel error and angular pointing error.
        5. Computes loss percentages and performance timers.
        """
        delta_t = dt if dt is not None and dt > 0 else self.dt
        self.sim_time += delta_t
        self.total_sim_duration_s += delta_t
        self.kf.update_dt(delta_t)

        # 1. Kalman Prior Prediction
        pred_x, pred_y = self.kf.predict()
        self.last_predicted = (pred_x, pred_y)

        # 2. Measurement Update or Occlusion Coasting
        is_detected = (measurement is not None)
        filt_x, filt_y = None, None
        vel_x, vel_y = 0.0, 0.0

        if is_detected:
            mx, my = measurement
            self.last_measured = (mx, my)
            filt_x, filt_y, vel_x, vel_y = self.kf.update(mx, my)
            self.last_filtered = (filt_x, filt_y)
            self.last_velocity = (vel_x, vel_y)
            self.consecutive_detect_frames += 1
            self.lost_frames = 0
        else:
            self.last_measured = None
            self.consecutive_detect_frames = 0
            self.lost_frames += 1
            # Coast filter through temporary occlusion
            coast_x, coast_y, is_still_coasting = self.kf.coast()
            if is_still_coasting and coast_x is not None and coast_y is not None:
                filt_x, filt_y = coast_x, coast_y
                vel_x, vel_y = self.kf.get_velocity() if hasattr(self.kf, 'get_velocity') else (self.kf.x[2], self.kf.x[3])
                self.last_filtered = (filt_x, filt_y)
                self.last_velocity = (vel_x, vel_y)
            else:
                self.last_filtered = None
                self.last_velocity = (0.0, 0.0)

        # 3. Calculate Tracking Pointing Errors
        # Target point is filtered position if available, else predicted if tracking, else None
        target_pt = self.last_filtered if self.last_filtered is not None else (self.last_predicted if self.kf.is_initialized else None)

        err_x_px, err_y_px, total_err_px = None, None, None
        ang_err_az_deg, ang_err_el_deg = None, None

        if target_pt is not None:
            tx, ty = target_pt
            err_x_px = tx - self.cx_px
            err_y_px = ty - self.cy_px
            total_err_px = math.sqrt(err_x_px ** 2 + err_y_px ** 2)

            # Calibrated angular error: θx = arctan(Ex / fx), θy = arctan(Ey / fy)
            ang_err_az_deg = math.degrees(math.atan2(err_x_px, self.fx_px))
            ang_err_el_deg = math.degrees(math.atan2(-err_y_px, self.fy_px))  # Image +Y is downwards, camera +tilt is upwards

        # 4. PAT Alignment State Machine Transitions
        prev_state = self.state

        if is_detected:
            if self.state == "SEARCHING":
                # First detected! Start acquisition phase
                self.state = "ACQUIRING"
                self.acquisition_start_sim_time = self.sim_time
                self.consecutive_lock_frames = 0
            elif self.state == "ACQUIRING":
                # Verify persistence (>= 2 frames)
                if self.consecutive_detect_frames >= 2:
                    self.state = "TRACKING"
                    if self.acquisition_start_sim_time is not None:
                        self.acquisition_time_s = self.sim_time - self.acquisition_start_sim_time
            elif self.state in ["LOST", "REACQUIRING"]:
                if self.state == "LOST":
                    self.state = "REACQUIRING"
                    self.reacquisition_start_sim_time = self.sim_time
                elif self.state == "REACQUIRING":
                    if self.consecutive_detect_frames >= 2:
                        self.state = "TRACKING"
                        if self.reacquisition_start_sim_time is not None:
                            self.reacquisition_time_s = self.sim_time - self.reacquisition_start_sim_time
            elif self.state in ["TRACKING", "LOCKED"]:
                # Evaluate Lock Criteria
                lock_ang_thresh = self.config.lock_angular_error_threshold_deg  # 0.1°
                lock_px_thresh = self.config.lock_pixel_error_threshold_px      # 10.0 px
                lock_conf_thresh = self.config.lock_confidence_threshold        # 0.70
                req_frames = self.config.lock_consecutive_frames               # 5 frames

                is_within_error = (
                    (total_err_px is not None and total_err_px <= lock_px_thresh)
                    or (ang_err_az_deg is not None and ang_err_el_deg is not None and math.sqrt(ang_err_az_deg**2 + ang_err_el_deg**2) <= lock_ang_thresh)
                )
                is_within_conf = confidence >= lock_conf_thresh

                if is_within_error and is_within_conf:
                    self.consecutive_lock_frames += 1
                    if self.consecutive_lock_frames >= req_frames:
                        self.state = "LOCKED"
                        # Record acquisition time on first lock if not yet set
                        if self.acquisition_time_s is None and self.acquisition_start_sim_time is not None:
                            self.acquisition_time_s = self.sim_time - self.acquisition_start_sim_time
                else:
                    self.consecutive_lock_frames = 0
                    if self.state == "LOCKED":
                        self.state = "TRACKING"
        else:
            # Target not detected in this frame
            self.consecutive_lock_frames = 0
            if self.state in ["TRACKING", "LOCKED", "ACQUIRING"]:
                if self.lost_frames > self.config.max_coast_frames:
                    # Coaster expired: target confirmed lost
                    self.state = "LOST"
                    self.loss_events_count += 1
            elif self.state == "REACQUIRING":
                if self.lost_frames > self.config.max_coast_frames:
                    self.state = "LOST"

            if self.state == "LOST":
                self.total_loss_duration_s += delta_t

        is_locked_bool = (self.state == "LOCKED")

        # 5. Calculate Target Loss Percentage
        target_loss_pct = (
            (self.total_loss_duration_s / self.total_sim_duration_s * 100.0)
            if self.total_sim_duration_s > 0
            else 0.0
        )

        return TrackingTelemetry(
            state=self.state,
            mode=self.state,
            measured_x=round(self.last_measured[0], 2) if self.last_measured else None,
            measured_y=round(self.last_measured[1], 2) if self.last_measured else None,
            predicted_x=round(self.last_predicted[0], 2) if self.last_predicted else None,
            predicted_y=round(self.last_predicted[1], 2) if self.last_predicted else None,
            filtered_x=round(self.last_filtered[0], 2) if self.last_filtered else None,
            filtered_y=round(self.last_filtered[1], 2) if self.last_filtered else None,
            velocity_x=round(self.last_velocity[0], 2),
            velocity_y=round(self.last_velocity[1], 2),
            error_x_px=round(err_x_px, 2) if err_x_px is not None else None,
            error_y_px=round(err_y_px, 2) if err_y_px is not None else None,
            total_error_px=round(total_err_px, 2) if total_err_px is not None else None,
            error_azimuth_deg=round(ang_err_az_deg, 3) if ang_err_az_deg is not None else None,
            error_elevation_deg=round(ang_err_el_deg, 3) if ang_err_el_deg is not None else None,
            acquisition_time_s=round(self.acquisition_time_s, 3) if self.acquisition_time_s is not None else None,
            reacquisition_time_s=round(self.reacquisition_time_s, 3) if self.reacquisition_time_s is not None else None,
            target_lost_count=self.loss_events_count,
            lost_frames=self.lost_frames,
            loss_duration_s=round(self.total_loss_duration_s, 2),
            target_loss_percent=round(target_loss_pct, 2),
            is_locked=is_locked_bool,
            consecutive_locked_frames=self.consecutive_lock_frames,
            search_pattern_name=self.config.search_pattern,
        )

    def update(self, measurement: Optional[Tuple[float, float]], dt: float) -> Tuple[Optional[float], Optional[float]]:
        """BaseTracker compatibility interface."""
        telemetry = self.step(measurement, dt=dt)
        return (telemetry.filtered_x, telemetry.filtered_y)
