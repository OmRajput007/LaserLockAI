import time
import requests
import json

BASE_URL = "http://127.0.0.1:8000"


def log_section(title: str):
    print("\n" + "=" * 70)
    print(f"[*] {title}")
    print("=" * 70)


def verify_server_status():
    log_section("1. VERIFYING LIVE SERVER STATUS")
    res = requests.get(f"{BASE_URL}/api/status")
    assert res.status_code == 200, f"Server status check failed: {res.text}"
    data = res.json()
    print(f"[+] Server Status: {data['status']}")
    print(f"[+] System: {data['system']}")


def verify_live_simulation_and_analytics_accumulation():
    log_section("2. VERIFYING SIMULATION STEP & ANALYTICS ACCUMULATION")
    # Take 30 simulation steps to accumulate telemetry
    for _ in range(30):
        step_res = requests.post(f"{BASE_URL}/api/simulation/step", json={"dt": 0.0333})
        assert step_res.status_code == 200

    # Fetch analytics summary
    sum_res = requests.get(f"{BASE_URL}/api/analytics/summary")
    assert sum_res.status_code == 200
    data = sum_res.json()
    metrics = data["metrics"]
    reqs = data["requirements"]

    print(f"[+] Accumulated Frames: {metrics['total_frames']}")
    print(f"[+] Simulation Duration: {metrics['simulation_duration_s']}s")
    print(f"[+] Average FPS: {metrics['average_fps']} FPS")
    print(f"[+] Average Processing Latency: {metrics['average_processing_time_ms']} ms")
    print(f"[+] Average Tracking Error: {metrics['average_tracking_error_px']} px")
    print(f"[+] Lock Retention: {metrics['lock_retention_percent']}%")
    print(f"[+] Target Loss: {metrics['target_loss_percent']}%")
    print(f"[+] Detection Rate: {metrics['detection_rate_percent']}%")
    print(f"[+] Overall Requirements Compliance: {data['overall_compliance']}")

    assert metrics["total_frames"] >= 30
    assert metrics["average_fps"] > 0
    assert metrics["average_processing_time_ms"] > 0


def verify_official_requirements_dashboard():
    log_section("3. VERIFYING OFFICIAL REQUIREMENTS DASHBOARD TABLE")
    res = requests.get(f"{BASE_URL}/api/analytics/requirements")
    assert res.status_code == 200
    reqs = res.json()
    assert len(reqs) == 5

    print(f"{'PARAMETER':<22} | {'REQUIRED':<12} | {'ACTUAL':<20} | {'STATUS':<8}")
    print("-" * 70)
    for r in reqs:
        req_str = r['required'].replace('≤', '<=').replace('≥', '>=')
        act_str = r['actual'].replace('≤', '<=').replace('≥', '>=')
        print(f"{r['parameter']:<22} | {req_str:<12} | {act_str:<20} | {r['status']:<8}")

    req_map = {r["parameter"]: r for r in reqs}
    assert "Acquisition Time" in req_map
    assert "Tracking Error" in req_map
    assert "Target Loss" in req_map
    assert "Re-acquisition" in req_map
    assert "Processing Speed" in req_map


def verify_11_realtime_chart_series():
    log_section("4. VERIFYING 11 REAL-TIME TELEMETRY CHART SERIES")
    res = requests.get(f"{BASE_URL}/api/analytics/charts?window=30")
    assert res.status_code == 200
    points = res.json()
    assert len(points) > 0

    pt = points[-1]
    expected_channels = [
        "time_s",
        "tracking_error_px",
        "centroid_error_px",
        "angular_error_deg",
        "centroid_x",
        "centroid_y",
        "pan_deg",
        "tilt_deg",
        "fps",
        "processing_time_ms",
        "confidence",
        "snr_db",
    ]
    for ch in expected_channels:
        assert ch in pt, f"Channel {ch} missing from TelemetryPoint"

    print(f"[+] Retrieved {len(points)} Time-Series Snapshots across all 11 Telemetry Channels:")
    print(f"    Time: {pt['time_s']}s | Tracking Err: {pt['tracking_error_px']} px | Centroid Err: {pt['centroid_error_px']} px")
    print(f"    Centroid: ({pt['centroid_x']}, {pt['centroid_y']}) | Pan/Tilt: ({pt['pan_deg']} deg, {pt['tilt_deg']} deg)")
    print(f"    Throughput: {pt['fps']} FPS | Latency: {pt['processing_time_ms']} ms | SNR: {pt['snr_db']} dB")


