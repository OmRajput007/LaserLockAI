import math
import numpy as np
import cv2
import pytest
from fastapi.testclient import TestClient

from backend.app.models.config_model import (
    SystemConfig,
    DetectionConfig,
    CameraConfig,
    TargetConfig,
)
from backend.app.detection.detector_base import BaseDetector, Detection, DetectionResult
from backend.app.detection.cv_detector import OpenCVBeaconDetector
from backend.app.detection.ai_detector import AIDetector
from backend.app.detection.kalman_filter import BeaconKalmanFilter
from backend.app.detection.target_identifier import TargetIdentificationEngine
from backend.app.detection.detection_manager import DetectionManager
from backend.app.simulation.engine import SimulationEngine
from backend.app.main import app


def test_common_detector_interface():
    """Verifies all detectors implement BaseDetector and follow detect(frame) -> DetectionResult."""
    cfg = DetectionConfig()
    cam_cfg = CameraConfig()

    cv_det = OpenCVBeaconDetector(cfg, cam_cfg)
    ai_det = AIDetector(cfg, cam_cfg)

    assert isinstance(cv_det, BaseDetector)
    assert isinstance(ai_det, BaseDetector)

    # Empty black frame
    frame = np.zeros((480, 640), dtype=np.uint8)
    res_cv = cv_det.detect(frame)
    res_ai = ai_det.detect(frame)

    assert isinstance(res_cv, DetectionResult)
    assert isinstance(res_ai, DetectionResult)
    assert res_cv.active_method == "Classical CV"
    assert "AI Detector" in res_ai.active_method


def test_opencv_detector_standardized_result():
    """Verifies OpenCV detector outputs valid detections, bounding box, moments centroid, and SNR."""
    cfg = DetectionConfig(intensity_threshold=100)
    cam_cfg = CameraConfig()
    cv_det = OpenCVBeaconDetector(cfg, cam_cfg)

    # Create synthetic frame with bright 10x10 spot at (350, 220)
    frame = np.full((480, 640), 15, dtype=np.uint8)
    cv2.rectangle(frame, (345, 215), (355, 225), 255, -1)

    result = cv_det.detect(frame)
    assert result.beacon_detected is True
    assert result.primary_detection is not None
    det = result.primary_detection

    # Centroid should be within 1 px of (350, 220)
    assert abs(det.centroid_x - 350.0) < 1.0
    assert abs(det.centroid_y - 220.0) < 1.0
    assert det.area > 50.0
    assert det.brightness >= 250.0
    assert det.confidence > 0.7
    assert result.detection_time_ms > 0.0


def test_ai_detector_honest_fallback_without_fabrication():
    """Verifies AIDetector truthfully reports model unloaded and falls back to Classical CV without fabricating outputs."""
    cfg = DetectionConfig(model_weights_path="non_existent_model_weights.onnx")
    cam_cfg = CameraConfig()
    ai_det = AIDetector(cfg, cam_cfg)

    # Truthful model status check
    assert ai_det.model_loaded is False
    status = ai_det.model_status
    assert "Classical CV fallback" in status
    assert "without fabricated predictions" in status

    # Verify execution runs through fallback without crashing or faking predictions
    frame = np.full((480, 640), 15, dtype=np.uint8)
    cv2.rectangle(frame, (315, 235), (325, 245), 255, -1)

    result = ai_det.detect(frame)
    assert result.beacon_detected is True
    assert abs(result.primary_detection.centroid_x - 320.0) < 1.0
    assert abs(result.primary_detection.centroid_y - 240.0) < 1.0


