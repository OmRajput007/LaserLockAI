import pytest
import math
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.config.manager import config_manager
from backend.app.analytics.metrics_base import AnalyticsEngine
from backend.app.analytics.experiment_engine import ExperimentEngine
from backend.app.models.analytics_model import ExperimentRecord, PerformanceMetrics


@pytest.fixture
def client():
    return TestClient(app)


def test_analytics_metrics_calculations():
    """
    Validates calculation of actual metrics:
    - Duration, FPS (avg, min, max), Processing time (avg, max)
    - Acquisition time, Re-acquisition time
    - Tracking error (avg, max, RMSE)
    - Centroid error (avg, max)
    - Target loss %, Lock retention %, Detection rate %
    - Confidence, SNR
    """
    cfg = config_manager.get_config().performance
    analytics = AnalyticsEngine(cfg)

    # Simulate 30 frames (1 second at 30 FPS)
    # Target in FOV, moving from error 15px down to 5px, with ground truth
    sim_time = 0.0
    for i in range(30):
        sim_time = i * 0.0333
        # Error starts at 15 and decreases to 3
        err = max(3.0, 15.0 - (i * 0.5))
        fps = 30.0 + (i % 3)  # 30, 31, 32
        lat = 3.5 + (i % 2)  # 3.5, 4.5
        conf = 0.95
        snr = 24.0

        # Detected centroid (320 + err, 240) vs Ground Truth (320 + err - 0.5, 240)
        analytics.record_step(
            in_fov=True,
            total_error_px=err,
            sim_time=sim_time,
            fps=fps,
            is_detected=True,
            centroid_x=320.0 + err,
            centroid_y=240.0,
            gt_u=320.0 + err - 0.5,
            gt_v=240.0,
            angular_error_deg=0.01,
            pan_deg=0.5,
            tilt_deg=-0.2,
            processing_time_ms=lat,
            confidence=conf,
            snr_db=snr,
            is_locked=(err <= 10.0),
            target_state="TRACKING" if err <= 10.0 else "ACQUIRING",
            video_duration_s=1.0,
        )

    metrics = analytics.calculate_metrics()

    assert metrics.total_frames == 30
    assert metrics.simulation_duration_s >= 0.9
    assert metrics.video_duration_s == 1.0
    assert metrics.average_fps >= 30.0
    assert metrics.min_fps == 30.0
    assert metrics.max_fps == 32.0
    assert metrics.average_processing_time_ms >= 3.5
    assert metrics.max_processing_time_ms == 4.5
    assert metrics.acquisition_time_s is not None
    assert metrics.acquisition_time_s <= 0.5  # Reached <= 10 px in 10 frames (~0.33s)
    assert metrics.average_tracking_error_px is not None
    assert metrics.max_tracking_error_px == 15.0
    assert metrics.average_centroid_error_px is not None
    assert round(metrics.average_centroid_error_px, 2) == 0.50
    assert metrics.rmse_px is not None
    assert metrics.target_loss_percent == 0.0
    assert metrics.lock_retention_percent > 60.0  # 20 out of 30 frames were <= 10 px
    assert metrics.detection_rate_percent == 100.0
    assert metrics.average_confidence == 0.95
    assert metrics.average_snr_db == 24.0


def test_official_requirements_pass_fail_logic():
    """
    Tests PASS/FAIL calculation against official criteria:
    - Acquisition <= 2.0s
    - Tracking Error <= 10.0px
    - Target Loss < 5.0%
    - Re-acquisition <= 1.0s
    - Processing Speed >= 20.0 FPS
    Verifies that PASS/FAIL is dynamically calculated from actual measurements.
    """
    cfg = config_manager.get_config().performance
    analytics = AnalyticsEngine(cfg)

    # 1. Compliant run
    for i in range(50):
        t = i * 0.0333
        analytics.record_step(
            in_fov=True,
            total_error_px=6.5,  # <= 10 px (PASS)
            sim_time=t,
            fps=28.0,  # >= 20 FPS (PASS)
            is_detected=True,
            processing_time_ms=4.0,
            confidence=0.9,
            is_locked=True,
            target_state="TRACKING",
        )

    reqs = analytics.evaluate_official_requirements()
    status_map = {r.parameter: r.status for r in reqs}

    assert status_map["Acquisition Time"] == "PASS"  # 0.0s <= 2.0s
    assert status_map["Tracking Error"] == "PASS"  # 6.5px <= 10.0px
    assert status_map["Target Loss"] == "PASS"  # 0.0% < 5.0%
    assert status_map["Re-acquisition"] == "PASS"  # No loss -> PASS
    assert status_map["Processing Speed"] == "PASS"  # 28.0 FPS >= 20.0 FPS

    summary = analytics.get_summary_response()
    assert summary.overall_compliance is True
    assert summary.passed_count == 5

    # 2. Non-compliant run (High tracking error and low FPS)
    analytics.reset()
    for i in range(50):
        t = i * 0.0333
        analytics.record_step(
            in_fov=(i < 40),  # Lost for 10 frames (20% loss > 5% limit -> FAIL)
            total_error_px=18.5,  # > 10.0px (FAIL)
            sim_time=t,
            fps=14.0,  # < 20.0 FPS (FAIL)
            is_detected=(i < 40),
            processing_time_ms=12.0,
            confidence=0.4,
            is_locked=False,
            target_state="ACQUIRING" if i < 40 else "LOST",
        )

    reqs_fail = analytics.evaluate_official_requirements()
    status_fail = {r.parameter: r.status for r in reqs_fail}

    assert status_fail["Tracking Error"] == "FAIL"
    assert status_fail["Target Loss"] == "FAIL"
    assert status_fail["Processing Speed"] == "FAIL"

    summary_fail = analytics.get_summary_response()
    assert summary_fail.overall_compliance is False
    assert summary_fail.passed_count < 5


