import math
import time
import numpy as np
import pytest
from fastapi.testclient import TestClient

from backend.app.models.config_model import (
    SystemConfig,
    TrackingConfig,
    ControlConfig,
    CameraConfig,
    TargetConfig,
)
from backend.app.control.pid_controller import PIDAxis, GimbalPIDController
from backend.app.control.search_pattern import SearchPatternGenerator
from backend.app.tracking.kalman_tracker import KalmanTracker
from backend.app.simulation.engine import SimulationEngine
from backend.app.main import app


# ==============================================================================
# 1. PID Controller Unit Tests
# ==============================================================================

def test_pid_axis_proportional_integral_derivative_and_saturation():
    """Verifies PID controller computes P, I, D terms and clamps output to 5 deg/s."""
    pid = PIDAxis(
        kp=1.0,
        ki=0.1,
        kd=0.2,
        output_limit=5.0,
        integral_limit=2.5,
        derivative_alpha=0.5,
        deadband=0.01,
    )

    dt = 0.1
    # Step 1: Error = 2.0 deg
    out1 = pid.compute(error=2.0, dt=dt)
    # P = 1.0 * 2.0 = 2.0
    # I = 0.1 * (2.0 * 0.1) = 0.02
    # D = 0.0 (first step)
    assert abs(pid.p_term - 2.0) < 0.01
    assert abs(pid.i_term - 0.02) < 0.01
    assert out1 > 1.9

    # Step 2: Saturated large error (e.g. 10.0 deg) -> must be clamped to 5.0 deg/s
    out2 = pid.compute(error=10.0, dt=dt)
    assert out2 == 5.0
    assert pid.is_saturated is True

    # Step 3: Verify Anti-Windup prevents integral runaway when saturated
    for _ in range(50):
        out = pid.compute(error=10.0, dt=dt)
        assert out == 5.0
    # Integral accumulator must not exceed integral_limit (2.5)
    assert abs(pid.integral) <= 2.5


def test_gimbal_pid_controller_pan_and_tilt():
    """Verifies 2-axis GimbalPIDController computes separate pan and tilt outputs."""
    cfg = ControlConfig(
        mode="PID Coarse Pointing",
        kp_pan=1.2,
        ki_pan=0.05,
        kd_pan=0.15,
        kp_tilt=1.5,
        ki_tilt=0.06,
        kd_tilt=0.20,
    )
    controller = GimbalPIDController(cfg)

    pan_cmd, tilt_cmd = controller.compute_control(error_x_deg=1.5, error_y_deg=-1.0, dt=0.033)

    assert pan_cmd > 0.0, "Pan command should be positive for positive azimuth error"
    assert tilt_cmd < 0.0, "Tilt command should be negative for negative elevation error"
    assert abs(pan_cmd) <= 5.0
    assert abs(tilt_cmd) <= 5.0

    diag = controller.get_diagnostics()
    assert "pan" in diag
    assert "tilt" in diag
    assert "cmd" in diag["pan"]


# ==============================================================================
# 2. Kalman Tracker & Position Triplets Tests
# ==============================================================================

def test_kalman_tracker_measured_predicted_filtered_positions():
    """Verifies KalmanTracker exposes measured, predicted, and filtered position triplets."""
    cfg = TrackingConfig(algorithm="Kalman Filter")
    cam_cfg = CameraConfig()
    tracker = KalmanTracker(cfg, cam_cfg)

    # Step 1: First detection at (350, 220)
    t1 = tracker.step(measurement=(350.0, 220.0), confidence=0.9, dt=0.033)
    assert t1.measured_x == 350.0
    assert t1.measured_y == 220.0
    assert t1.filtered_x is not None
    assert abs(t1.filtered_x - 350.0) < 1.0

    # Step 2: Target moving steadily: next measurement at (354, 221)
    t2 = tracker.step(measurement=(354.0, 221.0), confidence=0.9, dt=0.033)
    assert t2.predicted_x is not None
    assert t2.measured_x == 354.0
    assert t2.filtered_x is not None
    assert t2.velocity_x is not None


def test_kalman_prediction_during_occlusion_coasting():
    """Verifies Kalman filter coasts on predicted state during temporary detection loss."""
    cfg = TrackingConfig(algorithm="Kalman Filter", max_coast_frames=10)
    cam_cfg = CameraConfig()
    tracker = KalmanTracker(cfg, cam_cfg)

    # Initialize with several steady detections
    for i in range(5):
        tracker.step(measurement=(320.0 + i * 2.0, 240.0), confidence=0.9, dt=0.033)

    # Occlusion begins: measurement is None
    for _ in range(5):
        t_coast = tracker.step(measurement=None, confidence=0.0, dt=0.033)
        assert t_coast.measured_x is None
        assert t_coast.filtered_x is not None, "Filter should continue dead-reckoning during coast"
        assert t_coast.predicted_x is not None