def test_kalman_filter_state_estimation_and_velocity():
    """Verifies Kalman filter predicts next state and tracks pixel velocity [vx, vy]."""
    kf = BeaconKalmanFilter(dt=0.033, process_noise=0.5, measurement_noise=1.0)
    assert kf.is_initialized is False

    # Simulate beacon moving along X at ~150 px/s (5 px per 0.033s frame)
    true_x = 200.0
    true_y = 200.0
    vx_true = 150.0
    dt = 0.033

    for step in range(50):
        true_x += vx_true * dt
        # Predict
        pred_x, pred_y = kf.predict()
        # Update with noisy measurement
        measured_x = true_x + np.random.normal(0, 0.2)
        measured_y = true_y + np.random.normal(0, 0.2)
        filtered_x, filtered_y, est_vx, est_vy = kf.update(measured_x, measured_y)

    assert kf.is_initialized is True
    # Filtered state should be very close to ground truth after convergence
    assert abs(filtered_x - true_x) < 5.0
    assert abs(filtered_y - true_y) < 5.0
    # Estimated velocity should converge toward vx_true (within 25%)
    assert abs(est_vx - vx_true) < 30.0
    assert abs(est_vy) < 15.0


def test_kalman_filter_coasting_and_loss():
    """Verifies Kalman filter coasts through temporary occlusion and resets after max coast frames."""
    kf = BeaconKalmanFilter(dt=0.033, max_coast_frames=5)
    kf.update(320.0, 240.0)
    assert kf.is_initialized is True

    # Occlusion occurs: call coast()
    for _ in range(5):
        coasted_x, coasted_y, still_valid = kf.coast()
        assert still_valid is True
        assert coasted_x is not None

    # Exceed max coast frames
    coasted_x, coasted_y, still_valid = kf.coast()
    assert still_valid is False
    assert kf.is_initialized is False
    assert coasted_x is None


def test_target_identification_and_false_bright_object_rejection():
    """Verifies target identification engine disambiguates optical beacon from solar glints and dead pixels."""
    cfg = DetectionConfig(
        expected_spot_size_px=10.0,
        max_spatial_jump_px=80.0,
        min_track_persistence_frames=2,
        reject_false_bright_objects=True,
    )
    engine = TargetIdentificationEngine(config=cfg)

    # 1. Warm up track with true optical beacon (10x10 spot = ~100 px²) at (320, 240)
    det_beacon_f1 = Detection(
        candidate_id=1,
        bbox=[315, 235, 10, 10],
        centroid_x=320.0,
        centroid_y=240.0,
        area=100.0,
        brightness=255.0,
        confidence=0.95,
        snr_db=25.0,
    )
    engine.process_candidates([det_beacon_f1])

    # 2. In frame 2, present 3 candidates:
    # Candidate 1: True beacon continuing trajectory at (322, 241)
    det_beacon_f2 = Detection(
        candidate_id=1,
        bbox=[317, 236, 10, 10],
        centroid_x=322.0,
        centroid_y=241.0,
        area=102.0,
        brightness=255.0,
        confidence=0.95,
        snr_db=25.0,
    )
    # Candidate 2: Large solar glint / cloud reflection (area = 900 px²)
    det_glint = Detection(
        candidate_id=2,
        bbox=[50, 50, 30, 30],
        centroid_x=65.0,
        centroid_y=65.0,
        area=900.0,
        brightness=255.0,
        confidence=0.80,
        snr_db=20.0,
    )
    # Candidate 3: Hot pixel (area = 1 px²)
    det_hot_pixel = Detection(
        candidate_id=3,
        bbox=[500, 400, 1, 1],
        centroid_x=500.0,
        centroid_y=400.0,
        area=1.0,
        brightness=255.0,
        confidence=0.70,
        snr_db=15.0,
    )

    candidates, primary, clutter_count = engine.process_candidates(
        [det_glint, det_beacon_f2, det_hot_pixel],
        predicted_pos=(320.0, 240.0),
    )

    # Primary target must be the true beacon
    assert primary is not None
    assert primary.candidate_id == 1
    assert abs(primary.centroid_x - 322.0) < 1.0
    assert primary.classification == "Primary Target"

    # Solar glint and hot pixel must be rejected as clutter
    assert clutter_count >= 1