def test_realtime_11_charts_history_logging():
    """
    Verifies that TelemetryPoint correctly logs data for all 11 real-time charts:
    1. Tracking Error vs Time
    2. Centroid Error vs Time
    3. Angular Error vs Time
    4. Centroid X vs Time
    5. Centroid Y vs Time
    6. Pan vs Time
    7. Tilt vs Time
    8. FPS vs Time
    9. Processing Time vs Time
    10. Confidence vs Time
    11. SNR vs Time
    """
    cfg = config_manager.get_config().performance
    analytics = AnalyticsEngine(cfg)

    analytics.record_step(
        in_fov=True,
        total_error_px=4.25,
        sim_time=1.5,
        fps=30.0,
        is_detected=True,
        centroid_x=324.2,
        centroid_y=241.1,
        gt_u=324.0,
        gt_v=241.0,
        angular_error_deg=0.025,
        pan_deg=1.2,
        tilt_deg=-0.8,
        processing_time_ms=3.8,
        confidence=0.92,
        snr_db=26.4,
        is_locked=True,
        target_state="TRACKING",
    )

    series = analytics.get_time_series()
    assert len(series) == 1
    pt = series[0]

    assert pt.time_s == 1.5
    assert pt.tracking_error_px == 4.25
    assert pt.centroid_error_px is not None and pt.centroid_error_px > 0
    assert pt.angular_error_deg == 0.025
    assert pt.centroid_x == 324.2
    assert pt.centroid_y == 241.1
    assert pt.pan_deg == 1.2
    assert pt.tilt_deg == -0.8
    assert pt.fps == 30.0
    assert pt.processing_time_ms == 3.8
    assert pt.confidence == 0.92
    assert pt.snr_db == 26.4
    assert pt.is_locked is True


def test_experiment_engine_storage_and_retrieval(tmp_path):
    """Verifies creation, file persistence, listing, and deletion of experimental records."""
    test_db = str(tmp_path / "test_experiments.json")
    exp_engine = ExperimentEngine(storage_path=test_db)

    metrics = PerformanceMetrics(
        simulation_duration_s=3.0,
        total_frames=90,
        average_fps=30.0,
        average_processing_time_ms=3.5,
        average_tracking_error_px=4.5,
        rmse_px=5.1,
        target_loss_percent=0.0,
        lock_retention_percent=95.0,
        detection_rate_percent=100.0,
    )

    rec = ExperimentRecord(
        experiment_id="EXP-TEST-001",
        timestamp="2026-09-27T12:00:00Z",
        name="Test Experiment",
        algorithm="CV + PID",
        target_motion="Circular",
        noise_type="None",
        noise_level_sigma=0.0,
        atmosphere="Clear",
        pid_kp=0.25,
        pid_ki=0.02,
        pid_kd=0.05,
        kalman_enabled=True,
        duration_s=3.0,
        total_frames=90,
        metrics=metrics,
        requirements=[],
        overall_status="PASS",
    )

    saved = exp_engine.save_experiment(rec)
    assert saved.experiment_id == "EXP-TEST-001"

    loaded = exp_engine.get_experiment("EXP-TEST-001")
    assert loaded is not None
    assert loaded.name == "Test Experiment"

    all_exps = exp_engine.list_experiments()
    assert len(all_exps) == 1

    csv_data = exp_engine.export_csv()
    assert "EXP-TEST-001" in csv_data

    deleted = exp_engine.delete_experiment("EXP-TEST-001")
    assert deleted is True
    assert exp_engine.get_experiment("EXP-TEST-001") is None


