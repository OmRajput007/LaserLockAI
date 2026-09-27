"""
test_part9.py
=============
Unit tests for Part 9:
- Automatic Performance Reporting
- Technical Documentation (23 Mandated Sections)
- User Manual (14 Mandated Chapters)
- Multi-Format Export (PDF/HTML, CSV, JSON)
- Raw Performance Telemetry Log (with strict ground-truth policy)
- Demonstration Mode (14-Phase Simulation Demo)
- Video Benchmark Demo (7-Phase Flight Demo)
"""

import os
import json
import pytest
import numpy as np

from backend.app.config.defaults import get_default_config
from backend.app.models.config_model import SystemConfig
from backend.app.models.analytics_model import PerformanceMetrics, OfficialRequirementStatus, TelemetryPoint
from backend.app.models.report_model import PerformanceReport, RawFrameLogEntry
from backend.app.reports.report_generator import ReportGenerator
from backend.app.reports.technical_documentation import TECHNICAL_REPORT_SECTIONS, USER_MANUAL_CHAPTERS
from backend.app.demo.demo_orchestrator import DemoOrchestrator


@pytest.fixture
def temp_reports_dir(tmp_path):
    reports_dir = tmp_path / "reports"
    reports_dir.mkdir()
    return str(reports_dir)


@pytest.fixture
def sample_metrics_and_reqs():
    metrics = PerformanceMetrics(
        simulation_duration_s=10.0,
        average_fps=30.0,
        min_fps=28.5,
        max_fps=31.2,
        average_processing_time_ms=12.5,
        max_processing_time_ms=18.0,
        acquisition_time_s=0.65,
        reacquisition_time_s=0.25,
        average_tracking_error_px=3.85,
        max_tracking_error_px=7.20,
        average_centroid_error_px=3.85,
        max_centroid_error_px=7.20,
        rmse_px=4.10,
        target_loss_percent=0.8,
        lock_retention_percent=98.5,
        detection_rate_percent=99.2,
        average_confidence=0.91,
        average_snr_db=18.4,
    )
    reqs = [
        OfficialRequirementStatus(
            parameter="Acquisition Time",
            required="<= 2.0 s",
            actual="0.65 s",
            margin=1.35,
            status="PASS",
            unit="s",
        ),
        OfficialRequirementStatus(
            parameter="Tracking Error",
            required="<= 10.0 px",
            actual="3.85 px",
            margin=6.15,
            status="PASS",
            unit="px",
        ),
        OfficialRequirementStatus(
            parameter="Target Loss",
            required="< 5.0 %",
            actual="0.8 %",
            margin=4.2,
            status="PASS",
            unit="%",
        ),
        OfficialRequirementStatus(
            parameter="Re-acquisition Time",
            required="<= 1.0 s",
            actual="0.25 s",
            margin=0.75,
            status="PASS",
            unit="s",
        ),
        OfficialRequirementStatus(
            parameter="Processing Speed",
            required=">= 20.0 FPS",
            actual="30.0 FPS",
            margin=10.0,
            status="PASS",
            unit="FPS",
        ),
    ]
    time_series = [
        TelemetryPoint(
            time_s=i * 0.033,
            frame_number=i + 1,
            target_x=320.0 + i * 0.1,
            target_y=240.0 + i * 0.05,
            centroid_x=321.0 + i * 0.1,
            centroid_y=239.5 + i * 0.05,
            tracking_error_px=3.5,
            centroid_error_px=1.1,
            is_detected=True,
            target_state="LOCKED",
            confidence=0.92,
            fps=30.0,
            processing_time_ms=12.0,
            pan_deg=0.5,
            tilt_deg=-0.2,
        )
        for i in range(20)
    ]
    return metrics, reqs, time_series


def test_report_generator_full_pipeline(temp_reports_dir, sample_metrics_and_reqs):
    """Verifies automated report generation, persistence, and compliance certification."""
    metrics, reqs, time_series = sample_metrics_and_reqs
    cfg = get_default_config()

    gen = ReportGenerator(reports_dir=temp_reports_dir)
    report = gen.generate_performance_report(
        config=cfg,
        metrics=metrics,
        requirements=reqs,
        time_series=time_series,
        mode="Simulation Testbench",
        experiment_id="EXP-UNITTEST-001",
    )

    assert report.report_id.startswith("REP-")
    assert report.experiment_id == "EXP-UNITTEST-001"
    assert report.status == "PASS"
    assert len(report.requirements) == 5
    assert report.metrics.average_tracking_error_px == 3.85
    assert len(report.raw_log_sample) == 20

    # Verify disk persistence
    json_path = os.path.join(temp_reports_dir, f"{report.report_id}.json")
    md_path = os.path.join(temp_reports_dir, f"{report.report_id}.md")
    csv_path = os.path.join(temp_reports_dir, f"{report.report_id}_raw_log.csv")

    assert os.path.exists(json_path)
    assert os.path.exists(md_path)
    assert os.path.exists(csv_path)

    # Verify retrieval
    loaded = gen.get_report(report.report_id)
    assert loaded is not None
    assert loaded.report_id == report.report_id
    assert loaded.status == "PASS"

    latest = gen.get_latest_report()
    assert latest is not None
    assert latest.report_id == report.report_id