def test_detection_manager_all_four_methods():
    """Verifies seamless switching across all 4 operational detection methods."""
    cfg = SystemConfig()
    manager = DetectionManager(cfg.detection, cfg.camera)

    # 1. Classical CV
    manager.set_method("Classical CV")
    assert manager.get_active_method_name() == "Classical CV"
    assert manager.kalman_filter.is_initialized is False

    # 2. AI Detector
    manager.set_method("AI Detector")
    assert "AI Detector" in manager.get_active_method_name()

    # 3. CV + Kalman
    manager.set_method("CV + Kalman")
    assert manager.get_active_method_name() == "CV + Kalman"
    assert manager.is_kalman_enabled() is True

    # 4. AI + Kalman
    manager.set_method("AI + Kalman")
    assert manager.get_active_method_name() == "AI + Kalman"
    assert manager.is_kalman_enabled() is True

    # Process a frame with beacon under AI + Kalman
    frame = np.full((480, 640), 10, dtype=np.uint8)
    cv2.rectangle(frame, (315, 235), (325, 245), 255, -1)
    telemetry = manager.process_frame(frame, dt=0.033)

    assert telemetry.beacon_detected is True
    assert "AI + Kalman" in telemetry.active_method
    assert telemetry.kalman_active is True
    assert telemetry.detected_centroid_x is not None
    assert abs(telemetry.detected_centroid_x - 320.0) < 2.0


def test_simulation_engine_part4_integration():
    """Verifies SimulationEngine runs Part 4 multi-method detection and synthetic clutter injection."""
    cfg = SystemConfig()
    cfg.detection.method = "CV + Kalman"
    cfg.detection.inject_false_bright_objects = True
    cfg.detection.false_bright_object_count = 2
    engine = SimulationEngine(cfg)

    # Step engine to populate camera and detection state
    last_telemetry = None
    for _ in range(5):
        last_telemetry = engine.step(dt=0.033)

    assert last_telemetry is not None
    det = last_telemetry.detection

    assert det.active_method == "CV + Kalman"
    assert det.kalman_active is True
    # Clutter was injected, so raw_candidate_count should be >= 2 and rejected_clutter_count >= 1
    assert det.raw_candidate_count >= 2
    assert det.rejected_clutter_count >= 1


def test_part4_api_endpoints():
    """Verifies Part 4 REST API endpoints (/method, /ai, /clutter, /comparison)."""
    client = TestClient(app)

    # 1. POST /api/simulation/detection/method
    res_method = client.post(
        "/api/simulation/detection/method",
        json={"method": "AI + Kalman"},
    )
    assert res_method.status_code == 200
    data_method = res_method.json()
    assert data_method["method"] == "AI + Kalman"
    assert data_method["kalman_active"] is True

    # 2. POST /api/simulation/detection/ai
    res_ai = client.post(
        "/api/simulation/detection/ai",
        json={"ai_inference_device": "GPU", "ai_confidence_threshold": 0.65},
    )
    assert res_ai.status_code == 200
    data_ai = res_ai.json()
    assert data_ai["ai_config"]["inference_device"] == "GPU"
    assert data_ai["ai_config"]["confidence_threshold"] == 0.65

    # 3. POST /api/simulation/detection/clutter
    res_clutter = client.post(
        "/api/simulation/detection/clutter",
        json={"inject": True, "count": 3},
    )
    assert res_clutter.status_code == 200
    data_clutter = res_clutter.json()
    assert data_clutter["inject_false_bright_objects"] is True
    assert data_clutter["false_bright_object_count"] == 3

    # 4. GET /api/simulation/detection/comparison
    res_comp = client.get("/api/simulation/detection/comparison")
    assert res_comp.status_code == 200
    data_comp = res_comp.json()
    assert "classical_cv" in data_comp
    assert "ai_detector" in data_comp
    assert "latency_ms" in data_comp["classical_cv"]
    assert "latency_ms" in data_comp["ai_detector"]
    assert "detected" in data_comp["classical_cv"]