def test_5_algorithm_objective_comparison(tmp_path):
    """
    Executes identical scenario across all 5 algorithm candidates:
    1. Basic CV
    2. CV + Kalman
    3. CV + PID
    4. AI
    5. AI + Kalman + PID
    Validates objective measurements without subjective rankings.
    """
    test_db = str(tmp_path / "compare_experiments.json")
    exp_engine = ExperimentEngine(storage_path=test_db)
    cfg = config_manager.get_config()

    # Short 1.0 second duration (30 frames) for quick test execution
    comparison = exp_engine.run_algorithm_comparison(
        base_config=cfg,
        scenario_name="Unit Test Cross-Track Traverse",
        duration_s=1.0,
    )

    assert comparison.scenario_name == "Unit Test Cross-Track Traverse"
    assert comparison.total_frames_per_run == 30
    assert len(comparison.compared_algorithms) == 5

    algo_names = [a.algorithm_name for a in comparison.compared_algorithms]
    assert "Basic CV" in algo_names
    assert "CV + Kalman" in algo_names
    assert "CV + PID" in algo_names
    assert "AI" in algo_names
    assert "AI + Kalman + PID" in algo_names

    for res in comparison.compared_algorithms:
        assert res.mean_tracking_error_px >= 0.0
        assert res.rmse_px >= 0.0
        assert 0.0 <= res.lock_retention_percent <= 100.0
        assert 0.0 <= res.target_loss_percent <= 100.0
        assert res.average_latency_ms > 0.0
        assert res.average_fps > 0.0
        assert 0 <= res.passed_requirements_count <= 5


def test_part8_api_endpoints(client):
    """Verifies all Part 8 REST API routes."""
    # 1. /api/analytics/summary
    res_summary = client.get("/api/analytics/summary")
    assert res_summary.status_code == 200
    data_summary = res_summary.json()
    assert "metrics" in data_summary
    assert "requirements" in data_summary
    assert "overall_compliance" in data_summary

    # 2. /api/analytics/requirements
    res_reqs = client.get("/api/analytics/requirements")
    assert res_reqs.status_code == 200
    req_list = res_reqs.json()
    assert len(req_list) == 5
    req_names = [r["parameter"] for r in req_list]
    assert "Acquisition Time" in req_names
    assert "Tracking Error" in req_names
    assert "Target Loss" in req_names
    assert "Re-acquisition" in req_names
    assert "Processing Speed" in req_names

    # 3. /api/analytics/charts
    res_charts = client.get("/api/analytics/charts?window=50")
    assert res_charts.status_code == 200
    assert isinstance(res_charts.json(), list)

    # 4. /api/analytics/reset
    res_reset = client.post("/api/analytics/reset")
    assert res_reset.status_code == 200
    assert res_reset.json()["status"] == "analytics_reset"

    # 5. /api/experiments/compare
    res_cmp = client.post(
        "/api/experiments/compare",
        json={"scenario_name": "API Quick Evaluation", "duration_s": 1.0},
    )
    assert res_cmp.status_code == 200
    cmp_data = res_cmp.json()
    assert len(cmp_data["compared_algorithms"]) == 5

    # 6. /api/experiments/run
    res_run = client.post(
        "/api/experiments/run",
        json={
            "name": "Live API Experiment Test",
            "algorithm": "CV + PID",
            "target_motion": "Straight Line",
            "noise_type": "None",
            "noise_level_sigma": 0.0,
            "atmosphere": "Clear",
            "pid_kp": 0.25,
            "pid_ki": 0.02,
            "pid_kd": 0.05,
            "kalman_enabled": True,
            "duration_s": 1.0,
        },
    )
    assert res_run.status_code == 200
    exp_run_data = res_run.json()
    exp_id = exp_run_data["experiment_id"]
    assert exp_id.startswith("EXP-")

    # 7. /api/experiments/list
    res_list = client.get("/api/experiments/list")
    assert res_list.status_code == 200
    assert any(e["experiment_id"] == exp_id for e in res_list.json())

    # 8. /api/experiments/{exp_id}
    res_detail = client.get(f"/api/experiments/{exp_id}")
    assert res_detail.status_code == 200
    assert res_detail.json()["name"] == "Live API Experiment Test"

    # 9. /api/experiments/export/csv & json
    res_csv = client.get("/api/experiments/export/csv")
    assert res_csv.status_code == 200
    assert "text/csv" in res_csv.headers["content-type"]

    res_json = client.get("/api/experiments/export/json")
    assert res_json.status_code == 200
    assert isinstance(res_json.json(), list)

    # 10. /api/experiments/{exp_id} DELETE
    res_del = client.delete(f"/api/experiments/{exp_id}")
    assert res_del.status_code == 200
    assert res_del.json()["status"] == "deleted"