def test_multi_format_exports(temp_reports_dir, sample_metrics_and_reqs):
    """Verifies PDF/HTML, CSV, and JSON export formats."""
    metrics, reqs, time_series = sample_metrics_and_reqs
    cfg = get_default_config()

    gen = ReportGenerator(reports_dir=temp_reports_dir)
    report = gen.generate_performance_report(
        config=cfg,
        metrics=metrics,
        requirements=reqs,
        time_series=time_series,
    )

    # 1. HTML / PDF printable representation
    html_export = gen.export_html(report.report_id)
    assert "<!DOCTYPE html>" in html_export
    assert "@media print" in html_export
    assert report.report_id in html_export
    assert "Official Requirements Verification Dashboard" in html_export

    # 2. CSV Raw Telemetry Log
    csv_export = gen.export_csv(report.report_id)
    assert "frame_number,timestamp_s,centroid_x,centroid_y" in csv_export
    assert "confidence,detection_status,tracking_state" in csv_export
    lines = csv_export.strip().split("\n")
    assert len(lines) == 21  # 1 header + 20 frames

    # 3. JSON Export
    json_export = gen.export_json(report.report_id)
    data = json.loads(json_export)
    assert data["report_id"] == report.report_id
    assert data["status"] == "PASS"
    assert "metrics" in data
    assert "configuration" in data


def test_raw_log_strict_ground_truth_policy(temp_reports_dir):
    """Verifies ground truth reference coordinates are ONLY included when actual GT exists."""
    cfg = get_default_config()
    metrics = PerformanceMetrics(simulation_duration_s=2.0)
    reqs = []

    # Sequence without ground truth (e.g. video without GT metadata)
    pts_without_gt = [
        TelemetryPoint(
            time_s=0.1,
            frame_number=1,
            centroid_x=315.0,
            centroid_y=238.0,
            tracking_error_px=5.0,
            centroid_error_px=None,  # No GT available
            is_detected=True,
        )
    ]

    gen = ReportGenerator(reports_dir=temp_reports_dir)
    rep1 = gen.generate_performance_report(cfg, metrics, reqs, pts_without_gt)
    entry1 = rep1.raw_log_sample[0]
    # Reference coordinates must be None
    assert entry1.reference_x is None
    assert entry1.reference_y is None

    # Sequence with ground truth
    pts_with_gt = [
        TelemetryPoint(
            time_s=0.1,
            frame_number=1,
            centroid_x=315.0,
            centroid_y=238.0,
            tracking_error_px=5.0,
            centroid_error_px=2.5,  # GT was verified!
            is_detected=True,
        )
    ]
    rep2 = gen.generate_performance_report(cfg, metrics, reqs, pts_with_gt)
    entry2 = rep2.raw_log_sample[0]
    assert entry2.reference_x is not None
    assert entry2.reference_y is not None


def test_technical_report_23_mandated_sections():
    """Verifies all 23 mandated technical documentation sections are complete."""
    gen = ReportGenerator()
    tech = gen.get_technical_report()
    assert tech["sections_count"] == 23
    assert len(tech["sections"]) == 23

    expected_titles = [
        "Introduction",
        "Problem Statement",
        "FSOC Background",
        "PAT",
        "Coarse Alignment",
        "System Requirements",
        "Architecture",
        "Camera Model",
        "Target Model",
        "Beacon Detection",
        "Computer Vision",
        "AI",
        "Centroiding",
        "Kalman Filter",
        "PID",
        "Disturbance Model",
        "Benchmark Video",
        "Testing Methodology",
        "Performance Analysis",
        "Results",
        "Limitations",
        "Future Improvements",
        "Conclusion",
    ]

    for idx, expected in enumerate(expected_titles):
        sec = tech["sections"][idx]
        assert sec["id"] == idx + 1
        assert expected in sec["title"]
        assert len(sec["content"]) > 100
        assert len(sec["summary"]) > 10


def test_user_manual_14_mandated_chapters():
    """Verifies all 14 mandated user manual chapters are present with clear instructions."""
    gen = ReportGenerator()
    manual = gen.get_user_manual()
    assert manual["chapters_count"] == 14
    assert len(manual["chapters"]) == 14

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

    for idx, expected in enumerate(expected_chapters):
        ch = manual["chapters"][idx]
        assert ch["id"] == idx + 1
        assert expected in ch["title"]
        assert len(ch["content"]) > 50


def test_demo_orchestrator_simulation_demo():
    """Verifies DemoOrchestrator manages the 14-phase simulation demo."""
    orchestrator = DemoOrchestrator()
    status = orchestrator.get_status()
    assert status.is_running is False
    assert status.demo_type == "IDLE"

    # Start simulation demo with rapid step duration for testing
    started = orchestrator.start_simulation_demo(step_duration_s=0.1)
    assert started is True

    # Immediate second start should be rejected (concurrency guard)
    second_start = orchestrator.start_simulation_demo(step_duration_s=0.1)
    assert second_start is False

    # Check status during execution
    status_active = orchestrator.get_status()
    assert status_active.is_running is True
    assert status_active.demo_type == "SIMULATION_DEMO"
    assert status_active.total_steps == 14
    assert len(status_active.steps) == 14

    # Halt demo gracefully
    orchestrator.stop_demo()
    assert orchestrator.stop_requested is True


def test_demo_orchestrator_video_demo():
    """Verifies DemoOrchestrator manages the 7-phase MP4 video benchmark demo."""
    orchestrator = DemoOrchestrator()
    started = orchestrator.start_video_demo(step_duration_s=0.1)
    assert started is True

    status = orchestrator.get_status()
    assert status.is_running is True
    assert status.demo_type == "VIDEO_DEMO"
    assert status.total_steps == 7
    assert len(status.steps) == 7

    orchestrator.stop_demo()
    assert orchestrator.stop_requested is True
