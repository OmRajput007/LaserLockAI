from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional, List, Dict, Any, Tuple
import math
import numpy as np

from backend.app.models.config_model import DetectionConfig, CameraConfig
from backend.app.models.telemetry_model import (
    DetectionTelemetry,
    DetectionCandidateTelemetry,
)


@dataclass
class Detection:
    """
    Standardized single candidate detection entity.
    Represents an optical candidate extracted from a virtual camera frame.
    """
    candidate_id: int
    bbox: List[int]  # [x, y, w, h]
    centroid_x: float  # Subpixel centroid X (from image moments M10/M00 or AI anchor)
    centroid_y: float  # Subpixel centroid Y (from image moments M01/M00 or AI anchor)
    area: float
    brightness: float
    confidence: float
    snr_db: float
    is_primary: bool = False
    classification: str = "Primary Target"  # "Primary Target" | "Secondary Target" | "False Bright Object (Clutter)"
    spatial_distance: Optional[float] = None
    temporal_score: float = 1.0

    def to_candidate_telemetry(self) -> DetectionCandidateTelemetry:
        return DetectionCandidateTelemetry(
            candidate_id=self.candidate_id,
            bbox=self.bbox,
            centroid_x=round(self.centroid_x, 2),
            centroid_y=round(self.centroid_y, 2),
            area=round(self.area, 2),
            brightness=round(self.brightness, 1),
            confidence=round(self.confidence, 3),
            snr_db=round(self.snr_db, 1),
            is_primary=self.is_primary,
            classification=self.classification,
            spatial_distance_to_track=round(self.spatial_distance, 1) if self.spatial_distance is not None else None,
            temporal_consistency_score=round(self.temporal_score, 2),
        )


@dataclass
class DetectionResult:
    """
    Standardized return object for the common detector interface:
    detect(frame) -> DetectionResult
    """
    detections: List[Detection] = field(default_factory=list)
    primary_detection: Optional[Detection] = None
    active_method: str = "Classical CV"
    model_loaded: bool = False
    model_status: str = "Active"
    detection_time_ms: float = 0.0
    frame_width: int = 640
    frame_height: int = 480
    flicker_intensity: float = 255.0
    kalman_active: bool = False
    kalman_predicted_x: Optional[float] = None
    kalman_predicted_y: Optional[float] = None
    kalman_velocity_x: Optional[float] = None
    kalman_velocity_y: Optional[float] = None
    raw_candidate_count: int = 0
    rejected_clutter_count: int = 0
    metadata: Dict[str, Any] = field(default_factory=dict)

    @property
    def beacon_detected(self) -> bool:
        return self.primary_detection is not None

    def to_telemetry(
        self,
        fov_h_deg: float = 4.0,
        fov_v_deg: float = 3.0,
        focal_length_px: float = 9166.12,
    ) -> DetectionTelemetry:
        """Converts DetectionResult into API-ready DetectionTelemetry with exact error metrics."""
        cam_cx = self.frame_width / 2.0  # 320.0
        cam_cy = self.frame_height / 2.0  # 240.0

        if self.primary_detection is not None:
            pri = self.primary_detection
            bx = pri.centroid_x
            by = pri.centroid_y

            # Center error Ex = Bx - Cx, Ey = By - Cy, E = sqrt(Ex² + Ey²)
            ex = bx - cam_cx
            ey = by - cam_cy
            total_e = math.sqrt(ex ** 2 + ey ** 2)

            # Calibrated angular error: θx = arctan(Ex / fx), θy = arctan(Ey / fy)
            th_x = math.degrees(math.atan2(ex, focal_length_px))
            th_y = math.degrees(math.atan2(ey, focal_length_px))

            cand_telemetry = [d.to_candidate_telemetry() for d in self.detections]

            return DetectionTelemetry(
                beacon_detected=True,
                detected_centroid_x=round(bx, 2),
                detected_centroid_y=round(by, 2),
                bbox=pri.bbox,
                area=pri.area,
                brightness=pri.brightness,
                confidence=pri.confidence,
                pixel_error_x=round(ex, 2),
                pixel_error_y=round(ey, 2),
                total_pixel_error=round(total_e, 2),
                angular_error_x_deg=round(th_x, 3),
                angular_error_y_deg=round(th_y, 3),
                snr_db=pri.snr_db,
                processing_time_ms=round(self.detection_time_ms, 2),
                candidate_count=len(self.detections),
                candidates=cand_telemetry,
                flicker_intensity=round(self.flicker_intensity, 1),
                active_method=self.active_method,
                ai_model_loaded=self.model_loaded,
                ai_model_status=self.model_status,
                kalman_active=self.kalman_active,
                kalman_predicted_x=round(self.kalman_predicted_x, 2) if self.kalman_predicted_x is not None else None,
                kalman_predicted_y=round(self.kalman_predicted_y, 2) if self.kalman_predicted_y is not None else None,
                kalman_velocity_x=round(self.kalman_velocity_x, 2) if self.kalman_velocity_x is not None else None,
                kalman_velocity_y=round(self.kalman_velocity_y, 2) if self.kalman_velocity_y is not None else None,
                target_classification=pri.classification,
                raw_candidate_count=self.raw_candidate_count,
                rejected_clutter_count=self.rejected_clutter_count,
            )

        # No beacon detected
        cand_telemetry = [d.to_candidate_telemetry() for d in self.detections]
        return DetectionTelemetry(
            beacon_detected=False,
            detected_centroid_x=None,
            detected_centroid_y=None,
            bbox=None,
            area=None,
            brightness=None,
            confidence=0.0,
            pixel_error_x=None,
            pixel_error_y=None,
            total_pixel_error=None,
            angular_error_x_deg=None,
            angular_error_y_deg=None,
            snr_db=None,
            processing_time_ms=round(self.detection_time_ms, 2),
            candidate_count=len(self.detections),
            candidates=cand_telemetry,
            flicker_intensity=round(self.flicker_intensity, 1),
            active_method=self.active_method,
            ai_model_loaded=self.model_loaded,
            ai_model_status=self.model_status,
            kalman_active=self.kalman_active,
            kalman_predicted_x=round(self.kalman_predicted_x, 2) if self.kalman_predicted_x is not None else None,
            kalman_predicted_y=round(self.kalman_predicted_y, 2) if self.kalman_predicted_y is not None else None,
            kalman_velocity_x=round(self.kalman_velocity_x, 2) if self.kalman_velocity_x is not None else None,
            kalman_velocity_y=round(self.kalman_velocity_y, 2) if self.kalman_velocity_y is not None else None,
            target_classification="Searching",
            raw_candidate_count=self.raw_candidate_count,
            rejected_clutter_count=self.rejected_clutter_count,
        )


class BaseDetector(ABC):
    """
    Common detector interface for Part 4 AI-ready architecture.
    All detection algorithms (Classical CV, AI Detector, CV+Kalman, AI+Kalman)
    must implement the unified signature:
        detect(frame) -> DetectionResult
    """

    def __init__(self, config: DetectionConfig, camera_config: Optional[CameraConfig] = None):
        self.config = config
        self.camera_config = camera_config or CameraConfig()

    @abstractmethod
    def detect(self, frame: np.ndarray) -> DetectionResult:
        """
        Executes beacon detection on the input frame.
        Must operate exclusively on pixel information without accessing ground-truth coordinates.
        """
        pass

    def update_config(self, config: DetectionConfig, camera_config: Optional[CameraConfig] = None):
        self.config = config
        if camera_config:
            self.camera_config = camera_config
