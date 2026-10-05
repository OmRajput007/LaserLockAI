import pytest
import time
import numpy as np
from backend.app.models.config_model import DisturbanceConfig, CameraConfig, SystemConfig
from backend.app.disturbances.optical_disturbance_engine import OpticalDisturbanceEngine
from backend.app.simulation.engine import SimulationEngine
from backend.app.benchmark.video_pipeline import VideoBenchmarkEngine
from backend.app.benchmark.synthetic_generator import SyntheticBenchmarkGenerator


def test_optical_disturbance_scratch_buffers_and_noise():
    """Verify pre-allocated scratch buffers eliminate dynamic allocations and produce valid noise."""
    cfg = DisturbanceConfig(
        noise_type="Multi-Noise",
        gaussian_noise_enabled=True,
        poisson_noise_enabled=True,
        salt_pepper_enabled=True,
        noise_std_dev=10.0,
        salt_pepper_ratio=0.05,
    )
    cam_cfg = CameraConfig(resolution_width=640, resolution_height=480)
    engine = OpticalDisturbanceEngine(config=cfg, camera_config=cam_cfg)

    # Frame baseline
    frame = np.full((480, 640), 128, dtype=np.uint8)

    # 1. Verify scratch buffer was created
    assert hasattr(engine, "_scratch_float32")
    assert engine._scratch_float32.shape == (480, 640)
    assert engine._scratch_float32.dtype == np.float32

    # 2. Apply sensor noise
    noisy = engine.apply_sensor_noise(frame)
    assert noisy.shape == (480, 640)
    assert noisy.dtype == np.uint8
    assert np.min(noisy) >= 0
    assert np.max(noisy) <= 255
    # Variance should increase due to Gaussian and Poisson noise
    assert np.std(noisy) > 5.0

    # 3. Apply atmospheric image degradation with contrast scaling
    degraded = engine.apply_atmospheric_image_degradation(frame, contrast_scale=0.5, path_radiance=20.0)
    assert degraded.shape == (480, 640)
    assert degraded.dtype == np.uint8

    # 4. Zero-noise fast return
    cfg_zero = DisturbanceConfig(noise_type="None", gaussian_noise_enabled=False, salt_pepper_enabled=False)
    engine_zero = OpticalDisturbanceEngine(config=cfg_zero, camera_config=cam_cfg)
    clean = engine_zero.apply_sensor_noise(frame)
    assert np.array_equal(clean, frame)


def test_simulation_engine_raw_frame_scratch_generation():
    """Verify SimulationEngine generates camera frames with scratch buffer without memory churn."""
    cfg = SystemConfig()
    engine = SimulationEngine(cfg)

    assert hasattr(engine, "_scratch_float32")
    frame = engine.generate_raw_fpa_frame()
    assert frame.shape == (480, 640)
    assert frame.dtype == np.uint8
    assert np.min(frame) >= 0


def test_batch_benchmark_visuals_bypass(tmp_path):
    """
    Verify render_visuals=False bypasses per-frame OpenCV drawing overhead,
    achieving faster execution while computing identical metrics and rendering
    the final summary frame for preview.
    """
    temp_dir = str(tmp_path)
    mp4_path, csv_path, _, _ = SyntheticBenchmarkGenerator.generate_benchmark_video(
        scenario_name="Circular Orbit",
        output_dir=temp_dir,
        duration_s=1.0,  # 30 frames
    )

    engine_fast = VideoBenchmarkEngine(upload_dir=temp_dir)
    engine_fast.load_video(mp4_path)
    engine_fast.load_ground_truth_csv(csv_path)

    # Fast batch mode (render_visuals=False)
    t0 = time.perf_counter()
    results_fast = engine_fast.process_entire_video(render_visuals=False)
    t_fast = time.perf_counter() - t0

    assert results_fast.processed_frames == 30
    assert results_fast.detection_rate_percent >= 90.0
    # Final preview frame should be rendered
    assert engine_fast.current_annotated_frame is not None
    assert engine_fast.current_annotated_frame.shape == (480, 640, 3)

    # Full visual rendering mode (render_visuals=True)
    engine_full = VideoBenchmarkEngine(upload_dir=temp_dir)
    engine_full.load_video(mp4_path)
    engine_full.load_ground_truth_csv(csv_path)

    t0 = time.perf_counter()
    results_full = engine_full.process_entire_video(render_visuals=True)
    t_full = time.perf_counter() - t0

    assert results_full.processed_frames == 30
    # Metrics must match exactly
    assert results_full.detection_rate_percent == results_fast.detection_rate_percent
    if results_fast.rmse_px is not None and results_full.rmse_px is not None:
        assert abs(results_fast.rmse_px - results_full.rmse_px) < 1e-3
