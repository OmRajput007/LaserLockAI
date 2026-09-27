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
from backend.app.detection.cv_detector import OpenCVBeaconDetector, CameraIntrinsics
from backend.app.target.beacon import BeaconTarget
from backend.app.simulation.engine import SimulationEngine
from backend.app.main import app


def test_frame_generation_monochrome_and_colour():
    """Verifies virtual camera generates actual frames with OpenCV/NumPy in Monochrome and Colour."""
    cfg = SystemConfig()
    cfg.camera.color_mode = "Monochrome"
    cfg.target.background_level = 20.0
    cfg.target.noise_sigma = 2.0
    engine = SimulationEngine(cfg)

    # 1. Monochrome frame
    frame_mono = engine.generate_raw_fpa_frame()
    assert isinstance(frame_mono, np.ndarray)
    assert frame_mono.shape == (480, 640)
    assert frame_mono.dtype == np.uint8
    # Background baseline should be close to 20
    assert 15 <= np.mean(frame_mono) <= 25

    # 2. Colour frame
    cfg_color = cfg.model_copy(deep=True)
    cfg_color.camera.color_mode = "Colour"
    engine_color = SimulationEngine(cfg_color)
    frame_color = engine_color.generate_raw_fpa_frame()
    assert isinstance(frame_color, np.ndarray)
    assert frame_color.shape == (480, 640, 3)
    assert frame_color.dtype == np.uint8


def test_beacon_optical_spot_shapes():
    """Verifies rendering of Square, Circle, and Gaussian spot shapes."""
    for shape in ["Square", "Circle", "Gaussian"]:
        frame = np.full((480, 640), 10, dtype=np.uint8)
        target = BeaconTarget(shape=shape, size_pixels=12, intensity=250.0)
        target.render_to_frame(frame, px=320.0, py=240.0)

        # Center pixel must have received high optical energy
        assert frame[240, 320] > 150, f"Shape {shape} failed center intensity"
        # Perimeter far away should remain at background
        assert frame[50, 50] == 10


def test_beacon_flicker_modulation():
    """Verifies periodic sinusoidal optical flicker modulation I(t) = I0 * [1 + m*sin(2πft)]."""
    cfg = SystemConfig()
    cfg.target.flicker_enabled = True
    cfg.target.flicker_frequency_hz = 5.0
    cfg.target.flicker_depth = 0.4
    cfg.target.intensity = 200.0
    engine = SimulationEngine(cfg)

    # At t=0, sin(0) = 0 -> I(0) = 200
    engine.sim_time = 0.0
    i_0 = engine.get_instantaneous_intensity(200.0)
    assert abs(i_0 - 200.0) < 1e-3

    # At t = 1/(4*f) = 1/20 = 0.05s, sin(π/2) = 1 -> I(t) = 200 * (1 + 0.4) = 280 (clipped to 255)
    engine.sim_time = 0.05
    i_peak = engine.get_instantaneous_intensity(200.0)
    assert i_peak == 255.0

    # At t = 3/(4*f) = 0.15s, sin(3π/2) = -1 -> I(t) = 200 * (1 - 0.4) = 120
    engine.sim_time = 0.15
    i_trough = engine.get_instantaneous_intensity(200.0)
    assert abs(i_trough - 120.0) < 1.0


def test_opencv_detection_pipeline_and_moments_centroid():
    """
    Verifies that the detector processes the raw frame through the complete OpenCV pipeline:
    Frame -> Grayscale -> Preprocessing -> Thresholding -> Morphology -> Contours -> Moments.
    The detector must calculate centroid Cx = M10/M00, Cy = M01/M00 within subpixel accuracy.
    """
    detector = OpenCVBeaconDetector(DetectionConfig(), CameraConfig())

    # Create synthetic frame with background 15 and noise
    test_frame = np.full((480, 640), 15, dtype=np.uint8)
    spot_x = 354.2
    spot_y = 218.6
    beacon = BeaconTarget(shape="Square", size_pixels=10, intensity=255.0)
    beacon.render_to_frame(test_frame, spot_x, spot_y)

    telemetry = detector.process_frame(test_frame)

    assert telemetry.beacon_detected is True
    assert telemetry.detected_centroid_x is not None
    assert telemetry.detected_centroid_y is not None

    # Verify moment-based subpixel centroid is within 0.5 pixels of spot center
    assert abs(telemetry.detected_centroid_x - spot_x) < 0.6
    assert abs(telemetry.detected_centroid_y - spot_y) < 0.6

    # Verify bounding box around spot (approx 10x10)
    assert telemetry.bbox is not None
    bx, by, bw, bh = telemetry.bbox
    assert 8 <= bw <= 12
    assert 8 <= bh <= 12


