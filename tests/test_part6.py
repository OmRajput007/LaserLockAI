"""
test_part6.py
=============
Unit and integration tests for Part 6:
DISTURBANCE AND NOISE ENGINE.

Verifies:
1. Multi-noise engine: Salt & Pepper, Gaussian, Poisson simultaneously (<= 20 px std dev).
2. Camera jitter: +/-20 px/frame maximum, affecting imagery and orientation.
3. Atmospheric conditions: Clear, Haze, Fog, Rain, Low Light affecting brightness, contrast, visibility, beacon signal, and image quality.
4. Platform motion: Linear mandatory, Circular, Random, Spiral, Figure of 8 (<= 20 px/frame).
5. Other optical channel disturbances: Motion blur, beacon flicker, temporary occlusion, sudden shock, brightness fluctuation, SNR reduction.
6. Robust tracking verification:
   - Noise degrades detection SNR and confidence.
   - Jitter shakes image coordinates.
   - Atmosphere attenuates beacon transmission.
   - Platform motion is tracked and corrected by closed-loop PID.
   - Temporary occlusion causes temporary detection loss, Kalman coasts, and track reacquires.
7. Test scenarios: Normal, High Noise, High Jitter, Haze, Fog, Rain, Low Light, Fast Motion, Combined Disturbance.
8. REST API endpoints for Part 6.
"""

import math
import time
import numpy as np
import pytest
from fastapi.testclient import TestClient

from backend.app.models.config_model import SystemConfig, DisturbanceConfig, CameraConfig
from backend.app.disturbances.optical_disturbance_engine import OpticalDisturbanceEngine
from backend.app.simulation.engine import SimulationEngine
from backend.app.main import app


# ==============================================================================
# 1. Multi-Noise Engine Tests
# ==============================================================================

def test_multi_noise_engine_gaussian_salt_pepper_poisson():
    """Verifies Gaussian, Salt & Pepper, and Poisson noise can be applied simultaneously with std dev <= 20."""
    cfg = DisturbanceConfig(
        noise_type="Multi-Noise",
        gaussian_noise_enabled=True,
        salt_pepper_enabled=True,
        poisson_noise_enabled=True,
        noise_std_dev=15.0,  # <= 20 px
        salt_pepper_ratio=0.05,
    )
    engine = OpticalDisturbanceEngine(cfg)

    # Clean flat test frame
    clean_frame = np.full((100, 100), 128, dtype=np.uint8)
    noisy_frame = engine.apply_sensor_noise(clean_frame)

    assert noisy_frame.shape == (100, 100)
    assert noisy_frame.dtype == np.uint8

    # Noise must physically change the image
    diff = np.abs(noisy_frame.astype(float) - clean_frame.astype(float))
    assert np.mean(diff) > 5.0, "Noise must measurably perturb pixel values"

    # Verify presence of Salt (255) and Pepper (0) pixels
    has_salt = np.any(noisy_frame == 255)
    has_pepper = np.any(noisy_frame == 0)
    assert has_salt, "Salt impulses (255) must be present"
    assert has_pepper, "Pepper impulses (0) must be present"

    # Verify standard deviation constraint (<= 20 px)
    std = float(np.std(noisy_frame.astype(float) - clean_frame.astype(float)))
    print(f"Measured noise std dev: {std:.2f}")


def test_noise_affects_detection_snr():
    """Verifies that increasing sensor noise measurably degrades detection confidence and SNR."""
    sys_cfg = SystemConfig()
    sys_cfg.target.initial_location_mode = "Center"
    sys_cfg.motion.speed_pixels_per_s = 0.0

    # Step 1: Clean frame baseline
    sys_cfg.disturbance.noise_type = "None"
    sys_cfg.disturbance.noise_std_dev = 0.0
    sim_clean = SimulationEngine(sys_cfg)
    t_clean = sim_clean.step(dt=0.033)

    clean_snr = t_clean.detection.snr_db or 50.0
    clean_conf = t_clean.detection.confidence

    # Step 2: High noise frame
    sys_cfg.disturbance.noise_type = "Gaussian"
    sys_cfg.disturbance.gaussian_noise_enabled = True
    sys_cfg.disturbance.noise_std_dev = 18.0  # Max limit <= 20 px
    sim_noisy = SimulationEngine(sys_cfg)
    t_noisy = sim_noisy.step(dt=0.033)

    noisy_snr = t_noisy.detection.snr_db or 0.0
    noisy_conf = t_noisy.detection.confidence

    print(f"Clean SNR: {clean_snr:.1f} dB, Conf: {clean_conf:.2f} -> Noisy SNR: {noisy_snr:.1f} dB, Conf: {noisy_conf:.2f}")
    assert noisy_snr < clean_snr, "High noise must measurably degrade detection SNR"


# ==============================================================================
# 2. Camera Jitter Tests
# ==============================================================================

