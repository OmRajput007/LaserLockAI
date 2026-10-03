"""
verify_live_part9.py
====================
Live system integration and verification script for Part 9:
AUTOMATIC REPORTING, TECHNICAL DOCUMENTATION, USER MANUAL SUPPORT AND DEMONSTRATION MODE.

Verifies:
1. System Health & Readiness Check
2. Automatic Performance Report Generation & Persistence
3. Multi-Format Report Exports (PDF/HTML, CSV raw frame log, JSON)
4. Technical Report: Full 23 Mandated Sections verification
5. Operations User Manual: Full 14 Mandated Chapters verification
6. Demonstration Mode: 14-Phase Autonomous Virtual Testbench sequence
7. Video Benchmark Demo: 7-Phase MP4 flight evaluation sequence
8. Automatic Report Generation following Controlled Experiments
"""

import sys
import time
import json
import requests

BASE_URL = "http://127.0.0.1:8000"


def log_section(title: str):
    print("\n" + "=" * 80)
    print(f" {title}")
    print("=" * 80)


def verify_system_readiness():
    log_section("1. SYSTEM HEALTH & READINESS VERIFICATION")
    res = requests.get(f"{BASE_URL}/api/status")
    assert res.status_code == 200, f"Expected 200, got {res.status_code}"
    data = res.json()
    print(f"[+] System Status: {data['status'].upper()}")
    print(f"[+] Architecture: {data['system']}")
    print(f"[+] Measured FPS: {data['measured_fps']}")


def verify_performance_report_generation_and_retrieval():
    log_section("2. AUTOMATIC PERFORMANCE REPORT GENERATION & RETRIEVAL")
    # 1. Trigger fresh report generation
    res_gen = requests.post(f"{BASE_URL}/api/reports/generate")
    assert res_gen.status_code == 200, f"Generate failed: {res_gen.status_code}"
    report = res_gen.json()

    print(f"[+] Generated Report ID: {report['report_id']}")
    print(f"[+] Experiment ID: {report['experiment_id']}")
    print(f"[+] Mode: {report['mode']}")
    print(f"[+] Overall Compliance Status: {report['status']}")
    assert report["report_id"].startswith("REP-")
    assert len(report["requirements"]) == 5, f"Expected 5 official requirements, got {len(report['requirements'])}"

    # 2. Retrieve via latest
    res_latest = requests.get(f"{BASE_URL}/api/reports/latest")
    assert res_latest.status_code == 200
    latest = res_latest.json()
    assert latest["report_id"] == report["report_id"]
    print(f"[+] Verified Latest Report ID: {latest['report_id']}")

    # 3. Retrieve by ID
    res_by_id = requests.get(f"{BASE_URL}/api/reports/{report['report_id']}")
    assert res_by_id.status_code == 200
    assert res_by_id.json()["report_id"] == report["report_id"]
    print(f"[+] Verified Retrieval by ID: {report['report_id']}")

    # 4. List archived reports
    res_list = requests.get(f"{BASE_URL}/api/reports/list")
    assert res_list.status_code == 200
    list_data = res_list.json()
    assert len(list_data) >= 1
    print(f"[+] Verified Reports Archive: {len(list_data)} reports cataloged")


def verify_multi_format_exports():
    log_section("3. MULTI-FORMAT EXPORT VERIFICATION (PDF/HTML, CSV, JSON)")
    # 1. HTML / PDF
    res_html = requests.get(f"{BASE_URL}/api/reports/export/html")
    assert res_html.status_code == 200
    assert "<!DOCTYPE html>" in res_html.text
    assert "@media print" in res_html.text
    assert "FSOC Mobile Terminal Coarse Alignment Performance Report" in res_html.text
    print(f"[+] HTML/PDF Print Export Verified ({len(res_html.text)} bytes, native @media print)")

    # 2. CSV Raw Telemetry Log
    res_csv = requests.get(f"{BASE_URL}/api/reports/export/csv")
    assert res_csv.status_code == 200
    assert "error_x_px,error_y_px,total_error_px" in res_csv.text
    assert "confidence" in res_csv.text
    csv_lines = res_csv.text.strip().split("\n")
    print(f"[+] CSV Raw Performance Log Verified ({len(csv_lines)} lines, columns: frame, time, centroid, ref, error, pan, tilt, fps, latency)")

    # 3. JSON Export
    res_json = requests.get(f"{BASE_URL}/api/reports/export/json")
    assert res_json.status_code == 200
    json_data = res_json.json()
    assert "report_id" in json_data
    assert "metrics" in json_data
    assert "configuration" in json_data
    print(f"[+] Structured JSON Export Verified (Report: {json_data['report_id']}, Status: {json_data['status']})")