def test_camera_center_error_calculation():
    """
    Verifies center error formulas:
    Cx = Width / 2 = 320
    Cy = Height / 2 = 240
    Ex = Bx - Cx
    Ey = By - Cy
    E = sqrt(Ex² + Ey²)
    """
    detector = OpenCVBeaconDetector(DetectionConfig(), CameraConfig())
    test_frame = np.full((480, 640), 15, dtype=np.uint8)
    beacon = BeaconTarget(shape="Circle", size_pixels=10, intensity=255.0)
    # Render at (360, 270) -> Ex = 40, Ey = 30 -> E = sqrt(40² + 30²) = 50.0
    beacon.render_to_frame(test_frame, 360.0, 270.0)

    telemetry = detector.process_frame(test_frame)

    assert telemetry.beacon_detected is True
    assert telemetry.pixel_error_x is not None
    assert telemetry.pixel_error_y is not None
    assert telemetry.total_pixel_error is not None

    assert abs(telemetry.pixel_error_x - 40.0) < 0.6
    assert abs(telemetry.pixel_error_y - 30.0) < 0.6
    assert abs(telemetry.total_pixel_error - 50.0) < 0.8


def test_angular_error_calculation_and_intrinsics():
    """
    Verifies angular error calculations:
    θx ≈ Ex * HFOV / Width
    θy ≈ Ey * VFOV / Height
    and intrinsic calibration model: θ = arctan(E / f).
    """
    intrinsics = CameraIntrinsics(width=640, height=480, fov_h_deg=4.0, fov_v_deg=3.0)

    # For Ex = 160 px (quarter width), linear approx: 160 * 4.0 / 640 = 1.0 deg
    th_x_lin, th_y_lin = intrinsics.pixel_to_angle_deg(ex=160.0, ey=120.0, use_calibrated=False)
    assert abs(th_x_lin - 1.0) < 1e-4
    assert abs(th_y_lin - 0.75) < 1e-4  # 120 * 3.0 / 480 = 0.75 deg

    # Calibrated pinhole model
    th_x_calib, th_y_calib = intrinsics.pixel_to_angle_deg(ex=160.0, ey=120.0, use_calibrated=True)
    # At small angles (1 deg), calibrated and linear differ by less than 0.001 deg
    assert abs(th_x_calib - th_x_lin) < 0.002
    assert abs(th_y_calib - th_y_lin) < 0.002


def test_detection_confidence_and_snr():
    """Verifies that confidence is bounded [0.0, 1.0] and SNR is computed in dB."""
    detector = OpenCVBeaconDetector(DetectionConfig(), CameraConfig())
    test_frame = np.full((480, 640), 20, dtype=np.uint8)
    beacon = BeaconTarget(shape="Gaussian", size_pixels=10, intensity=240.0)
    beacon.render_to_frame(test_frame, 320.0, 240.0)

    telemetry = detector.process_frame(test_frame)

    assert telemetry.beacon_detected is True
    assert 0.0 <= telemetry.confidence <= 1.0
    assert telemetry.confidence > 0.8  # Strong clean beacon should yield high confidence
    assert telemetry.snr_db is not None
    assert telemetry.snr_db > 20.0  # (240 - 20) / sigma yields high SNR


def test_multiple_candidate_detections():
    """
    Verifies that multiple bright candidates in the frame are detected and indexed:
    Each contains candidate_id, bbox, centroid, area, confidence.
    """
    detector = OpenCVBeaconDetector(DetectionConfig(), CameraConfig())
    test_frame = np.full((480, 640), 10, dtype=np.uint8)

    # 3 distinct beacon spots
    b1 = BeaconTarget(shape="Square", size_pixels=10, intensity=255.0)
    b2 = BeaconTarget(shape="Circle", size_pixels=10, intensity=220.0)
    b3 = BeaconTarget(shape="Square", size_pixels=8, intensity=190.0)

    b1.render_to_frame(test_frame, 200.0, 150.0)
    b2.render_to_frame(test_frame, 450.0, 300.0)
    b3.render_to_frame(test_frame, 320.0, 240.0)

    telemetry = detector.process_frame(test_frame)

    assert telemetry.beacon_detected is True
    assert telemetry.candidate_count == 3
    assert len(telemetry.candidates) == 3

    # Primary detection should be candidate with highest confidence
    assert telemetry.detected_centroid_x == telemetry.candidates[0].centroid_x
    assert telemetry.detected_centroid_y == telemetry.candidates[0].centroid_y

    for cand in telemetry.candidates:
        assert cand.candidate_id in [1, 2, 3]
        assert len(cand.bbox) == 4
        assert cand.area > 0
        assert 0.0 <= cand.confidence <= 1.0