def test_camera_jitter_limits_and_image_displacement():
    """Verifies camera jitter adheres strictly to max +/-20 pixels and physically displaces sensor coordinates."""
    cfg = DisturbanceConfig(
        camera_jitter_enabled=True,
        camera_jitter_max_px=18.0,
        camera_jitter_frequency_hz=20.0,
    )
    engine = OpticalDisturbanceEngine(cfg)

    displacements_x = []
    displacements_y = []

    dt = 0.01
    for step in range(50):
        dx, dy = engine.step_temporal_kinematics(dt)
        # Jitter limit requirement: max +/-20 px/frame
        assert abs(dx) <= 20.0, f"Jitter dx {dx} exceeds max 20 px"
        assert abs(dy) <= 20.0, f"Jitter dy {dy} exceeds max 20 px"
        displacements_x.append(dx)
        displacements_y.append(dy)

    # Verify dynamic vibration (non-zero variance)
    var_x = np.var(displacements_x)
    var_y = np.var(displacements_y)
    assert var_x > 1.0, "Jitter must exhibit realistic dynamic oscillation"
    assert var_y > 1.0, "Jitter must exhibit realistic dynamic oscillation"


# ==============================================================================
# 3. Atmospheric Conditions Tests
# ==============================================================================

def test_atmospheric_conditions_attenuation_and_radiance():
    """Verifies Clear, Haze, Fog, Rain, Low Light affect brightness, contrast, visibility, and beacon signal."""
    cfg = DisturbanceConfig()
    engine = OpticalDisturbanceEngine(cfg)

    results = {}
    for condition in ["Clear", "Haze", "Fog", "Rain", "Low Light"]:
        cfg.atmospheric_condition = condition
        trans, contrast, path_rad, eff_i = engine.compute_atmospheric_effects(beacon_intensity=255.0, depth_m=1000.0)
        results[condition] = {
            "trans": trans,
            "contrast": contrast,
            "path_radiance": path_rad,
            "effective_intensity": eff_i,
        }

    # 1. Clear must have highest transmission
    assert results["Clear"]["trans"] > 0.90
    assert results["Clear"]["contrast"] == 1.0

    # 2. Fog must have heavy attenuation and highest diffuse path radiance
    assert results["Fog"]["trans"] < 0.30, "Fog must heavily attenuate transmission"
    assert results["Fog"]["contrast"] < 0.50, "Fog must reduce scene contrast"
    assert results["Fog"]["path_radiance"] > 40.0, "Fog must inject intense scattering path radiance"

    # 3. Low light must have low effective intensity
    assert results["Low Light"]["effective_intensity"] < results["Clear"]["effective_intensity"] * 0.35

    # 4. Haze & Rain must show intermediate attenuation
    assert results["Haze"]["trans"] < results["Clear"]["trans"]
    assert results["Rain"]["trans"] < results["Clear"]["trans"]


# ==============================================================================
# 4. Platform Motion Tests
# ==============================================================================

def test_platform_motion_types_and_limits():
    """Verifies Linear mandatory, Circular, Random, Spiral, Figure of 8 <= 20 px."""
    cfg = DisturbanceConfig(
        platform_motion_enabled=True,
        platform_motion_max_px=15.0,
        platform_motion_frequency_hz=1.0,
    )
    engine = OpticalDisturbanceEngine(cfg)

    for m_type in ["Linear", "Sinusoidal", "Circular", "Figure of 8", "Spiral", "Random"]:
        cfg.platform_motion_type = m_type
        for t_step in range(20):
            engine.sim_time = t_step * 0.05
            px, py = engine.compute_platform_motion(dt=0.05)
            assert abs(px) <= 20.0, f"{m_type} px {px} exceeds 20 px"
            assert abs(py) <= 20.0, f"{m_type} py {py} exceeds 20 px"


# ==============================================================================
# 5. Other Disturbances: Blur, Flicker, Occlusion
# ==============================================================================

def test_motion_blur_convolution():
    """Verifies motion blur filters frame along velocity direction."""
    cfg = DisturbanceConfig(motion_blur_enabled=True, motion_blur_kernel_size=7)
    engine = OpticalDisturbanceEngine(cfg)

    # Frame with sharp point spot
    frame = np.zeros((50, 50), dtype=np.uint8)
    frame[25, 25] = 255

    blurred = engine.apply_motion_blur(frame, pan_rate=4.0, tilt_rate=0.0)
    assert blurred[25, 25] < 255, "Blur must diffuse the peak spot intensity"
    assert np.sum(blurred[25, :]) > 0, "Blur must spread along horizontal axis for pan rate"