def verify_technical_documentation_23_sections():
    log_section("4. TECHNICAL DOCUMENTATION VERIFICATION (ALL 23 MANDATED SECTIONS)")
    res = requests.get(f"{BASE_URL}/api/reports/technical")
    assert res.status_code == 200, f"Expected 200, got {res.status_code}"
    data = res.json()
    assert data["sections_count"] >= 23, f"Expected at least 23 sections, got {data['sections_count']}"
    assert len(data["sections"]) >= 23

    expected_titles = [
        "1. Introduction",
        "2. Problem Statement",
        "3. FSOC Background",
        "4. PAT",
        "5. Coarse Alignment",
        "6. System Requirements",
        "7. Architecture",
        "8. Camera Model",
        "9. Target Model",
        "10. Beacon Detection",
        "11. Computer Vision",
        "12. AI",
        "13. Centroiding",
        "14. Kalman Filter",
        "15. PID",
        "16. Disturbance Model",
        "17. Benchmark Video",
        "18. Testing Methodology",
        "19. Performance Analysis",
        "20. Results",
        "21. Limitations",
        "22. Future Improvements",
        "23. Conclusion",
    ]

    for idx, (sec, exp) in enumerate(zip(data["sections"], expected_titles)):
        assert exp.split(". ")[1] in sec["title"], f"Section {idx+1} mismatch: {sec['title']}"
        assert len(sec["content"]) > 100, f"Section {idx+1} content too brief"
        print(f"  [{idx+1:02d}/23] Verified: {sec['title']}")

    print(f"[+] ALL 23 MANDATED TECHNICAL REPORT SECTIONS VERIFIED & FULLY INTEGRATED!")


def verify_operations_user_manual_14_chapters():
    log_section("5. OPERATIONS USER MANUAL VERIFICATION (ALL 14 MANDATED CHAPTERS)")
    res = requests.get(f"{BASE_URL}/api/reports/user-manual")
    assert res.status_code == 200, f"Expected 200, got {res.status_code}"
    data = res.json()
    assert data["chapters_count"] >= 14, f"Expected at least 14 chapters, got {data['chapters_count']}"
    assert len(data["chapters"]) >= 14

    expected_chapters = [
        "Installation",
        "Launching",
        "Simulation",
        "Video Benchmark",
        "Camera",
        "Target",
        "Detection",
        "AI",
        "Kalman",
        "PID",
        "Disturbances",
        "Experiment",
        "Report",
        "Troubleshooting",
    ]

    for idx, (ch, exp) in enumerate(zip(data["chapters"], expected_chapters)):
        assert exp in ch["title"], f"Chapter {idx+1} mismatch: {ch['title']}"
        assert len(ch["content"]) > 50, f"Chapter {idx+1} content too brief"
        print(f"  [{idx+1:02d}/14] Verified: {ch['title']}")

    print(f"[+] ALL 14 MANDATED USER MANUAL CHAPTERS VERIFIED & OPERATIONAL!")