# ==============================================================================
# 3. Autonomous Search Pattern Tests
# ==============================================================================

def test_search_pattern_raster_and_sector():
    """Verifies Raster and Sector search patterns generate rate commands within 5 deg/s limits."""
    cfg = TrackingConfig(
        search_pattern="Raster Search",
        search_pan_range_deg=20.0,
        search_tilt_range_deg=15.0,
        search_slew_speed_deg_s=4.0,
    )
    generator = SearchPatternGenerator(cfg)
    generator.reset(center_pan=0.0, center_tilt=0.0)

    # Raster search step
    pan_rate, tilt_rate = generator.generate_search_rates(current_pan_deg=0.0, current_tilt_deg=0.0, dt=0.033)
    assert abs(pan_rate) <= 4.0
    assert abs(tilt_rate) <= 4.0
    assert abs(pan_rate) > 0.0 or abs(tilt_rate) > 0.0

    # Sector search step
    cfg.search_pattern = "Sector Search"
    generator.update_config(cfg)
    generator.reset(center_pan=0.0, center_tilt=0.0)
    pan_rate_sec, tilt_rate_sec = generator.generate_search_rates(current_pan_deg=0.0, current_tilt_deg=0.0, dt=0.033)
    assert abs(pan_rate_sec) <= 4.0
    assert abs(tilt_rate_sec) <= 4.0


# ==============================================================================
# 4. PAT Alignment State Machine Tests (SEARCHING, ACQUIRING, TRACKING, LOCKED, LOST, REACQUIRING)
# ==============================================================================

def test_pat_state_machine_acquisition_and_lock():
    """Verifies state machine transitions: SEARCHING -> ACQUIRING -> TRACKING -> LOCKED and measures acquisition time."""
    cfg = TrackingConfig(
        lock_angular_error_threshold_deg=0.15,
        lock_pixel_error_threshold_px=10.0,
        lock_confidence_threshold=0.70,
        lock_consecutive_frames=3,
        acquisition_timeout_s=2.0,
    )
    cam_cfg = CameraConfig()
    tracker = KalmanTracker(cfg, cam_cfg)

    # Initial state must be SEARCHING
    assert tracker.state == "SEARCHING"

    # Frame 1: First detection -> ACQUIRING
    t1 = tracker.step(measurement=(322.0, 241.0), confidence=0.85, dt=0.033)
    assert t1.state == "ACQUIRING"

    # Frame 2: Confirmed detection -> TRACKING
    t2 = tracker.step(measurement=(321.5, 240.8), confidence=0.85, dt=0.033)
    assert t2.state == "TRACKING"
    assert t2.acquisition_time_s is not None
    assert t2.acquisition_time_s <= 2.0  # Acquisition <= 2 sec requirement

    # Frame 3, 4, 5: Aligned within 10px / 0.1° with high confidence -> LOCKED
    for _ in range(3):
        t_lock = tracker.step(measurement=(320.2, 240.1), confidence=0.92, dt=0.033)

    assert t_lock.state == "LOCKED"
    assert t_lock.is_locked is True


def test_pat_state_machine_target_loss_and_reacquisition():
    """Verifies transitions TRACKING -> LOST and LOST -> REACQUIRING -> TRACKING with reacquisition timer."""
    cfg = TrackingConfig(
        max_coast_frames=5,
        reacquisition_timeout_s=1.0,
    )
    cam_cfg = CameraConfig()
    tracker = KalmanTracker(cfg, cam_cfg)

    # Establish tracking
    tracker.step(measurement=(320.0, 240.0), confidence=0.9, dt=0.033)
    tracker.step(measurement=(320.0, 240.0), confidence=0.9, dt=0.033)
    assert tracker.state == "TRACKING"

    # Target drops: coast for 5 frames
    for _ in range(5):
        tracker.step(measurement=None, confidence=0.0, dt=0.033)

    # Coasting exceeded: transition to LOST
    t_lost = tracker.step(measurement=None, confidence=0.0, dt=0.033)
    assert t_lost.state == "LOST"
    assert t_lost.target_lost_count >= 1

    # Beacon reappears: transition to REACQUIRING
    t_reacq1 = tracker.step(measurement=(325.0, 242.0), confidence=0.85, dt=0.033)
    assert t_reacq1.state == "REACQUIRING"

    # Frame 2 of reacquisition: transition to TRACKING
    t_reacq2 = tracker.step(measurement=(324.0, 241.5), confidence=0.88, dt=0.033)
    assert t_reacq2.state == "TRACKING"
    assert t_reacq2.reacquisition_time_s is not None
    assert t_reacq2.reacquisition_time_s <= 1.0  # Re-acquisition <= 1 sec requirement


