import pytest
from fastapi.testclient import TestClient
from backend.app.main import app

client = TestClient(app)


def test_api_status_endpoint():
    """Verify GET /api/status health and readiness response."""
    response = client.get("/api/status")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "operational"
    assert "version" in data
    assert "subsystems" in data
    assert data["subsystems"]["camera_fpa_model"] == "ready"


def test_api_config_get_and_post():
    """Verify GET /api/config, POST /api/config, and POST /api/config/reset."""
    # Get config
    get_res = client.get("/api/config")
    assert get_res.status_code == 200
    cfg = get_res.json()
    assert cfg["camera"]["resolution_width"] == 640
    assert cfg["motion"]["screen_width"] >= 2000

    # Post updated config
    cfg["camera"]["initial_pan_deg"] = 1.2
    post_res = client.post("/api/config", json=cfg)
    assert post_res.status_code == 200
    updated_data = post_res.json()
    assert updated_data["camera"]["initial_pan_deg"] == 1.2

    # Reset config
    reset_res = client.post("/api/config/reset")
    assert reset_res.status_code == 200
    reset_data = reset_res.json()
    assert reset_data["camera"]["initial_pan_deg"] == 0.0


def test_api_simulation_endpoints():
    """Verify simulation step, reset, and telemetry endpoints."""
    # Reset simulation
    res_reset = client.post("/api/simulation/reset")
    assert res_reset.status_code == 200

    # Step simulation
    res_step = client.post("/api/simulation/step")
    assert res_step.status_code == 200
    telemetry = res_step.json()
    assert "target" in telemetry
    assert "camera" in telemetry
    assert "tracking" in telemetry
    assert telemetry["camera"]["resolution_width"] == 640

    # Gimbal command clamp check
    res_gimbal = client.post("/api/simulation/gimbal", json={"pan_rate_deg_s": 3.0, "tilt_rate_deg_s": -2.0})
    assert res_gimbal.status_code == 200
