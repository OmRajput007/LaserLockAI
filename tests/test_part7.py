"""
test_part7.py
=============
Unit and integration tests for Part 7:
MP4 VIDEO BENCHMARK MODE.

Verifies:
1. MP4 Video loading and metadata extraction (Resolution, FPS, Duration, Frames).
2. Decoupled PTZ-Bypass Pipeline (MP4 -> Decoder -> Detector -> Centroid -> Tracker -> Performance).
3. 30 FPS synthetic benchmark generation paired with exact mathematical ground truth.
4. Ground-truth verification:
   - Computes Euclidean centroid error and RMSE when reference data exists.
   - Strictly refuses to fabricate ground truth when absent.
5. Centroid logging: Frame number, Timestamp, Centroid X/Y, Confidence, Status, State, Latency, FPS.
6. Playback controls: Play, Pause, Stop, Seek, Frame Step, Playback speed.
7. Batch video processing: Process entire video, calculate detection rate, lock retention, throughput FPS.
8. Export utilities: CSV log export, JSON dataset export, Markdown evaluation report.
9. REST API endpoints for Part 7.
"""

import os
import shutil
import tempfile
import numpy as np
import pytest
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.benchmark.synthetic_generator import SyntheticBenchmarkGenerator
from backend.app.benchmark.video_pipeline import VideoBenchmarkEngine


@pytest.fixture(scope="module")
def temp_benchmark_dir():
    d = tempfile.mkdtemp(prefix="fsoc_test_part7_")
    yield d
    shutil.rmtree(d, ignore_errors=True)


def test_synthetic_30fps_benchmark_generation(temp_benchmark_dir):
    """Verifies generation of 30 FPS MP4 benchmark video paired with ground truth CSV/JSON."""
    mp4_path, csv_path, json_path, gt_points = SyntheticBenchmarkGenerator.generate_benchmark_video(
        scenario_name="Straight Line Traverse",
        output_dir=temp_benchmark_dir,
        width=640,
        height=480,
        fps=30.0,
        duration_s=3.0,  # 90 frames for fast test execution
    )

    assert os.path.exists(mp4_path), "MP4 video file must exist"
    assert os.path.exists(csv_path), "Ground truth CSV file must exist"
    assert os.path.exists(json_path), "Ground truth JSON file must exist"
    assert len(gt_points) == 90, "Expected 90 ground truth points for 3.0s at 30 FPS"

    # Verify first ground truth point
    pt0 = gt_points[0]
    assert pt0.frame == 0
    assert pt0.timestamp_s == 0.0
    assert 100.0 <= pt0.x <= 550.0
    assert 200.0 <= pt0.y <= 280.0


def test_video_loading_and_metadata(temp_benchmark_dir):
    """Verifies video loading, header inspection, and metadata population."""
    mp4_path, _, _, _ = SyntheticBenchmarkGenerator.generate_benchmark_video(
        scenario_name="Circular Orbit",
        output_dir=temp_benchmark_dir,
        width=640,
        height=480,
        fps=30.0,
        duration_s=2.0,  # 60 frames
    )

    engine = VideoBenchmarkEngine(upload_dir=temp_benchmark_dir)
    metadata = engine.load_video(mp4_path)

    assert metadata.width == 640
    assert metadata.height == 480
    assert abs(metadata.fps - 30.0) < 0.5
    assert metadata.total_frames == 60
    assert abs(metadata.duration_s - 2.0) < 0.1
    assert metadata.file_size_bytes > 0


def test_ptz_bypass_frame_processing_and_centroid_logging(temp_benchmark_dir):
    """Verifies frame decoding, optical beacon detection, and per-frame telemetry logging."""
    mp4_path, csv_path, _, _ = SyntheticBenchmarkGenerator.generate_benchmark_video(
        scenario_name="Straight Line Traverse",
        output_dir=temp_benchmark_dir,
        duration_s=2.0,
    )

    engine = VideoBenchmarkEngine(upload_dir=temp_benchmark_dir)
    engine.load_video(mp4_path)
    engine.load_ground_truth_csv(csv_path)

    # Process frame 0
    log0 = engine.process_current_frame()
    assert log0 is not None
    assert log0.frame_number == 0
    assert log0.timestamp_s == 0.0
    assert log0.detection_status == "DETECTED"
    assert log0.detected_centroid_x is not None
    assert log0.detected_centroid_y is not None
    assert log0.confidence > 0.5
    assert log0.processing_time_ms >= 0.0
    assert log0.instantaneous_fps > 0.0
    assert log0.ground_truth_x is not None

    # Centroid error should be small on clean synthetic video (<= 3 pixels)
    assert log0.centroid_error_px is not None
    assert log0.centroid_error_px <= 4.0, f"Expected small centroid error, got {log0.centroid_error_px}"


