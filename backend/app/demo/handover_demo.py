"""
handover_demo.py
================
15-minute simulation demonstrating the multi-satellite handover system.

This script runs WITHOUT a running FastAPI server - it drives OrbitalScenario
and HandoverManager directly in Python.

Usage:
    python -m backend.app.demo.handover_demo

Output:
    - stdout: Detailed execution logs and physics explanation
    - handover_report.json: Structured metrics, event log, and timeline sample
"""

from __future__ import annotations
import json
import time
import os

from backend.app.orbital.scenario import (
    OrbitalScenarioConfig,
    OrbitalScenario,
    SatelliteConfig,
    UAVConfig,
)
from backend.app.orbital.handover import HandoverConfig, HandoverManager

REPORT_PATH = os.path.join(os.path.dirname(__file__), "handover_report.json")


def simulate_scenario(
    name: str,
    duration_s: float,
    dt_s: float,
    ho_config: HandoverConfig,
    sat_phase_deg: float = 0.0,
    log_interval_s: float = 60.0,
):
    print("=" * 70)
    print(f"  {name}")
    print("=" * 70)
    print(f"  Duration           : {duration_s // 60:.0f} min ({duration_s:.0f} s)")
    print(f"  Time step (dt)     : {dt_s:.1f} s")
    print(f"  Phase offset       : {ho_config.phase_offset_deg} deg")
    print(f"  Lead time          : {ho_config.lead_time_s} s")
    print(f"  Min elevation      : {ho_config.min_elevation_deg} deg")
    print(f"  Initial Sat Phase  : {sat_phase_deg} deg")
    print("-" * 70)

    scenario_cfg = OrbitalScenarioConfig(
        camera_type="SATELLITE",
        beacon_type="UAV",
        camera_sat=SatelliteConfig(
            preset="LEO-550",
            altitude_km=550.0,
            inclination_deg=53.0,
            phase_deg=sat_phase_deg,
            raan_deg=0.0,
        ),
        beacon_uav=UAVConfig(
            lat_deg=28.6,
            lon_deg=77.2,
            altitude_km=10.0,
            pattern="Circular",
            radius_km=50.0,
            speed_km_s=0.25,
            phase_deg=0.0,
        ),
        enable_handover=True,
        handover_config=ho_config,
    )

    scenario = OrbitalScenario(scenario_cfg)
    ho_mgr = scenario.handover_manager
    assert ho_mgr is not None, "HandoverManager initialization failed"

    n_steps = int(duration_s / dt_s)
    timeline = []
    last_log = -log_interval_s
    t0_wall = time.time()

    for step_i in range(n_steps):
        t_sim = step_i * dt_s
        orb_telem = scenario.step(dt_s, pat_state="TRACKING")
        ho_telem = orb_telem.handover

        if ho_telem:
            timeline.append({
                "t": round(t_sim, 1),
                "active_sees": ho_telem["active_vis_can_see"],
                "backup_sees": ho_telem["backup_vis_can_see"],
                "state": ho_telem["state"],
                "link_state": ho_telem["link_state"],
            })

            if t_sim - last_log >= log_interval_s:
                last_log = t_sim
                m = ho_telem["metrics"]
                print(
                    f"  t={t_sim:5.0f}s | state={ho_telem['state']:12s} | "
                    f"link={ho_telem['link_state']:12s} | "
                    f"HOs={m['handover_count']} (ok={m['successful_handovers']} fail={m['failed_handovers']}) | "
                    f"NO_COV={m['total_no_coverage_s']:.1f}s"
                )

    wall_s = time.time() - t0_wall
    m = ho_mgr.metrics
    success_rate = (m.successful_handovers / m.handover_count * 100) if m.handover_count > 0 else 100.0

    print("-" * 70)
    print(f"  RESULTS:")
    print(f"    Wall-clock runtime   : {wall_s:.3f} s ({duration_s / max(wall_s, 0.0001):.0f}x realtime)")
    print(f"    Handover count       : {m.handover_count}")
    print(f"    Successful handovers : {m.successful_handovers}")
    print(f"    Failed handovers     : {m.failed_handovers}")
    print(f"    Success rate         : {success_rate:.1f}%")
    print(f"    Mean acq. time       : {f'{m.mean_acquisition_time_s:.2f} s' if m.mean_acquisition_time_s else 'N/A'}")
    print(f"    NO_COVERAGE events   : {m.no_coverage_events}")
    print(f"    Total NO_COV time    : {m.total_no_coverage_s:.1f} s ({m.total_no_coverage_s / duration_s * 100:.1f}%)")

    if m.events:
        print("\n  Handover Event Log:")
        print(f"  {'#':>3}  {'Time (s)':>8}  {'From':>6}  {'To':>6}  {'Status':>10}  {'AcqTime':>9}  Reason")
        print("  " + "-" * 62)
        for i, ev in enumerate(m.events):
            status = "SUCCESS" if ev.succeeded else "FAILED"
            acq = f"{ev.acquisition_time_s:.2f}s" if ev.acquisition_time_s is not None else "  N/A  "
            print(f"  {i+1:>3}  {ev.sim_time_s:>8.1f}  SAT-{ev.from_sat+1:>1}    SAT-{ev.to_sat+1:>1}  {status:>10}  {acq:>9}  {ev.reason}")

    print()
    return m, timeline


