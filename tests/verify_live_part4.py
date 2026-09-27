import time
import requests
import json

BASE_URL = "http://127.0.0.1:8000"

def main():
    print("[*] Starting Part 4 Live End-to-End Verification against", BASE_URL)

    # 1. Check server status
    res = requests.get(f"{BASE_URL}/api/status")
    assert res.status_code == 200, f"Server status check failed: {res.text}"
    print("[+] Server is alive and responding.")

    # 2. Test Setting Detection Method: Classical CV
    print("\n[+] Testing Method 1: Classical CV...")
    res = requests.post(f"{BASE_URL}/api/simulation/detection/method", json={"method": "Classical CV"})
    assert res.status_code == 200, f"Method update failed: {res.text}"
    step_res = requests.post(f"{BASE_URL}/api/simulation/step")
    assert step_res.status_code == 200
    telemetry = step_res.json()
    det = telemetry["detection"]
    print(f"    Active Method: {det['active_method']}")
    print(f"    Kalman Active: {det['kalman_active']}")
    print(f"    Beacon Detected: {det['beacon_detected']}")
    assert det["active_method"] == "Classical CV"
    assert det["kalman_active"] is False

    # 3. Test Setting Detection Method: AI Detector (Truthful Fallback Check)
    print("\n[+] Testing Method 2: AI Detector...")
    res = requests.post(f"{BASE_URL}/api/simulation/detection/method", json={"method": "AI Detector"})
    assert res.status_code == 200
    step_res = requests.post(f"{BASE_URL}/api/simulation/step")
    det = step_res.json()["detection"]
    print(f"    Active Method: {det['active_method']}")
    print(f"    AI Model Loaded: {det['ai_model_loaded']} (Truthful)")
    print(f"    AI Model Status: {det['ai_model_status']}")
    assert "AI Detector" in det["active_method"]
    assert det["ai_model_loaded"] is False  # Must be truthful

    # 4. Test Setting Detection Method: CV + Kalman
    print("\n[+] Testing Method 3: CV + Kalman...")
    res = requests.post(f"{BASE_URL}/api/simulation/detection/method", json={"method": "CV + Kalman"})
    assert res.status_code == 200
    # Step multiple times to build velocity tracking
    for _ in range(8):
        step_res = requests.post(f"{BASE_URL}/api/simulation/step")
    det = step_res.json()["detection"]
    print(f"    Active Method: {det['active_method']}")
    print(f"    Kalman Active: {det['kalman_active']}")
    print(f"    Kalman Predicted: ({det['kalman_predicted_x']}, {det['kalman_predicted_y']})")
    print(f"    Kalman Velocity: ({det['kalman_velocity_x']}, {det['kalman_velocity_y']}) px/s")
    assert det["active_method"] == "CV + Kalman"
    assert det["kalman_active"] is True

    # 5. Test Setting Detection Method: AI + Kalman
    print("\n[+] Testing Method 4: AI + Kalman...")
    res = requests.post(f"{BASE_URL}/api/simulation/detection/method", json={"method": "AI + Kalman"})
    assert res.status_code == 200
    for _ in range(5):
        step_res = requests.post(f"{BASE_URL}/api/simulation/step")
    det = step_res.json()["detection"]
    print(f"    Active Method: {det['active_method']}")
    print(f"    Kalman Active: {det['kalman_active']}")
    assert "AI + Kalman" in det["active_method"]
    assert det["kalman_active"] is True

    # 6. Test Clutter Injection & Multi-Criteria Rejection
    print("\n[+] Testing Target Identification & False Bright Object Rejection...")
    clutter_res = requests.post(
        f"{BASE_URL}/api/simulation/detection/clutter",
        json={"inject": True, "count": 2, "reject_false_bright_objects": True},
    )
    assert clutter_res.status_code == 200
    for _ in range(3):
        step_res = requests.post(f"{BASE_URL}/api/simulation/step")
    det = step_res.json()["detection"]
    print(f"    Raw Candidate Contours: {det['raw_candidate_count']}")
    print(f"    Accepted Valid Candidates: {det['candidate_count']}")
    print(f"    Rejected Clutter Count: {det['rejected_clutter_count']}")
    print(f"    Target Classification: {det['target_classification']}")
    assert det["raw_candidate_count"] >= 2
    assert det["rejected_clutter_count"] >= 1

    # Disable clutter injection after test
    requests.post(f"{BASE_URL}/api/simulation/detection/clutter", json={"inject": False})

    # 7. Test Side-by-Side Comparison Endpoint
    print("\n[+] Testing Detector Comparison Endpoint (/comparison)...")
    comp_res = requests.get(f"{BASE_URL}/api/simulation/detection/comparison")
    assert comp_res.status_code == 200
    comp_data = comp_res.json()
    cv_info = comp_data["classical_cv"]
    ai_info = comp_data["ai_detector"]
    print("    Classical CV:", cv_info)
    print("    AI Detector:", ai_info)
    assert "latency_ms" in cv_info
    assert "latency_ms" in ai_info
    assert cv_info["latency_ms"] >= 0.0
    assert ai_info["latency_ms"] >= 0.0

    # 8. Test AI Configuration update endpoint
    print("\n[+] Testing AI Configuration Update Endpoint (/ai)...")
    ai_res = requests.post(
        f"{BASE_URL}/api/simulation/detection/ai",
        json={"ai_inference_device": "DirectML", "ai_confidence_threshold": 0.7},
    )
    assert ai_res.status_code == 200
    ai_config = ai_res.json()["ai_config"]
    assert ai_config["inference_device"] == "DirectML"
    assert ai_config["confidence_threshold"] == 0.7
    print("    AI Config Updated Successfully:", ai_config)

    print("\n=======================================================")
    print("[SUCCESS] ALL PART 4 LIVE END-TO-END CHECKS PASSED 100%!")
    print("=======================================================")

if __name__ == "__main__":
    main()