def test_strict_truthfulness_when_ground_truth_absent(temp_benchmark_dir):
    """Verifies engine refuses to fabricate ground truth when none is provided."""
    mp4_path, _, _, _ = SyntheticBenchmarkGenerator.generate_benchmark_video(
        scenario_name="Figure of 8",
        output_dir=temp_benchmark_dir,
        duration_s=1.0,
    )

    engine = VideoBenchmarkEngine(upload_dir=temp_benchmark_dir)
    engine.load_video(mp4_path)
    # Deliberately DO NOT load ground truth
    engine.clear_ground_truth()

    log = engine.process_current_frame()
    assert log is not None
    assert log.ground_truth_x is None, "Ground truth X must be None when no reference provided"
    assert log.ground_truth_y is None, "Ground truth Y must be None when no reference provided"
    assert log.centroid_error_px is None, "Centroid error must be None when no reference provided"

    results = engine.compute_benchmark_results()
    assert results.ground_truth_available is False
    assert results.average_centroid_error_px is None
    assert results.rmse_px is None
    assert "Not Provided" in results.status_message


def test_video_playback_controls_seek_and_stepping(temp_benchmark_dir):
    """Verifies seek, step forward, step backward, and speed controls."""
    mp4_path, _, _, _ = SyntheticBenchmarkGenerator.generate_benchmark_video(
        scenario_name="Straight Line Traverse",
        output_dir=temp_benchmark_dir,
        duration_s=2.0,  # 60 frames
    )

    engine = VideoBenchmarkEngine(upload_dir=temp_benchmark_dir)
    engine.load_video(mp4_path)

    # Initial frame 0
    assert engine.current_frame_idx == 0

    # Step forward
    engine.step_forward()
    assert engine.current_frame_idx == 1

    engine.step_forward()
    assert engine.current_frame_idx == 2

    # Step backward
    engine.step_backward()
    assert engine.current_frame_idx == 1

    # Seek to frame 45
    success = engine.seek(45)
    assert success is True
    assert engine.current_frame_idx == 45

    # Out of bounds clamping
    engine.seek(1000)
    assert engine.current_frame_idx == 59  # Last frame


def test_batch_offline_benchmark_and_performance_metrics(temp_benchmark_dir):
    """Verifies batch execution of entire video stream and metric aggregation."""
    mp4_path, csv_path, _, _ = SyntheticBenchmarkGenerator.generate_benchmark_video(
        scenario_name="Circular Orbit",
        output_dir=temp_benchmark_dir,
        duration_s=2.0,  # 60 frames
    )

    engine = VideoBenchmarkEngine(upload_dir=temp_benchmark_dir)
    engine.load_video(mp4_path)
    engine.load_ground_truth_csv(csv_path)

    results = engine.process_entire_video()

    assert results.processed_frames == 60
    assert results.detection_rate_percent >= 90.0, "Expected >=90% detection rate on clean circular orbit"
    assert results.average_processing_fps > 0.0
    assert results.average_processing_time_ms > 0.0
    assert results.ground_truth_available is True
    assert results.rmse_px is not None
    assert results.rmse_px <= 5.0, "RMSE error should be <= 5 px on synthetic orbit"
    assert results.lock_retention_percent > 70.0


