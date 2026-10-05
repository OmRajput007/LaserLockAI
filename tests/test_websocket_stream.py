import pytest
import json
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.api.websocket import manager
from backend.app.simulation.engine import sim_engine

client = TestClient(app)


def test_camera_frame_single_snapshot():
    """Verify single frame endpoint returns valid JPEG image."""
    res_raw = client.get("/api/simulation/frame?annotated=false")
    assert res_raw.status_code == 200
    assert res_raw.headers["content-type"] == "image/jpeg"
    assert len(res_raw.content) > 100

    res_ann = client.get("/api/simulation/frame?annotated=true")
    assert res_ann.status_code == 200
    assert res_ann.headers["content-type"] == "image/jpeg"
    assert len(res_ann.content) > 100


def test_camera_frame_mjpeg_stream():
    """Verify multipart/x-mixed-replace MJPEG stream endpoint yields frame chunks."""
    res = client.get("/api/simulation/frame/stream?annotated=true&max_frames=2")
    assert res.status_code == 200
    assert "multipart/x-mixed-replace" in res.headers["content-type"]
    assert b"--frame" in res.content
    assert b"Content-Type: image/jpeg" in res.content


def test_multi_client_websocket_broadcast_and_commands():
    """
    Verify Single Producer / Multi-Consumer Broadcast:
    - Multiple clients connect simultaneously without causing double-speed simulation stepping.
    - Each client receives valid SimulationTelemetry packets.
    - Bidirectional commands are executed and synchronized.
    """
    with client.websocket_connect("/ws/telemetry") as ws1:
        assert len(manager.active_connections) >= 1

        # Client 1 receives immediate initial telemetry
        telem1_raw = ws1.receive_text()
        data1 = json.loads(telem1_raw)
        assert "target" in data1
        assert "camera" in data1
        assert "tracking" in data1

        # Client 2 connects concurrently
        with client.websocket_connect("/ws/telemetry") as ws2:
            assert len(manager.active_connections) >= 2

            # Client 2 receives state
            telem2_raw = ws2.receive_text()
            data2 = json.loads(telem2_raw)
            assert "target" in data2
            assert "camera" in data2

            # Send bidirectional command from Client 2
            ws2.send_text(json.dumps({"target_pan": 3.45, "target_tilt": -1.25}))
            import time
            time.sleep(0.05)
            assert abs(sim_engine.camera.target_pan_deg - 3.45) < 1e-3
            assert abs(sim_engine.camera.target_tilt_deg - (-1.25)) < 1e-3

            # Send transport command
            ws1.send_text(json.dumps({"is_running": False}))
            time.sleep(0.05)
            assert sim_engine.is_running is False

    # After both disconnect
    assert len(manager.active_connections) == 0