def verify_5_algorithm_objective_comparison():
    log_section("5. VERIFYING 5-ALGORITHM OBJECTIVE BENCHMARK COMPARISON")
    t0 = time.time()
    res = requests.post(
        f"{BASE_URL}/api/experiments/compare",
        json={"scenario_name": "Part 8 Verification Slew", "duration_s": 1.0},
    )
    assert res.status_code == 200
    dt = time.time() - t0
    data = res.json()
    algos = data["compared_algorithms"]
    assert len(algos) == 5

    print(f"[+] Benchmark Completed in {dt:.2f}s across 5 Candidate Architectures:")
    print(f"{'ALGORITHM':<20} | {'MEAN ERR (px)':<14} | {'RMSE (px)':<10} | {'LOCK %':<8} | {'FPS':<6} | {'STATUS'}")
    print("-" * 75)
    for a in algos:
        status = "PASS" if a["overall_pass"] else f"{a['passed_requirements_count']}/5 Pass"
        print(
            f"{a['algorithm_name']:<20} | {a['mean_tracking_error_px']:<14.2f} | "
            f"{a['rmse_px']:<10.2f} | {a['lock_retention_percent']:<8.1f} | "
            f"{a['average_fps']:<6.1f} | {status}"
        )


def verify_experiment_mode_lifecycle():
    log_section("6. VERIFYING EXPERIMENT CREATION, RETRIEVAL & EXPORTS")
    # 1. Create and archive experimental trial
    create_payload = {
        "name": "Live Verification Cross-Track Trial",
        "algorithm": "AI + Kalman + PID",
        "target_motion": "Figure of 8",
        "noise_type": "Gaussian",
        "noise_level_sigma": 3.0,
        "atmosphere": "Clear",
        "pid_kp": 1.4,
        "pid_ki": 0.05,
        "pid_kd": 0.18,
        "kalman_enabled": True,
        "duration_s": 1.5,
    }
    run_res = requests.post(f"{BASE_URL}/api/experiments/run", json=create_payload)
    assert run_res.status_code == 200
    exp = run_res.json()
    exp_id = exp["experiment_id"]
    print(f"[+] Created & Archived Experiment: {exp_id} ({exp['name']})")
    print(f"    Mean Error: {exp['metrics']['average_tracking_error_px']} px | Status: {exp['overall_status']}")

    # 2. List experiments
    list_res = requests.get(f"{BASE_URL}/api/experiments/list")
    assert list_res.status_code == 200
    assert any(e["experiment_id"] == exp_id for e in list_res.json())
    print(f"[+] Archived Experiments Count: {len(list_res.json())}")

    # 3. Get experiment details
    detail_res = requests.get(f"{BASE_URL}/api/experiments/{exp_id}")
    assert detail_res.status_code == 200
    assert detail_res.json()["algorithm"] == "AI + Kalman + PID"

    # 4. Export CSV & JSON
    csv_res = requests.get(f"{BASE_URL}/api/experiments/export/csv")
    assert csv_res.status_code == 200
    assert exp_id in csv_res.text
    print(f"[+] Exported Experiments CSV ({len(csv_res.text.splitlines())} lines)")

    json_res = requests.get(f"{BASE_URL}/api/experiments/export/json")
    assert json_res.status_code == 200
    assert isinstance(json_res.json(), list)
    print(f"[+] Exported Experiments JSON ({len(json_res.json())} objects)")

    # 5. Delete experiment
    del_res = requests.delete(f"{BASE_URL}/api/experiments/{exp_id}")
    assert del_res.status_code == 200
    assert del_res.json()["status"] == "deleted"
    print(f"[+] Deleted Experiment {exp_id} cleanly")


def main():
    print("=" * 70)
    print("      PART 8: REAL-TIME ANALYTICS & VALIDATION - LIVE TESTBENCH     ")
    print("=" * 70)
    t0 = time.time()
    verify_server_status()
    verify_live_simulation_and_analytics_accumulation()
    verify_official_requirements_dashboard()
    verify_11_realtime_chart_series()
    verify_5_algorithm_objective_comparison()
    verify_experiment_mode_lifecycle()
    total_time = time.time() - t0
    print("\n" + "=" * 70)
    print(f"[SUCCESS] ALL PART 8 LIVE VERIFICATIONS PASSED IN {total_time:.2f}s!")
    print("=" * 70)


if __name__ == "__main__":
    main()