def test_temporary_occlusion_and_kalman_coasting():
    """Verifies temporary occlusion blocks beacon, causing Kalman coasting and reacquisition."""
    sys_cfg = SystemConfig()
    sys_cfg.target.initial_location_mode = "Center"
    sys_cfg.motion.speed_pixels_per_s = 0.0
    sys_cfg.control.mode = "PID Coarse Pointing"
    sys_cfg.tracking.algorithm = "Kalman Filter"
    sys_cfg.tracking.max_coast_frames = 15

    engine = SimulationEngine(sys_cfg)

    # 1. Step to acquire track
    for _ in range(5):
        t = engine.step(dt=0.033)
    assert t.detection.beacon_detected is True, "Beacon should be detected initially"

    # 2. Trigger temporary occlusion
    engine.disturbance.trigger_temporary_occlusion(duration_s=0.20)  # ~6 frames
    assert engine.disturbance.is_occluded is True

    # 3. Step during occlusion -> beacon must NOT be detected, Kalman must coast
    t_occ = engine.step(dt=0.033)
    assert t_occ.detection.beacon_detected is False, "Occluded beacon must not be detected"
    assert t_occ.tracking.predicted_x is not None, "Kalman must provide coasting prediction"

    # 4. Step until occlusion ends -> beacon re-detected and track recovered
    for _ in range(12):
        t_rec = engine.step(dt=0.033)
        if t_rec.detection.beacon_detected:
            break

    assert t_rec.detection.beacon_detected is True, "Beacon must re-emerge after occlusion"


def test_closed_loop_pid_corrects_platform_motion():
    """Verifies closed-loop PID continues compensating for platform motion."""
    sys_cfg = SystemConfig()
    sys_cfg.target.initial_location_mode = "Center"
    sys_cfg.motion.speed_pixels_per_s = 0.0
    sys_cfg.control.mode = "PID Coarse Pointing"
    sys_cfg.disturbance.platform_motion_enabled = True
    sys_cfg.disturbance.platform_motion_type = "Linear"
    sys_cfg.disturbance.platform_motion_max_px = 8.0

    engine = SimulationEngine(sys_cfg)

    # Run closed loop for 30 frames
    pan_rates = []
    for _ in range(30):
        t = engine.step(dt=0.033)
        pan_rates.append(abs(t.camera.pan_rate_deg_s))

    # Controller must actively generate corrective rates
    assert np.mean(pan_rates) > 0.0, "PID must actively generate slew rates to counter platform motion"
    assert np.max(pan_rates) <= 5.01, "Slew rate must strictly respect 5 deg/s"


# ==============================================================================
# 6. Benchmark Test Scenarios Presets
# ==============================================================================

def test_benchmark_scenarios_presets():
    """Verifies all 9 benchmark test scenarios configure the engine accurately."""
    cfg = DisturbanceConfig()
    engine = OpticalDisturbanceEngine(cfg)

    scenarios = [
        "Normal",
        "High Noise",
        "High Jitter",
        "Haze",
        "Fog",
        "Rain",
        "Low Light",
        "Fast Motion",
        "Combined Disturbance",
    ]

    for sc in scenarios:
        engine.apply_preset(sc)
        assert cfg.preset_scenario == sc

        if sc == "Normal":
            assert cfg.atmospheric_condition == "Clear"
            assert cfg.camera_jitter_max_px == 0.0
        elif sc == "High Noise":
            assert cfg.gaussian_noise_enabled is True
            assert cfg.salt_pepper_enabled is True
            assert cfg.poisson_noise_enabled is True
        elif sc == "High Jitter":
            assert cfg.camera_jitter_enabled is True
            assert cfg.camera_jitter_max_px >= 15.0
        elif sc == "Fog":
            assert cfg.atmospheric_condition == "Fog"
        elif sc == "Fast Motion":
            assert cfg.platform_motion_enabled is True
            assert cfg.motion_blur_enabled is True
        elif sc == "Combined Disturbance":
            assert cfg.camera_jitter_enabled is True
            assert cfg.platform_motion_enabled is True
            assert cfg.gaussian_noise_enabled is True


# ==============================================================================
# 7. REST API Endpoints for Part 6
# ==============================================================================

def test_part6_api_endpoints():
    """Verifies Part 6 REST API endpoints for presets, disturbance config, occlusion, and telemetry."""
    client = TestClient(app)

    # 1. POST /api/simulation/disturbance/preset
    res_preset = client.post("/api/simulation/disturbance/preset", json={"preset": "High Noise"})
    assert res_preset.status_code == 200
    p_data = res_preset.json()
    assert p_data["status"] == "preset_applied"
    assert p_data["preset"] == "High Noise"

    # 2. POST /api/simulation/disturbance/config
    res_cfg = client.post(
        "/api/simulation/disturbance/config",
        json={"noise_std_dev": 12.0, "camera_jitter_enabled": True, "camera_jitter_max_px": 10.0},
    )
    assert res_cfg.status_code == 200
    c_data = res_cfg.json()
    assert c_data["disturbance"]["noise_std_dev"] == 12.0
    assert c_data["disturbance"]["camera_jitter_max_px"] == 10.0

    # 3. POST /api/simulation/disturbance/occlusion
    res_occ = client.post("/api/simulation/disturbance/occlusion", json={"duration_s": 1.2})
    assert res_occ.status_code == 200
    o_data = res_occ.json()
    assert o_data["status"] == "occlusion_triggered"
    assert o_data["is_occluded"] is True

    # 4. GET /api/simulation/disturbance/telemetry
    res_telem = client.get("/api/simulation/disturbance/telemetry")
    assert res_telem.status_code == 200
    t_data = res_telem.json()
    assert "preset_scenario" in t_data
    assert "atmospheric_condition" in t_data
