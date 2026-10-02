import time
from typing import Optional, List, Dict, Tuple, Any
import numpy as np
import cv2

from backend.app.models.config_model import DetectionConfig, CameraConfig
from backend.app.models.telemetry_model import DetectionTelemetry
from backend.app.detection.detector_base import BaseDetector, Detection, DetectionResult
from backend.app.detection.cv_detector import OpenCVBeaconDetector, CameraIntrinsics
from backend.app.detection.ai_detector import AIDetector
from backend.app.detection.kalman_filter import BeaconKalmanFilter
from backend.app.detection.target_identifier import TargetIdentificationEngine


class DetectionManager(BaseDetector):
    """
    Central Detection and Target Identification Subsystem (Part 4).
    Unifies all 4 operational detection modes under a common interface:
    - Classical CV
    - AI Detector
    - CV + Kalman
    - AI + Kalman

    Coordinates:
    - Base detection algorithms (OpenCV / AI with honest fallback)
    - 2D/4D Discrete Linear Kalman Filter (Centroid jitter smoothing & velocity estimation)
    - Target Identification Engine (Multi-criteria false bright object disambiguation)
    - Full telemetry generation and HUD frame visualization
    """

    def __init__(self, config: DetectionConfig, camera_config: Optional[CameraConfig] = None):
        super().__init__(config, camera_config)
        self.camera_config = camera_config or CameraConfig()
        self.intrinsics = CameraIntrinsics(
            width=self.camera_config.resolution_width,
            height=self.camera_config.resolution_height,
            fov_h_deg=self.camera_config.fov_horizontal_deg,
            fov_v_deg=self.camera_config.fov_vertical_deg,
        )

        # Subsystems
        self.classical_detector = OpenCVBeaconDetector(config, camera_config)
        self.ai_detector = AIDetector(config, camera_config)
        self.kalman_filter = BeaconKalmanFilter(
            dt=1.0 / self.camera_config.update_rate_hz,
            process_noise=config.kalman_process_noise,
            measurement_noise=config.kalman_measurement_noise,
            max_coast_frames=config.kalman_max_coast_frames,
        )
        self.target_identifier = TargetIdentificationEngine(config)

        self.last_result: Optional[DetectionResult] = None
        self.last_telemetry: Optional[DetectionTelemetry] = None

    def update_config(self, config: DetectionConfig, camera_config: Optional[CameraConfig] = None):
        super().update_config(config, camera_config)
        if camera_config:
            self.camera_config = camera_config
            self.intrinsics = CameraIntrinsics(
                width=self.camera_config.resolution_width,
                height=self.camera_config.resolution_height,
                fov_h_deg=self.camera_config.fov_horizontal_deg,
                fov_v_deg=self.camera_config.fov_vertical_deg,
            )
            self.kalman_filter.update_dt(1.0 / self.camera_config.update_rate_hz)

        self.classical_detector.update_config(config, camera_config)
        self.ai_detector.update_config(config, camera_config)
        self.target_identifier.update_config(config)

    def reset(self):
        """Resets Kalman filter and target identification track histories."""
        self.kalman_filter.reset()
        self.target_identifier.reset()
        self.last_result = None
        self.last_telemetry = None

    def set_method(self, method: str):
        """Switches the active detection method."""
        self.config.method = method

    def get_active_method_name(self) -> str:
        """Returns the configured detection method name."""
        return self.config.method

    def is_kalman_enabled(self) -> bool:
        """Returns True if the active method incorporates Kalman state filtering."""
        return "Kalman" in self.config.method

    def detect(self, frame: np.ndarray, dt: Optional[float] = None) -> DetectionResult:
        """
        Common detector interface implementation:
        detect(frame) -> DetectionResult
        Supports real-time switching between:
        - "Classical CV"
        - "AI Detector"
        - "CV + Kalman"
        - "AI + Kalman"
        """
        start_time = time.perf_counter()
        if dt and dt > 0:
            self.kalman_filter.update_dt(dt)

        method = self.config.method
        use_kalman = "Kalman" in method
        use_ai = "AI" in method

        # 1. Kalman Predict step (if Kalman mode active)
        pred_x, pred_y = None, None
        if use_kalman:
            pred_x, pred_y = self.kalman_filter.predict()

        # 2. Base Detector Execution (detect(frame))
        if use_ai:
            raw_result = self.ai_detector.detect(frame)
        else:
            raw_result = self.classical_detector.detect(frame)

        raw_candidates = raw_result.detections
        raw_count = len(raw_candidates)

        # 3. Target Identification & False Bright Object Rejection
        # Multi-criteria disambiguation using Position, Size, Brightness, Confidence, Temporal consistency
        pred_pos = (pred_x, pred_y) if use_kalman and self.kalman_filter.is_initialized else None
        identified_candidates, primary_cand, rejected_clutter = self.target_identifier.process_candidates(
            raw_candidates=raw_candidates,
            predicted_pos=pred_pos,
        )

        # 4. Kalman Measurement Update or Coasting
        filtered_x, filtered_y = None, None
        vel_x, vel_y = None, None
        if use_kalman:
            if primary_cand is not None:
                # Update filter with primary detection centroid
                filtered_x, filtered_y, vel_x, vel_y = self.kalman_filter.update(
                    primary_cand.centroid_x, primary_cand.centroid_y
                )
                # Apply smoothed subpixel centroid to primary detection
                primary_cand.centroid_x = filtered_x
                primary_cand.centroid_y = filtered_y
            else:
                # Coast filter during occlusion/missed detection
                coasted_x, coasted_y, still_valid = self.kalman_filter.coast()
                if still_valid and coasted_x is not None and coasted_y is not None:
                    filtered_x = coasted_x
                    filtered_y = coasted_y

        elapsed_ms = (time.perf_counter() - start_time) * 1000.0

        # Construct unified DetectionResult
        active_label = method
        if use_ai and not self.ai_detector.model_loaded:
            active_label = f"{method} (Fallback: Classical CV)"

        result = DetectionResult(
            detections=identified_candidates,
            primary_detection=primary_cand,
            active_method=active_label,
            model_loaded=self.ai_detector.model_loaded if use_ai else False,
            model_status=self.ai_detector.model_status if use_ai else "Classical CV Operational",
            detection_time_ms=elapsed_ms,
            frame_width=self.camera_config.resolution_width,
            frame_height=self.camera_config.resolution_height,
            flicker_intensity=raw_result.flicker_intensity,
            kalman_active=use_kalman,
            kalman_predicted_x=pred_x,
            kalman_predicted_y=pred_y,
            kalman_velocity_x=vel_x,
            kalman_velocity_y=vel_y,
            raw_candidate_count=raw_count,
            rejected_clutter_count=rejected_clutter,
            metadata={
                "method": method,
                "use_kalman": use_kalman,
                "use_ai": use_ai,
                "coasting_frames": self.kalman_filter.coasting_frames,
            },
        )

        self.last_result = result
        self.last_telemetry = result.to_telemetry(
            fov_h_deg=self.camera_config.fov_horizontal_deg,
            fov_v_deg=self.camera_config.fov_vertical_deg,
            focal_length_px=self.intrinsics.fx,
        )
        return result

    def process_frame(
        self,
        frame: np.ndarray,
        flicker_intensity: float = 255.0,
        dt: Optional[float] = None,
    ) -> DetectionTelemetry:
        """Processes frame through common interface and returns DetectionTelemetry."""
        res = self.detect(frame, dt=dt)
        res.flicker_intensity = flicker_intensity
        self.last_telemetry = res.to_telemetry(
            fov_h_deg=self.camera_config.fov_horizontal_deg,
            fov_v_deg=self.camera_config.fov_vertical_deg,
            focal_length_px=self.intrinsics.fx,
        )
        return self.last_telemetry

    def annotate_frame(
        self,
        frame: np.ndarray,
        telemetry: Optional[DetectionTelemetry] = None,
        tracking: Optional[Any] = None,
    ) -> np.ndarray:
        """Renders HUD visualization including Kalman predictions and Target Identification tags."""
        annotated = self.classical_detector.annotate_frame(frame, telemetry or self.last_telemetry, tracking=tracking)
        det = telemetry or self.last_telemetry
        if not det:
            return annotated

        is_blocked = False
        if tracking is not None:
            pat_state = getattr(tracking, "state", getattr(tracking, "mode", None))
            is_blocked = bool(getattr(tracking, "is_link_blocked", False) or pat_state in ("LINK_BLOCKED", "NO_COVERAGE"))

        # Additional Part 4 Overlays:
        # 1. Active Method Badge in HUD
        method_str = f"METHOD: {det.active_method.upper()}"
        cv2.putText(annotated, method_str, (15, 125), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (255, 180, 50), 1)

        # 2. Kalman Filter Predict Crosshair & Velocity Vector (if active and not blocked)
        if not is_blocked and det.kalman_active and det.kalman_predicted_x is not None and det.kalman_predicted_y is not None:
            kpx = int(round(det.kalman_predicted_x))
            kpy = int(round(det.kalman_predicted_y))
            # Magenta dashed crosshair for Kalman prediction
            cv2.drawMarker(annotated, (kpx, kpy), (255, 0, 255), cv2.MARKER_CROSS, 12, 1)
            cv2.putText(annotated, "KALMAN PREDICT", (kpx + 8, kpy - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.3, (255, 0, 255), 1)

            # Velocity vector
            if det.kalman_velocity_x is not None and det.kalman_velocity_y is not None:
                vx = det.kalman_velocity_x
                vy = det.kalman_velocity_y
                end_x = int(round(kpx + vx * 0.2))
                end_y = int(round(kpy + vy * 0.2))
                cv2.arrowedLine(annotated, (kpx, kpy), (end_x, end_y), (255, 100, 255), 1, tipLength=0.3)

        # 3. Clutter Rejection Count indicator
        if not is_blocked and det.rejected_clutter_count > 0:
            clutter_str = f"CLUTTER REJECTED: {det.rejected_clutter_count}"
            cv2.putText(annotated, clutter_str, (15, 140), cv2.FONT_HERSHEY_SIMPLEX, 0.32, (100, 150, 255), 1)

        # 4. Part 5 Tracking State & PID Overlays (if tracking telemetry provided)
        if tracking is not None:
            state = getattr(tracking, "state", getattr(tracking, "mode", "SEARCHING"))
            state_colors = {
                "LOCKED": (50, 220, 50),       # Vibrant Green
                "TRACKING": (255, 200, 0),     # Cyan/Blue
                "ACQUIRING": (0, 200, 255),    # Amber
                "REACQUIRING": (0, 165, 255),  # Orange
                "SEARCHING": (255, 100, 255),  # Purple
                "LOST": (50, 50, 255),         # Red
                "LINK_BLOCKED": (50, 50, 255), # Red
                "NO_COVERAGE": (50, 50, 255),  # Red
            }
            color = state_colors.get(state, (200, 200, 200))
            cv2.putText(annotated, f"PAT STATE: {state}", (15, 155), cv2.FONT_HERSHEY_SIMPLEX, 0.38, color, 1)

            # Filtered centroid marker (only when not blocked)
            filt_x = getattr(tracking, "filtered_x", None)
            filt_y = getattr(tracking, "filtered_y", None)
            if not is_blocked and filt_x is not None and filt_y is not None:
                fx = int(round(filt_x))
                fy = int(round(filt_y))
                cv2.circle(annotated, (fx, fy), 8, (0, 255, 255), 1)
                cv2.drawMarker(annotated, (fx, fy), (0, 255, 255), cv2.MARKER_TILTED_CROSS, 8, 1)

            # PID command readout
            pan_cmd = getattr(tracking, "pan_cmd_deg_s", 0.0)
            tilt_cmd = getattr(tracking, "tilt_cmd_deg_s", 0.0)
            if abs(pan_cmd) > 0.01 or abs(tilt_cmd) > 0.01:
                pid_str = f"PID CMD: Pan={pan_cmd:+.2f}d/s Tilt={tilt_cmd:+.2f}d/s"
                cv2.putText(annotated, pid_str, (15, 170), cv2.FONT_HERSHEY_SIMPLEX, 0.32, (150, 255, 200), 1)

        return annotated
