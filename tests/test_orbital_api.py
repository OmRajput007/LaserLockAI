import pytest
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.simulation.engine import sim_engine

client = TestClient(app)

def test_orbital_config_get():
    response = client.get("/api/orbital/config")
    assert response.status_code == 200
    data = response.json()
    assert "camera_type" in data
    assert "beacon_type" in data
    assert "camera_sat" in data

def test_orbital_altitude_gap_rejected():
    # 100 km is in the unstable 20-300 km gap -> must be rejected with 400
    payload = {
        "camera_type": "SATELLITE",
        "beacon_type": "UAV",
        "camera_sat": {
            "preset": "Custom",
            "altitude_km": 100.0,
            "inclination_deg": 53.0,
            "phase_deg": 0.0,
            "raan_deg": 0.0,
        },
        "camera_uav": {
            "lat_deg": 28.6,
            "lon_deg": 77.2,
            "altitude_km": 10.0,
            "pattern": "Circular",
            "radius_km": 50.0,
            "speed_km_s": 0.25,
            "phase_deg": 0.0,
        },
        "beacon_sat": {
            "preset": "LEO-550",
            "altitude_km": 550.0,
            "inclination_deg": 53.0,
            "phase_deg": 180.0,
            "raan_deg": 0.0,
        },
        "beacon_uav": {
            "lat_deg": 28.6,
            "lon_deg": 77.2,
            "altitude_km": 10.0,
            "pattern": "Circular",
            "radius_km": 50.0,
            "speed_km_s": 0.25,
            "phase_deg": 0.0,
        },
        "atmosphere_margin_km": 100.0,
        "tilt_limit_deg": 30.0,
    }
    response = client.post("/api/orbital/config", json=payload)
    assert response.status_code == 400
    assert "unstable" in response.json()["detail"].lower()

def test_orbital_preset_switching_and_maneuver_note():
    payload = {
        "camera_type": "SATELLITE",
        "beacon_type": "SATELLITE",
        "camera_sat": {
            "preset": "LEO-550",
            "altitude_km": 550.0,
            "inclination_deg": 53.0,
            "phase_deg": 0.0,
            "raan_deg": 0.0,
        },
        "camera_uav": {
            "lat_deg": 28.6,
            "lon_deg": 77.2,
            "altitude_km": 10.0,
            "pattern": "Circular",
            "radius_km": 50.0,
            "speed_km_s": 0.25,
            "phase_deg": 0.0,
        },
        "beacon_sat": {
            "preset": "GEO",
            "altitude_km": 35786.0,
            "inclination_deg": 0.0,
            "phase_deg": 0.0,
            "raan_deg": 0.0,
        },
        "beacon_uav": {
            "lat_deg": 28.6,
            "lon_deg": 77.2,
            "altitude_km": 10.0,
            "pattern": "Circular",
            "radius_km": 50.0,
            "speed_km_s": 0.25,
            "phase_deg": 0.0,
        },
        "atmosphere_margin_km": 100.0,
        "tilt_limit_deg": 30.0,
    }
    response = client.post("/api/orbital/config", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "reinitialized"
    assert "maneuver_note" in data
    assert "re-initializes" in data["maneuver_note"]

def test_time_warp_restriction_when_running():
    sim_engine.is_running = True
    response = client.post("/api/orbital/time-warp", json={"time_warp": 10.0})
    assert response.status_code == 400
    assert "Time-warp locked to 1x" in response.json()["detail"]
    sim_engine.is_running = False

    # Allowed when stopped
    response_ok = client.post("/api/orbital/time-warp", json={"time_warp": 10.0})
    assert response_ok.status_code == 200
    assert response_ok.json()["time_warp"] == 10.0