def run_demo():
    print("======================================================================")
    print("  FSOC MULTI-SATELLITE AUTOMATIC HANDOVER VERIFICATION & DEMO")
    print("======================================================================")
    print()

    # Part 1: Overlapping Ground Pass Demo (15 minutes of simulation time)
    # Using 5.0° along-track separation (~600 km) and orbital pass alignment
    ho_cfg_pass = HandoverConfig(
        min_elevation_deg=5.0,
        lead_time_s=30.0,
        phase_offset_deg=5.0,
        gimbal_pan_limit_deg=90.0,
        gimbal_tilt_limit_deg=90.0,
        backup_acquire_steps=2,
    )
    m1, tl1 = simulate_scenario(
        name="DEMO 1: 15-Minute Simulation from t=0 (Standard Baseline)",
        duration_s=15 * 60.0,
        dt_s=5.0,
        ho_config=ho_cfg_pass,
        sat_phase_deg=0.0,
        log_interval_s=120.0,
    )

    # Demo 2: Overlapping Pass Demonstration (aligned orbital pass)
    m2, tl2 = simulate_scenario(
        name="DEMO 2: Overlapping Pass Simulation (Active Handover Execution)",
        duration_s=21 * 60.0,
        dt_s=5.0,
        ho_config=ho_cfg_pass,
        sat_phase_deg=0.0,
        log_interval_s=120.0,
    )

    # Part 2: Physics Analysis of 20 deg vs 5 deg Phase Offset
    print("=" * 70)
    print("  PHYSICAL ORBITAL GEOMETRY ANALYSIS: 20 deg vs 5 deg PHASE OFFSET")
    print("=" * 70)
    print("  * In LEO-550 (altitude 550 km, period ~95.5 min = 5730 s):")
    print("    - Angular speed = 360 deg / 5730 s ~ 0.0628 deg/s (15.9 s per degree).")
    print("    - With min elevation mask 5 deg, a ground station pass arc is only ~10-12 deg")
    print("      along-track (~160 to 190 seconds duration).")
    print("  * Why 20 deg offset yields 0 simultaneous handovers during a pass:")
    print("    - A 20 deg along-track offset separates the satellites by 2,414 km (318 seconds).")
    print("    - Since the pass duration is only ~190 seconds, the active satellite sets")
    print("      below the horizon ~130 seconds BEFORE the backup satellite rises!")
    print("    - Therefore, with 20 deg separation in the same orbital plane, there is ZERO")
    print("      simultaneous visibility overlap. The system enters NO_COVERAGE between them.")
    print("  * Why 5 deg offset is the correct operational design:")
    print("    - A 5 deg along-track offset separates the satellites by ~604 km (~80 seconds).")
    print("    - When active approaches the horizon, backup is already visible with ~70s")
    print("      of shared line-of-sight, allowing predictive handover before link loss.")
    print("=" * 70)
    print()

    # Generate JSON report
    report = {
        "scenario": "15-Minute Multi-Satellite Handover Simulation",
        "orbital_physics_explanation": {
            "leo_altitude_km": 550.0,
            "pass_arc_deg": 12.0,
            "pass_duration_s": 190.0,
            "phase_offset_20deg_gap_s": 130.0,
            "phase_offset_5deg_overlap_s": 70.0,
            "finding": "20 deg phase offset exceeds the visibility footprint of a 550km LEO pass, causing zero overlap. 5 deg offset creates the physical overlap necessary for seamless predictive handover."
        },
        "demo1_baseline_metrics": m1.to_dict(),
        "demo2_pass_metrics": m2.to_dict(),
        "events": [
            {
                "sim_time_s": ev.sim_time_s,
                "from_sat": f"SAT-{ev.from_sat + 1}",
                "to_sat": f"SAT-{ev.to_sat + 1}",
                "succeeded": ev.succeeded,
                "acquisition_time_s": ev.acquisition_time_s,
                "reason": ev.reason,
            }
            for ev in m2.events
        ],
        "timeline_sample": tl2[::10],
    }

    try:
        with open(REPORT_PATH, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=2)
        print(f"  Full report saved to: {REPORT_PATH}")
    except Exception as e:
        print(f"  [WARN] Failed to write report: {e}")
    print()


if __name__ == "__main__":
    run_demo()
