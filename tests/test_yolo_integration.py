"""
Unit tests for YOLOv8-Nano Integration and Fallback Mechanism.
Validates Step 1 to Step 6 of yolo_integration_plan.md.
"""

import os
import numpy as np
import cv2
import pytest

from backend.app.models.config_model import DetectionConfig, CameraConfig
from backend.app.detection.ai_detector import AIDetector, ULTRALYTICS_AVAILABLE
from backend.app.detection.target_identifier import TargetIdentificationEngine
from backend.app.detection.kalman_filter import BeaconKalmanFilter


def test_ai_detector_initialization_contract():
    """Validates AIDetector loads or gracefully reports status without crashing."""
    cfg = DetectionConfig(
        model_weights_path="ML_model/my_model.pt",
        ai_confidence_threshold=0.5,
    )
    cam_cfg = CameraConfig()
    detector = AIDetector(cfg, cam_cfg)

    # Truthful reporting
    if ULTRALYTICS_AVAILABLE and os.path.isfile("ML_model/my_model.pt"):
        # If ultralytics and weights are both ready
        assert detector.model_loaded is True or "error" in detector.model_status.lower()
    else:
        assert detector.model_loaded is False
        assert "fallback" in detector.model_status.lower()


def test_ai_detector_fallback_on_empty_or_low_confidence():
    """Tests Case B and Case C: Fallback to Classical CV preserves full DetectionResult contract."""
    cfg = DetectionConfig(
        model_weights_path="ML_model/my_model.pt",
        ai_confidence_threshold=0.99,  # High threshold to test fallback
    )
    cam_cfg = CameraConfig()
    detector = AIDetector(cfg, cam_cfg)

    # Frame with a bright beacon at (320, 240)
    frame = np.full((480, 640), 10, dtype=np.uint8)
    cv2.rectangle(frame, (315, 235), (325, 245), 255, -1)

    result = detector.detect(frame)

    assert result is not None
    assert result.frame_width == 640
    assert result.frame_height == 480
    assert result.detection_time_ms >= 0.0

    # Downstream compatibility check: primary detection present
    assert result.beacon_detected is True
    assert result.primary_detection is not None
    assert abs(result.primary_detection.centroid_x - 320.0) < 3.0
    assert abs(result.primary_detection.centroid_y - 240.0) < 3.0


def test_yolo_to_target_identifier_and_kalman_pipeline():
    """
    Step 6 downstream compatibility check:
    Ensures AIDetector detections pass seamlessly into TargetIdentificationEngine and BeaconKalmanFilter.
    """
    cfg = DetectionConfig(model_weights_path="ML_model/my_model.pt")
    cam_cfg = CameraConfig()
    detector = AIDetector(cfg, cam_cfg)
    target_id_engine = TargetIdentificationEngine(cfg)
    kalman = BeaconKalmanFilter(dt=0.033, process_noise=0.5, measurement_noise=1.0)

    frame = np.full((480, 640), 10, dtype=np.uint8)
    cv2.rectangle(frame, (315, 235), (325, 245), 255, -1)

    result = detector.detect(frame)
    assert len(result.detections) > 0

    # 1. Target identifier processes raw candidates
    identified, primary, rejected = target_id_engine.process_candidates(
        raw_candidates=result.detections,
        predicted_pos=None,
    )
    assert primary is not None
    assert primary.classification in ["Primary Target", "Secondary Target"]

    # 2. Kalman filter accepts primary centroid
    fx, fy, vx, vy = kalman.update(primary.centroid_x, primary.centroid_y)
    assert fx is not None and fy is not None
    assert abs(fx - 320.0) < 5.0
    assert abs(fy - 240.0) < 5.0

    # 3. Telemetry conversion succeeds
    telemetry = result.to_telemetry()
    assert telemetry.beacon_detected is True
    assert telemetry.pixel_error_x is not None