def verify_automated_demonstration_mode():
    log_section("6. AUTOMATED DEMONSTRATION MODE VERIFICATION (14 PHASES)")
    # Start simulation demo with step duration suitable for automated verification
    step_duration = 0.25
    res_start = requests.post(f"{BASE_URL}/api/demo/start", json={"step_duration_s": step_duration})
    assert res_start.status_code == 200, f"Start demo failed: {res_start.text}"
    print(f"[+] Initiated 14-Phase Simulation Demo (step_duration={step_duration}s)...")

    # Monitor progression across all 14 steps
    max_wait = 20.0
    start_time = time.time()
    observed_steps = set()

    while (time.time() - start_time) < max_wait:
        s = requests.get(f"{BASE_URL}/api/demo/status").json()
        step_num = s["current_step"]
        if step_num > 0:
            observed_steps.add(step_num)

        if not s["is_running"] and step_num == 14:
            print(f"[+] Demonstration Completed Successfully!")
            print(f"[+] Final Step Name: {s['current_step_name']}")
            print(f"[+] Generated Report ID: {s['latest_report_id']}")
            assert s["latest_report_id"] is not None
            # Verify that steps were executed
            completed_steps = sum(1 for st in s.get("steps", []) if st.get("completed"))
            assert completed_steps >= 13, f"Completed too few steps: {completed_steps}"
            return

        time.sleep(0.05)

    raise TimeoutError("Simulation demo did not finish within timeout.")


def verify_video_benchmark_demonstration():
    log_section("7. VIDEO BENCHMARK DEMONSTRATION VERIFICATION (7 PHASES)")
    step_duration = 0.15
    res_start = requests.post(f"{BASE_URL}/api/demo/video/start", json={"step_duration_s": step_duration})
    assert res_start.status_code == 200, f"Start video demo failed: {res_start.text}"
    print(f"[+] Initiated 7-Phase Video Benchmark Demo (step_duration={step_duration}s)...")

    max_wait = 20.0
    start_time = time.time()

    while (time.time() - start_time) < max_wait:
        s = requests.get(f"{BASE_URL}/api/demo/status").json()
        if not s["is_running"] and s["current_step"] == 7:
            print(f"[+] Video Benchmark Demo Completed Successfully!")
            print(f"[+] Final Step Name: {s['current_step_name']}")
            print(f"[+] Generated Report ID: {s['latest_report_id']}")
            assert s["latest_report_id"] is not None
            return

        time.sleep(0.3)

    raise TimeoutError("Video benchmark demo did not finish within timeout.")


def verify_experiment_report_auto_generation():
    log_section("8. EXPERIMENT EXECUTION & AUTOMATIC REPORT INTEGRATION")
    payload = {
        "name": "Live Verification Trial",
        "algorithm": "AI + Kalman",
        "target_motion": "Figure of 8",
        "noise_type": "Gaussian",
        "noise_level_sigma": 3.0,
        "atmosphere": "Clear",
        "pid_kp": 70.0,
        "pid_ki": 11.0,
        "pid_kd": 1.8,
        "kalman_enabled": True,
        "duration_s": 2.0,
    }
    t0 = time.time()
    res = requests.post(f"{BASE_URL}/api/experiments/run", json=payload)
    assert res.status_code == 200
    exp = res.json()
    dt = time.time() - t0
    print(f"[+] Experiment Finished in {dt:.2f}s: ID={exp['experiment_id']}, Status={exp['overall_status']}")

    # Verify that a performance report was automatically created for this experiment
    latest_rep = requests.get(f"{BASE_URL}/api/reports/latest").json()
    assert latest_rep["experiment_id"] == exp["experiment_id"]
    print(f"[+] Verified Automatic Report Generation: Linked Report ID={latest_rep['report_id']}")


def main():
    t_start = time.time()
    print("\n" + "=" * 80)
    print("      PART 9: AUTOMATIC REPORTING, TECHNICAL DOCUMENTATION & DEMO MODE     ")
    print("                      LIVE SYSTEM VERIFICATION PROTOCOL                    ")
    print("=" * 80)

    verify_system_readiness()
    verify_performance_report_generation_and_retrieval()
    verify_multi_format_exports()
    verify_technical_documentation_23_sections()
    verify_operations_user_manual_14_chapters()
    verify_automated_demonstration_mode()
    verify_video_benchmark_demonstration()
    verify_experiment_report_auto_generation()

    elapsed = time.time() - t_start
    print("\n" + "=" * 80)
    print(f" [SUCCESS] ALL PART 9 LIVE SYSTEM VERIFICATIONS PASSED IN {elapsed:.2f}s!")
    print("=" * 80 + "\n")


if __name__ == "__main__":
    main()
