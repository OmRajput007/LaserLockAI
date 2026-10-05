import pytest
from backend.app.analytics.metrics_base import AnalyticsEngine
from backend.app.models.config_model import PerformanceConfig


def test_analytics_bounded_memory_under_long_runs():
    """
    Verifies Optimization 5.A:
    Under thousands of continuous frames, metric histories and time series
    remain strictly bounded to max_history_points (1200) without memory accumulation.
    """
    cfg = PerformanceConfig(
        max_acquisition_time_s=2.0,
        max_tracking_error_pixels=10.0,
        max_target_loss_percent=5.0,
        max_reacquisition_time_s=1.0,
        min_processing_speed_fps=20.0,
    )
    max_pts = 100
    analytics = AnalyticsEngine(cfg, max_history_points=max_pts)

    # Simulate 500 frames (5x the max_history_points limit)
    for i in range(500):
        sim_time = i * 0.0333
        analytics.record_step(
            in_fov=True,
            total_error_px=5.0 + (i % 5),
            sim_time=sim_time,
            fps=30.0,
            is_detected=True,
            centroid_x=320.0,
            centroid_y=240.0,
            gt_u=320.0,
            gt_v=240.0,
            angular_error_deg=0.01,
            processing_time_ms=2.5,
            confidence=0.98,
            snr_db=25.0,
            range_km=550.0 + (i * 0.1),
            angular_rate_deg_s=0.05,
            atmosphere_path_frac=0.15,
        )

    # 1. Total frames counter tracks all lifetime frames
    assert analytics.total_frames == 500

    # 2. Every single metric history list is strictly capped at max_history_points (100 in this test)
    assert len(analytics.tracking_errors) == max_pts
    assert len(analytics.centroid_errors) == max_pts
    assert len(analytics.fps_history) == max_pts
    assert len(analytics.processing_times_ms) == max_pts
    assert len(analytics.confidence_history) == max_pts
    assert len(analytics.snr_history) == max_pts
    assert len(analytics.ranges_km) == max_pts
    assert len(analytics.beacon_angular_rates) == max_pts
    assert len(analytics.atmosphere_path_fractions) == max_pts
    assert len(analytics.angular_errors_deg) == max_pts
    assert len(analytics.time_series) == max_pts

    # 3. Metrics calculation runs smoothly in bounded constant time
    metrics = analytics.calculate_metrics()
    assert metrics.total_frames == 500
    assert metrics.average_fps == 30.0
    assert metrics.average_tracking_error_px is not None
    assert metrics.min_range_km is not None
    assert metrics.max_range_km is not None

    # 4. Telemetry history property returns a clean list matching bounded points
    hist = analytics.telemetry_history
    assert isinstance(hist, list)
    assert len(hist) == max_pts

    # 5. Reset clears all bounded deques
    analytics.reset()
    assert len(analytics.tracking_errors) == 0
    assert len(analytics.ranges_km) == 0
    assert len(analytics.time_series) == 0
    assert analytics.total_frames == 0