def test_out_of_fov_clipping_no_detections():
    """
    Strict test: If target is outside the camera FOV, it must NOT appear in the frame,
    and the detector must report beacon_detected = False.
    """
    cfg = SystemConfig()
    # Place target far outside camera view
    cfg.target.initial_location_mode = "Manual"
    engine = SimulationEngine(cfg)
    engine.target_manager.primary_target.x = 1800.0
    engine.target_manager.primary_target.y = 1800.0
    engine.target_manager.primary_target.z = 1000.0

    # Step simulation
    telemetry = engine.step(dt=0.0)

    assert telemetry.target.is_in_fov is False
    assert telemetry.detection.beacon_detected is False
    assert telemetry.detection.candidate_count == 0
    assert telemetry.detection.detected_centroid_x is None
    assert telemetry.detection.total_pixel_error is None


def test_false_positive_rejection_noise_floor():
    """Verifies that an image with only ambient noise and background produces 0 false detections."""
    detector = OpenCVBeaconDetector(DetectionConfig(intensity_threshold=120), CameraConfig())
    # Ambient frame around 30 with max noise 10 (nowhere near 120 threshold)
    noise_frame = np.clip(np.random.normal(30, 8, size=(480, 640)), 0, 255).astype(np.uint8)

    telemetry = detector.process_frame(noise_frame)

    assert telemetry.beacon_detected is False
    assert telemetry.candidate_count == 0
    assert telemetry.confidence == 0.0


def test_frame_annotation_visualization():
    """Verifies HUD frame annotation rendering crosshairs, bounding box, centroid, and error line."""
    detector = OpenCVBeaconDetector(DetectionConfig(), CameraConfig())
    test_frame = np.full((480, 640), 15, dtype=np.uint8)
    beacon = BeaconTarget(shape="Square", size_pixels=10, intensity=255.0)
    beacon.render_to_frame(test_frame, 350.0, 260.0)

    telemetry = detector.process_frame(test_frame)
    annotated = detector.annotate_frame(test_frame, telemetry)

    assert isinstance(annotated, np.ndarray)
    assert annotated.shape == (480, 640, 3)  # 3-channel color overlay
    assert annotated.dtype == np.uint8

    # Check center crosshairs region has non-background colored pixels
    assert not np.array_equal(annotated[240, 320], [15, 15, 15])
    # Check bounding box region has green overlay
    assert annotated[255, 345, 1] > 100 or annotated[260, 350, 0] > 100


def test_api_endpoints_part3():
    """Verifies Part 3 HTTP API routes."""
    client = TestClient(app)

    # 1. Raw camera frame
    res_raw = client.get("/api/simulation/frame?annotated=false")
    assert res_raw.status_code == 200
    assert res_raw.headers["content-type"] == "image/jpeg"
    assert len(res_raw.content) > 1000

    # 2. Annotated camera frame
    res_ann = client.get("/api/simulation/frame?annotated=true")
    assert res_ann.status_code == 200
    assert res_ann.headers["content-type"] == "image/jpeg"
    assert len(res_ann.content) > 1000

    # 3. Detection intermediates pipeline inspection
    res_pipe = client.get("/api/simulation/detection/intermediates")
    assert res_pipe.status_code == 200
    pipe_data = res_pipe.json()
    assert pipe_data["status"] == "success"
    assert "grayscale" in pipe_data["stages"]
    assert "preprocessed" in pipe_data["stages"]
    assert "threshold" in pipe_data["stages"]
    assert "morphed" in pipe_data["stages"]

    # 4. Tune detection parameters
    res_tune = client.post(
        "/api/simulation/detection/tune",
        json={"intensity_threshold": 110, "morph_kernel_size": 3, "use_otsu": False},
    )
    assert res_tune.status_code == 200
    assert res_tune.json()["detection_config"]["intensity_threshold"] == 110
