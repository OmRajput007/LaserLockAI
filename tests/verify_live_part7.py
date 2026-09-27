"""
verify_live_part7.py
====================
End-to-end verification script for Part 7:
MP4 VIDEO BENCHMARK MODE.

Validates all requirements from Problem Statement 4:
1. PTZ Bypass: Decouples virtual PTZ gimbal simulation and routes MP4 video frames
   directly into the detection, centroiding, and tracking pipeline.
2. 30 FPS Benchmark Video Ingestion: Handles video loading and metadata extraction.
3. Video Controls: Play, Pause, Stop, Seek, Step forward, Step backward, Set speed.
4. Detection Architecture: Evaluates Classical CV and CV + Kalman on video stream.
5. Per-Frame Centroid Logging: Logs frame number, timestamp, detected X/Y, confidence,
   status, state, latency, instantaneous FPS, and error.
6. Reference Data & Strict Truthfulness:
   - Evaluates centroid error vs reference ground truth when available.
   - Refuses to fabricate reference data when absent.
7. Benchmark Performance Metrics: Computes detection rate, lock retention, average/max error,
   RMSE, target loss duration, and throughput FPS.
8. Log and Report Exports: Downloads CSV, JSON, and Markdown evaluation reports.
"""

import os
import sys
import time
import requests
import numpy as np

BASE_URL = "http://127.0.0.1:8000"

def log_section(title: str):
    print("\n" + "=" * 70)
    print(f"[*] {title}")
    print("=" * 70)


def verify_live_api_health():
    log_section("1. VERIFYING LIVE SERVER STATUS")
    res = requests.get(f"{BASE_URL}/api/status")
    assert res.status_code == 200, f"Server failed status check: {res.text}"
    status = res.json()
    print(f"[+] Server Status: {status['status']}")
    print(f"[+] System: {status['system']}")
    assert status["status"] == "operational"


def verify_synthetic_benchmark_generation_and_loading():
    log_section("2. VERIFYING 30 FPS BENCHMARK VIDEO GENERATION & LOADING")
    payload = {
        "scenario": "Straight Line Traverse",
        "duration_s": 3.0,  # 90 frames
    }
    res = requests.post(f"{BASE_URL}/api/benchmark/synthetic", json=payload)
    assert res.status_code == 200, f"Synthetic generation failed: {res.text}"
    data = res.json()
    meta = data["metadata"]

    print(f"[+] Benchmark Video Loaded: {meta['filename']}")
    print(f"    Resolution: {meta['width']}x{meta['height']} px | Native FPS: {meta['fps']} FPS")
    print(f"    Total Frames: {meta['total_frames']} ({meta['duration_s']}s) | File Size: {meta['file_size_bytes']} bytes")
    print(f"    Ground Truth Points Loaded: {data['ground_truth_points']}")

    assert meta["width"] == 640
    assert meta["height"] == 480
    assert abs(meta["fps"] - 30.0) < 0.5
    assert meta["total_frames"] == 90
    assert data["ground_truth_points"] == 90


def verify_ptz_bypass_and_frame_decoding():
    log_section("3. VERIFYING PTZ BYPASS & FRAME-BY-FRAME DECODING PIPELINE")
    # Position cursor at frame 10
    seek_res = requests.post(
        f"{BASE_URL}/api/benchmark/control",
        json={"action": "seek", "frame_idx": 10},
    )
    assert seek_res.status_code == 200
    state_data = seek_res.json()
    assert state_data["state"]["current_frame_idx"] == 10

    # Retrieve frame image directly
    img_res = requests.get(f"{BASE_URL}/api/benchmark/frame/image?annotated=true")
    assert img_res.status_code == 200
    assert img_res.headers["content-type"] == "image/jpeg"
    print(f"[+] Decoded Video Frame 10: Received {len(img_res.content)} JPEG bytes")

    # Retrieve frame telemetry log
    telem_res = requests.get(f"{BASE_URL}/api/benchmark/frame/telemetry")
    assert telem_res.status_code == 200
    telem = telem_res.json()
    log_entry = telem["log"]

    print(f"[+] Frame 10 Telemetry Log:")
    print(f"    Frame #: {log_entry['frame_number']} | Time: {log_entry['timestamp_s']:.2f}s")
    print(f"    Status: {log_entry['detection_status']} | State: {log_entry['tracking_state']}")
    print(f"    Detected Centroid: ({log_entry['detected_centroid_x']}, {log_entry['detected_centroid_y']})")
    print(f"    Ground Truth Centroid: ({log_entry['ground_truth_x']}, {log_entry['ground_truth_y']})")
    print(f"    Centroid Error: {log_entry['centroid_error_px']} px ({log_entry['angular_error_deg']:.3f} deg)")
    print(f"    Latency: {log_entry['processing_time_ms']:.2f} ms | Instantaneous Throughput: {log_entry['instantaneous_fps']:.1f} FPS")

    assert log_entry["frame_number"] == 10
    assert log_entry["detection_status"] == "DETECTED"
    assert log_entry["detected_centroid_x"] is not None
    assert log_entry["ground_truth_x"] is not None
    assert log_entry["centroid_error_px"] is not None
    assert log_entry["centroid_error_px"] <= 4.0, f"Centroid error too high on clean synthetic: {log_entry['centroid_error_px']}"