# ==============================================================================
# 5. Closed-Loop Gimbal Response & Anti-Teleportation Tests
# ==============================================================================

def test_closed_loop_camera_movement_no_teleportation():
    """
    Verifies that the camera physically responds to PID controller commands,
    slews smoothly over time, and strictly obeys the 5 deg/s hardware speed limit without teleporting.
    """
    sys_cfg = SystemConfig()
    sys_cfg.control.mode = "PID Coarse Pointing"
    sys_cfg.camera.initial_pan_deg = 0.0
    sys_cfg.camera.initial_tilt_deg = 0.0
    sys_cfg.camera.max_pan_speed_deg_s = 5.0
    sys_cfg.camera.max_tilt_speed_deg_s = 5.0

    engine = SimulationEngine(sys_cfg)
    # Place beacon at (X=1030, Y=1000, Z=1000), which requires positive pan to center
    engine.target_manager.primary_target.x = 1030.0
    engine.target_manager.primary_target.y = 1000.0
    engine.target_manager.primary_target.z = 1000.0
    engine.target_manager.primary_target.vx = 0.0
    engine.target_manager.primary_target.vy = 0.0
    engine.target_manager.primary_target.vz = 0.0

    initial_pan = engine.camera.pan_deg
    initial_tilt = engine.camera.tilt_deg
    assert initial_pan == 0.0

    dt = 0.033
    max_step_deg = 5.0 * dt + 0.001  # Max allowed angle change in one step = 5 deg/s * dt

    # Step closed loop for 30 frames (~1.0 sec)
    pan_history = [initial_pan]
    for _ in range(30):
        prev_pan = engine.camera.pan_deg
        telemetry = engine.step(dt=dt)
        curr_pan = engine.camera.pan_deg

        delta_pan = abs(curr_pan - prev_pan)
        # CRITICAL VERIFICATION: Camera must NOT teleport! Must not exceed max slew rate!
        assert delta_pan <= max_step_deg, f"Camera teleported! Step {delta_pan}° exceeds max {max_step_deg}°"
        pan_history.append(curr_pan)

    # Gimbal must have smoothly moved towards the target
    final_pan = engine.camera.pan_deg
    assert final_pan > initial_pan, "Camera failed to pan towards target in closed loop"
    assert telemetry.tracking.pan_cmd_deg_s is not None


# ==============================================================================
# 6. Part 5 REST API Endpoints Tests
# ==============================================================================

def test_part5_api_endpoints():
    """Verifies REST API endpoints for Part 5 control mode, PID tuning, tracking filter, and search."""
    client = TestClient(app)

    # 1. POST /api/simulation/control/mode
    res_mode = client.post("/api/simulation/control/mode", json={"mode": "PID Coarse Pointing"})
    assert res_mode.status_code == 200
    assert res_mode.json()["mode"] == "PID Coarse Pointing"

    # 2. POST /api/simulation/control/pid
    res_pid = client.post(
        "/api/simulation/control/pid",
        json={"kp_pan": 1.4, "ki_pan": 0.08, "kd_pan": 0.22, "kp_tilt": 1.4},
    )
    assert res_pid.status_code == 200
    pid_data = res_pid.json()
    assert pid_data["pan"]["kp"] == 1.4
    assert pid_data["pan"]["ki"] == 0.08
    assert pid_data["tilt"]["kp"] == 1.4

    # 3. POST /api/simulation/tracking/filter
    res_filt = client.post("/api/simulation/tracking/filter", json={"algorithm": "Kalman Filter"})
    assert res_filt.status_code == 200
    assert res_filt.json()["algorithm"] == "Kalman Filter"

    # 4. POST /api/simulation/tracking/search
    res_search = client.post(
        "/api/simulation/tracking/search",
        json={"action": "start", "search_pattern": "Sector Search"},
    )
    assert res_search.status_code == 200
    search_data = res_search.json()
    assert search_data["search_pattern"] == "Sector Search"
    assert search_data["is_active"] is True

    # 5. GET /api/simulation/tracking/telemetry
    res_telem = client.get("/api/simulation/tracking/telemetry")
    assert res_telem.status_code == 200
    telem_data = res_telem.json()
    assert "state" in telem_data
    assert "is_locked" in telem_data