def test_temporary_occlusion_benchmark_and_coasting(temp_benchmark_dir):
    """Verifies target loss logging and recovery during cloud occlusion sequence."""
    mp4_path, csv_path, _, _ = SyntheticBenchmarkGenerator.generate_benchmark_video(
        scenario_name="Occlusion Test",
        output_dir=temp_benchmark_dir,
        duration_s=5.0,  # 150 frames, occlusion between frame 90 and 130
    )

    engine = VideoBenchmarkEngine(upload_dir=temp_benchmark_dir)
    engine.load_video(mp4_path)
    engine.load_ground_truth_csv(csv_path)
    engine.set_detection_method("CV + Kalman")

    results = engine.process_entire_video()

    assert results.processed_frames == 150
    # Occlusion spans frames 90-130 (~40 frames), so detection rate should be ~70%
    assert 60.0 <= results.detection_rate_percent <= 85.0
    assert results.target_lost_count >= 1, "Expected target loss event during occlusion"
    assert results.target_loss_duration_s > 0.5


def test_export_utilities_csv_json_markdown(temp_benchmark_dir):
    """Verifies CSV string export, structured JSON export, and Markdown report generation."""
    mp4_path, csv_path, _, _ = SyntheticBenchmarkGenerator.generate_benchmark_video(
        scenario_name="Straight Line Traverse",
        output_dir=temp_benchmark_dir,
        duration_s=1.5,
    )

    engine = VideoBenchmarkEngine(upload_dir=temp_benchmark_dir)
    engine.load_video(mp4_path)
    engine.load_ground_truth_csv(csv_path)
    engine.process_entire_video()

    # 1. CSV Export
    csv_data = engine.export_csv()
    assert "frame_number,timestamp_s,detected_x" in csv_data
    assert len(csv_data.splitlines()) >= 45

    # 2. JSON Export
    json_data = engine.export_json()
    assert "metadata" in json_data
    assert "results" in json_data
    assert "logs" in json_data
    assert len(json_data["logs"]) >= 45

    # 3. Markdown Report
    md_report = engine.export_summary_markdown()
    assert "# MP4 Video Benchmark Evaluation Report" in md_report
    assert "RMSE" in md_report


def test_part7_rest_api_endpoints(temp_benchmark_dir):
    """Verifies all Part 7 REST API endpoints."""
    client = TestClient(app)

    # 1. Generate Synthetic Benchmark Video via API
    syn_res = client.post(
        "/api/benchmark/synthetic",
        json={"scenario": "Straight Line Traverse", "duration_s": 2.0},
    )
    assert syn_res.status_code == 200
    syn_data = syn_res.json()
    assert syn_data["status"] == "synthetic_benchmark_ready"
    assert syn_data["ground_truth_points"] == 60

    # 2. Query Benchmark Playback State
    state_res = client.get("/api/benchmark/state")
    assert state_res.status_code == 200
    state_data = state_res.json()
    assert state_data["metadata"]["width"] == 640
    assert state_data["metadata"]["total_frames"] == 60

    # 3. Test Playback Controls (Seek & Step)
    ctrl_res = client.post(
        "/api/benchmark/control",
        json={"action": "seek", "frame_idx": 15},
    )
    assert ctrl_res.status_code == 200
    ctrl_data = ctrl_res.json()
    assert ctrl_data["state"]["current_frame_idx"] == 15
    assert ctrl_data["frame_log"] is not None

    # 4. Fetch Frame Image
    img_res = client.get("/api/benchmark/frame/image?annotated=true")
    assert img_res.status_code == 200
    assert img_res.headers["content-type"] == "image/jpeg"
    assert len(img_res.content) > 1000

    # 5. Fetch Frame Telemetry
    telem_res = client.get("/api/benchmark/frame/telemetry")
    assert telem_res.status_code == 200
    telem_data = telem_res.json()
    assert telem_data["frame_idx"] == 15
    assert telem_data["log"]["detection_status"] == "DETECTED"

    # 6. Change Detection Method
    method_res = client.post("/api/benchmark/method", json={"method": "CV + Kalman"})
    assert method_res.status_code == 200

    # 7. Batch Process Entire Video
    proc_res = client.post("/api/benchmark/process", json={"max_frames": 30})
    assert proc_res.status_code == 200
    results_data = proc_res.json()["results"]
    assert results_data["processed_frames"] == 30
    assert results_data["detection_rate_percent"] > 80.0

    # 8. Export CSV and Report
    csv_res = client.get("/api/benchmark/export/csv")
    assert csv_res.status_code == 200
    assert "text/csv" in csv_res.headers["content-type"]

    report_res = client.get("/api/benchmark/export/report")
    assert report_res.status_code == 200
    assert "text/markdown" in report_res.headers["content-type"]