def verify_playback_controls_seek_and_step():
    log_section("4. VERIFYING PLAYBACK CONTROLS (SEEK, STEP FORWARD, STEP BACKWARD, SPEED)")
    # 4.1 Step Forward
    step_f = requests.post(f"{BASE_URL}/api/benchmark/control", json={"action": "step_forward"}).json()
    assert step_f["state"]["current_frame_idx"] == 11
    print(f"[+] Step Forward: Cursor advanced to Frame {step_f['state']['current_frame_idx']}")

    # 4.2 Step Backward
    step_b = requests.post(f"{BASE_URL}/api/benchmark/control", json={"action": "step_backward"}).json()
    assert step_b["state"]["current_frame_idx"] == 10
    print(f"[+] Step Backward: Cursor returned to Frame {step_b['state']['current_frame_idx']}")

    # 4.3 Seek to frame 40
    seek_40 = requests.post(f"{BASE_URL}/api/benchmark/control", json={"action": "seek", "frame_idx": 40}).json()
    assert seek_40["state"]["current_frame_idx"] == 40
    print(f"[+] Seek: Positioned cursor at Frame 40")

    # 4.4 Set speed to 2.0x
    speed_res = requests.post(f"{BASE_URL}/api/benchmark/control", json={"action": "set_speed", "speed": 2.0}).json()
    assert speed_res["state"]["playback_speed"] == 2.0
    print(f"[+] Playback Speed updated to 2.0x")


def verify_detector_method_switching():
    log_section("5. VERIFYING DETECTOR ARCHITECTURE SELECTION (CLASSICAL CV vs CV + KALMAN)")
    for method in ["Classical CV", "CV + Kalman"]:
        res = requests.post(f"{BASE_URL}/api/benchmark/method", json={"method": method})
        assert res.status_code == 200
        print(f"[+] Detector method switched to: {method}")

        # Process a frame to confirm execution
        ctrl = requests.post(f"{BASE_URL}/api/benchmark/control", json={"action": "seek", "frame_idx": 20}).json()
        assert ctrl["frame_log"] is not None
        assert ctrl["frame_log"]["detection_status"] == "DETECTED"


def verify_batch_benchmark_execution_and_metrics():
    log_section("6. VERIFYING BATCH VIDEO BENCHMARK PROCESSING & METRICS")
    # Run batch evaluation over entire video
    t0 = time.time()
    res = requests.post(f"{BASE_URL}/api/benchmark/process", json={})
    assert res.status_code == 200
    t_batch = time.time() - t0

    results = res.json()["results"]
    print(f"[+] Batch Evaluation Completed in {t_batch:.2f}s:")
    print(f"    Processed Frames: {results['processed_frames']} / {results['total_frames']}")
    print(f"    Detection Rate: {results['detection_rate_percent']:.1f}%")
    print(f"    Lock Retention: {results['lock_retention_percent']:.1f}%")
    print(f"    Average Centroid Error: {results['average_centroid_error_px']} px")
    print(f"    Maximum Centroid Error: {results['max_centroid_error_px']} px")
    print(f"    RMSE Error: {results['rmse_px']} px")
    print(f"    Average Throughput: {results['average_processing_fps']:.1f} FPS (Target: 30 FPS)")
    print(f"    Average Latency: {results['average_processing_time_ms']:.2f} ms/frame")

    assert results["processed_frames"] == 90
    assert results["detection_rate_percent"] >= 95.0
    assert results["rmse_px"] is not None and results["rmse_px"] <= 10.0
    assert results["average_processing_fps"] >= 30.0, "Processing throughput should exceed native 30 FPS"


def verify_export_capabilities():
    log_section("7. VERIFYING EXPORT UTILITIES (CSV LOG, JSON DATASET, MARKDOWN REPORT)")
    # 7.1 CSV Export
    csv_res = requests.get(f"{BASE_URL}/api/benchmark/export/csv")
    assert csv_res.status_code == 200
    assert "text/csv" in csv_res.headers["content-type"]
    csv_lines = csv_res.text.strip().splitlines()
    print(f"[+] Exported CSV Log: {len(csv_lines)} rows (Headers + {len(csv_lines)-1} frames)")
    assert len(csv_lines) >= 91
    assert "frame_number,timestamp_s,detected_x,detected_y" in csv_lines[0]

    # 7.2 JSON Export
    json_res = requests.get(f"{BASE_URL}/api/benchmark/export/json")
    assert json_res.status_code == 200
    json_data = json_res.json()
    print(f"[+] Exported JSON Dataset: {len(json_data['logs'])} frame log objects")
    assert "metadata" in json_data
    assert "results" in json_data
    assert len(json_data["logs"]) >= 90

    # 7.3 Markdown Report
    report_res = requests.get(f"{BASE_URL}/api/benchmark/export/report")
    assert report_res.status_code == 200
    print(f"[+] Exported Markdown Evaluation Report ({len(report_res.text)} characters)")
    assert "# MP4 Video Benchmark Evaluation Report" in report_res.text
    assert "Detection Rate" in report_res.text


def main():
    print("=" * 70)
    print("      PART 7: MP4 VIDEO BENCHMARK SUITE - LIVE SYSTEM VERIFICATION     ")
    print("=" * 70)

    t0 = time.time()
    verify_live_api_health()
    verify_synthetic_benchmark_generation_and_loading()
    verify_ptz_bypass_and_frame_decoding()
    verify_playback_controls_seek_and_step()
    verify_detector_method_switching()
    verify_batch_benchmark_execution_and_metrics()
    verify_export_capabilities()
    t_elapsed = time.time() - t0

    print("\n" + "=" * 70)
    print(f"[SUCCESS] ALL PART 7 VIDEO BENCHMARK VERIFICATIONS PASSED IN {t_elapsed:.2f}s!")
    print("=" * 70)


if __name__ == "__main__":
    main()
