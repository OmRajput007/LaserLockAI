"""
Live Verification Script for Part 3:
Real Image Generation and Computer Vision Beacon Detection
"""
import urllib.request
import json
import numpy as np
import cv2

BASE_URL = "http://127.0.0.1:8000"

def run_verification():
    print("=" * 60)
    print("RUNNING LIVE END-TO-END VERIFICATION: PART 3")
    print("=" * 60)

    # 1. Health check
    req = urllib.request.Request(f"{BASE_URL}/api/status")
    with urllib.request.urlopen(req) as response:
        status_data = json.loads(response.read().decode())
        print(f"[+] Subsystem Status: {status_data['status']}")
        print(f"[+] Version: {status_data['version']}")

    # 2. Reset config to default and configure Center mode for immediate beacon visibility
    reset_req = urllib.request.Request(f"{BASE_URL}/api/config/reset", method="POST")
    with urllib.request.urlopen(reset_req) as response:
        cfg = json.loads(response.read().decode())
        print(f"[+] System configuration reset to defaults. Target Shape: {cfg['target']['shape']}")

    # Set initial target to center
    cfg['target']['initial_location_mode'] = 'Center'
    cfg['target']['flicker_enabled'] = True
    cfg['target']['flicker_frequency_hz'] = 5.0
    cfg['target']['flicker_depth'] = 0.35
    update_req = urllib.request.Request(
        f"{BASE_URL}/api/config",
        data=json.dumps(cfg).encode('utf-8'),
        headers={'Content-Type': 'application/json'},
        method="POST"
    )
    with urllib.request.urlopen(update_req) as response:
        updated_cfg = json.loads(response.read().decode())
        print(f"[+] Target configured at boresight center with 5Hz optical flicker modulation")

    # 3. Step simulation and retrieve telemetry
    step_req = urllib.request.Request(f"{BASE_URL}/api/simulation/step", method="POST")
    with urllib.request.urlopen(step_req) as response:
        telem = json.loads(response.read().decode())
        det = telem['detection']
        print(f"[+] Simulation Step executed:")
        print(f"    - Beacon Detected: {det['beacon_detected']}")
        print(f"    - Centroid (Bx, By): ({det['detected_centroid_x']}, {det['detected_centroid_y']})")
        print(f"    - Pixel Error: Ex={det['pixel_error_x']}, Ey={det['pixel_error_y']}, Total={det['total_pixel_error']} px")
        print(f"    - Angular Error: thX={det['angular_error_x_deg']} deg, thY={det['angular_error_y_deg']} deg")
        print(f"    - Confidence: {det['confidence']} | SNR: {det['snr_db']} dB")
        print(f"    - Candidates Count: {det['candidate_count']}")
        print(f"    - CV Processing Latency: {det['processing_time_ms']} ms")

        assert det['beacon_detected'] is True, "Beacon should be detected at boresight!"
        assert det['confidence'] > 0.7, "Confidence should be > 0.7!"

    # 4. Fetch Raw Camera Frame JPEG
    frame_raw_req = urllib.request.Request(f"{BASE_URL}/api/simulation/frame?annotated=false")
    with urllib.request.urlopen(frame_raw_req) as response:
        raw_bytes = response.read()
        nparr = np.frombuffer(raw_bytes, np.uint8)
        img_raw = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        print(f"[+] Raw camera frame fetched: {img_raw.shape}, {len(raw_bytes)} bytes")
        assert img_raw.shape == (480, 640, 3)

    # 5. Fetch Annotated Camera Frame JPEG
    frame_ann_req = urllib.request.Request(f"{BASE_URL}/api/simulation/frame?annotated=true")
    with urllib.request.urlopen(frame_ann_req) as response:
        ann_bytes = response.read()
        nparr = np.frombuffer(ann_bytes, np.uint8)
        img_ann = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        print(f"[+] Annotated camera frame fetched: {img_ann.shape}, {len(ann_bytes)} bytes")
        assert img_ann.shape == (480, 640, 3)

    # 6. Fetch Detection Intermediates Pipeline
    pipe_req = urllib.request.Request(f"{BASE_URL}/api/simulation/detection/intermediates")
    with urllib.request.urlopen(pipe_req) as response:
        pipe_data = json.loads(response.read().decode())
        stages = list(pipe_data['stages'].keys())
        print(f"[+] Intermediate pipeline stages resolved: {stages}")
        assert "grayscale" in stages
        assert "preprocessed" in stages
        assert "threshold" in stages
        assert "morphed" in stages

    print("=" * 60)
    print("ALL PART 3 VERIFICATIONS PASSED SUCCESSFULLY!")
    print("=" * 60)

if __name__ == "__main__":
    run_verification()
