"""
test_handover.py
================
Unit tests for multi-satellite handover state machine, visibility checks,
prediction logic, metrics tracking, and API endpoints.
"""

import pytest
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.orbital.platform import Platform
from backend.app.orbital.handover import (
    HandoverConfig,
    HandoverManager,
    SatVisibility,
    HandoverEvent,
    _check_visibility,
)
from backend.app.orbital.scenario import (
    OrbitalScenarioConfig,
    OrbitalScenario,
    SatelliteConfig,
    UAVConfig,
)

client = TestClient(app)


def test_visibility_earth_blocking():
    cfg = HandoverConfig(min_elevation_deg=0.0, gimbal_pan_limit_deg=90.0, gimbal_tilt_limit_deg=90.0)
    # Sat on +X side of Earth, Beacon on -X side of Earth
    sat = Platform(pos_eci=(7000.0, 0.0, 0.0), vel_eci=(0.0, 7.5, 0.0), platform_type="SATELLITE")
    beacon = Platform(pos_eci=(-6400.0, 0.0, 0.0), vel_eci=(0.0, 0.0, 0.0), platform_type="UAV")
    vis = _check_visibility(sat, beacon, cfg)
    assert vis.blocked is True
    assert vis.can_see_now is False


def test_visibility_clear_los():
    cfg = HandoverConfig(min_elevation_deg=0.0, gimbal_pan_limit_deg=90.0, gimbal_tilt_limit_deg=90.0)
    # Sat directly overhead beacon at nadir (distance = 600 km)
    sat = Platform(pos_eci=(7000.0, 0.0, 0.0), vel_eci=(0.0, 7.5, 0.0), platform_type="SATELLITE")
    beacon = Platform(pos_eci=(6400.0, 0.0, 0.0), vel_eci=(0.0, 0.0, 0.0), platform_type="UAV")
    vis = _check_visibility(sat, beacon, cfg)
    assert vis.blocked is False
    assert vis.can_see_now is True
    assert vis.range_km == pytest.approx(600.0, abs=0.1)


def test_handover_manager_state_machine_transition():
    cfg = HandoverConfig(
        min_elevation_deg=5.0,
        lead_time_s=30.0,
        phase_offset_deg=5.0,
        backup_acquire_steps=2,
    )
    mgr = HandoverManager(cfg)
    assert mgr.active_index == 0
    assert mgr.backup_index == 1

    # Sat 0 nadir, Sat 1 also near nadir (both can see)
    sat0 = Platform(pos_eci=(7000.0, 0.0, 0.0), vel_eci=(0.0, 7.5, 0.0), platform_type="SATELLITE")
    sat1 = Platform(pos_eci=(6950.0, 200.0, 0.0), vel_eci=(0.0, 7.5, 0.0), platform_type="SATELLITE")
    beacon = Platform(pos_eci=(6400.0, 0.0, 0.0), vel_eci=(0.0, 0.0, 0.0), platform_type="UAV")

    telem = mgr.step(1.0, [sat0, sat1], beacon, current_pat_state="TRACKING")
    assert telem.state == "IDLE"
    assert telem.link_state == "LINK_OK"


def test_handover_no_coverage():
    cfg = HandoverConfig()
    mgr = HandoverManager(cfg)

    # Both satellites on opposite side of Earth
    sat0 = Platform(pos_eci=(7000.0, 0.0, 0.0), vel_eci=(0.0, 7.5, 0.0), platform_type="SATELLITE")
    sat1 = Platform(pos_eci=(7000.0, 100.0, 0.0), vel_eci=(0.0, 7.5, 0.0), platform_type="SATELLITE")
    beacon = Platform(pos_eci=(-6400.0, 0.0, 0.0), vel_eci=(0.0, 0.0, 0.0), platform_type="UAV")

    telem = mgr.step(5.0, [sat0, sat1], beacon, current_pat_state="SEARCHING")
    assert telem.state == "NO_COVERAGE"
    assert telem.link_state == "NO_COVERAGE"
    assert telem.pat_badge == "NO_COVERAGE"
    assert mgr.metrics.no_coverage_events == 1
    assert mgr.metrics.total_no_coverage_s == 5.0


def test_handover_successful_transfer():
    cfg = HandoverConfig(
        min_elevation_deg=5.0,
        lead_time_s=30.0,
        phase_offset_deg=5.0,
        backup_acquire_steps=2,
    )
    sc_cfg = OrbitalScenarioConfig(
        enable_handover=True,
        handover_config=cfg,
    )
    scenario = OrbitalScenario(sc_cfg)
    mgr = scenario.handover_manager
    assert mgr is not None

    # Step through until pass occurs and handover completes
    handover_occurred = False
    for step in range(250):
        telem = scenario.step(5.0, pat_state="TRACKING")
        ho = telem.handover
        if ho and ho["metrics"]["handover_count"] > 0:
            handover_occurred = True
            assert ho["metrics"]["successful_handovers"] >= 1
            break

    assert handover_occurred, "Handover did not trigger during overlapping pass"


def test_handover_api_endpoints():
    # POST configure handover
    resp = client.post("/api/orbital/handover/config", json={
        "enable": True,
        "min_elevation_deg": 5.0,
        "lead_time_s": 30.0,
        "phase_offset_deg": 5.0,
        "backup_acquire_steps": 2,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "handover_configured"
    assert data["phase_offset_deg"] == 5.0

    # GET metrics
    metrics_resp = client.get("/api/orbital/handover/metrics")
    assert metrics_resp.status_code == 200
    m_data = metrics_resp.json()
    assert "handover_count" in m_data
    assert "successful_handovers" in m_data
    assert "total_no_coverage_s" in m_data
