"""
handover.py
===========
Automatic handover between two co-orbital LEO satellites (active + backup).

Design decisions
----------------
* No new motion integrators: uses existing CircularOrbitIntegrator instances
  that the caller constructs and advances externally.
* No new detection or Kalman code: the caller feeds in current PAT state for
  the *active* link; this module only decides WHICH satellite carries the link.
* Visibility = not Earth-blocked + above min_elevation_deg + within gimbal limits.
* Lead-time prediction: linearly extrapolate pos+vel to test visibility at
  (t + lead_s).  Cheap (O(1)) and accurate for short look-ahead on circular orbits.
* Handover state machine:
    IDLE           - both satellites present but no handover in progress
    TRANSFERRING   - backup is acquiring; old link still maintained
    NO_COVERAGE    - neither satellite can see the beacon

All configurable parameters exposed via HandoverConfig dataclass with defaults.
"""

from __future__ import annotations
import math
from dataclasses import dataclass, field
from typing import Optional, List

from backend.app.orbital.platform import Platform, Vec3
from backend.app.orbital.link_geometry import (
    LinkConfig,
    _is_link_blocked,
    _az_el_in_body,
    _unit, _sub, _norm,
)


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

@dataclass
class HandoverConfig:
    """All tunable parameters for the handover algorithm."""
    # Minimum elevation of beacon in satellite body frame before link is valid
    min_elevation_deg: float = 5.0
    # How far ahead to look when predicting loss (seconds)
    lead_time_s: float = 120.0
    # Phase offset between active and backup satellite (degrees along-track)
    phase_offset_deg: float = 20.0
    # Gimbal half-angle limits for each axis (degrees)
    # 90° = full hemisphere pointing — suitable for nadir-pointing LEO instrument
    gimbal_pan_limit_deg: float = 90.0
    gimbal_tilt_limit_deg: float = 90.0
    # Acquisition criterion: backup must be visible for this many steps
    backup_acquire_steps: int = 3
    # Link config forwarded to Earth-blocking check
    link: LinkConfig = field(default_factory=LinkConfig)


# ---------------------------------------------------------------------------
# Per-satellite visibility result
# ---------------------------------------------------------------------------

@dataclass
class SatVisibility:
    sat_index:      int   = 0
    can_see_now:    bool  = False
    will_lose_soon: bool  = False
    el_body_deg:    float = 0.0
    az_body_deg:    float = 0.0
    range_km:       float = 0.0
    blocked:        bool  = False
    below_min_el:   bool  = False
    outside_gimbal: bool  = False


# ---------------------------------------------------------------------------
# Per-handover event record
# ---------------------------------------------------------------------------

@dataclass
class HandoverEvent:
    sim_time_s:          float
    from_sat:            int
    to_sat:              int
    succeeded:           bool
    acquisition_time_s:  Optional[float]
    reason:              str  # "PREDICTED_LOSS" | "ALREADY_LOST"


# ---------------------------------------------------------------------------
# Cumulative metrics
# ---------------------------------------------------------------------------

@dataclass
class HandoverMetrics:
    handover_count:          int                  = 0
    successful_handovers:    int                  = 0
    failed_handovers:        int                  = 0
    no_coverage_events:      int                  = 0
    total_no_coverage_s:     float                = 0.0
    mean_acquisition_time_s: Optional[float]      = None
    events:                  List[HandoverEvent]  = field(default_factory=list)

    def record_event(self, ev: HandoverEvent):
        self.events.append(ev)
        self.handover_count += 1
        if ev.succeeded:
            self.successful_handovers += 1
        else:
            self.failed_handovers += 1
        acq_times = [
            e.acquisition_time_s for e in self.events
            if e.succeeded and e.acquisition_time_s is not None
        ]
        self.mean_acquisition_time_s = (sum(acq_times) / len(acq_times)) if acq_times else None

    def to_dict(self) -> dict:
        return {
            "handover_count":           self.handover_count,
            "successful_handovers":     self.successful_handovers,
            "failed_handovers":         self.failed_handovers,
            "no_coverage_events":       self.no_coverage_events,
            "total_no_coverage_s":      round(self.total_no_coverage_s, 2),
            "mean_acquisition_time_s":  round(self.mean_acquisition_time_s, 3)
                                        if self.mean_acquisition_time_s is not None else None,
        }


# ---------------------------------------------------------------------------
# Per-step telemetry output
# ---------------------------------------------------------------------------

@dataclass
class HandoverTelemetry:
    active_sat_index:        int             = 0
    backup_sat_index:        int             = 1
    state:                   str             = "IDLE"
    link_state:              str             = "LINK_OK"
    pat_badge:               str             = "SEARCHING"
    active_vis:              SatVisibility   = field(default_factory=SatVisibility)
    backup_vis:              SatVisibility   = field(default_factory=SatVisibility)
    metrics:                 HandoverMetrics = field(default_factory=HandoverMetrics)
    backup_acquire_progress: int             = 0
    active_link_az_deg:      float           = 0.0
    active_link_el_deg:      float           = 0.0
    active_range_km:         float           = 0.0
    backup_link_az_deg:      float           = 0.0
    backup_link_el_deg:      float           = 0.0
    backup_range_km:         float           = 0.0
    sim_time_s:              float           = 0.0

    def to_dict(self) -> dict:
        return {
            "active_sat_index":         self.active_sat_index,
            "backup_sat_index":         self.backup_sat_index,
            "state":                    self.state,
            "link_state":               self.link_state,
            "pat_badge":                self.pat_badge,
            "active_vis_can_see":       self.active_vis.can_see_now,
            "active_vis_el_deg":        self.active_vis.el_body_deg,
            "active_vis_az_deg":        self.active_vis.az_body_deg,
            "active_range_km":          self.active_range_km,
            "backup_vis_can_see":       self.backup_vis.can_see_now,
            "backup_vis_el_deg":        self.backup_vis.el_body_deg,
            "backup_vis_az_deg":        self.backup_vis.az_body_deg,
            "backup_range_km":          self.backup_range_km,
            "backup_acquire_progress":  self.backup_acquire_progress,
            "will_lose_soon":           self.active_vis.will_lose_soon,
            "metrics":                  self.metrics.to_dict(),
            "sim_time_s":               round(self.sim_time_s, 2),
        }


# ---------------------------------------------------------------------------
# Visibility helper (pure function, no side effects)
# ---------------------------------------------------------------------------

def _check_visibility(
    sat_plat: Platform,
    beacon_plat: Platform,
    cfg: HandoverConfig,
    lookahead_s: float = 0.0,
) -> SatVisibility:
    """
    Returns SatVisibility for sat_plat -> beacon_plat at (now + lookahead_s).
    Uses linear extrapolation for prediction (valid for short look-ahead on
    circular LEO orbits; error < 0.02 deg at 30 s lead).
    """
    if lookahead_s > 0.0:
        sp = sat_plat.pos_eci
        sv = sat_plat.vel_eci
        bp = beacon_plat.pos_eci
        bv = beacon_plat.vel_eci
        sat_pos: Vec3 = (
            sp[0] + sv[0] * lookahead_s,
            sp[1] + sv[1] * lookahead_s,
            sp[2] + sv[2] * lookahead_s,
        )
        bea_pos: Vec3 = (
            bp[0] + bv[0] * lookahead_s,
            bp[1] + bv[1] * lookahead_s,
            bp[2] + bv[2] * lookahead_s,
        )
    else:
        sat_pos = sat_plat.pos_eci
        bea_pos = beacon_plat.pos_eci

    blocked, _ = _is_link_blocked(sat_pos, bea_pos, cfg.link.atmosphere_margin_km)

    diff = _sub(bea_pos, sat_pos)
    rng = _norm(diff)
    if rng < 1e-6:
        return SatVisibility(blocked=True)

    los_unit = _unit(diff)

    # Build a lightweight proxy that has the attributes _az_el_in_body needs
    class _Proxy:
        pos_eci      = sat_pos
        vel_eci      = sat_plat.vel_eci
        platform_type = sat_plat.platform_type

    az_deg, el_deg = _az_el_in_body(los_unit, _Proxy())

    # Elevation convention (LVLH for SATELLITE, ENU for UAV):
    #   SATELLITE (LVLH): z_hat = NADIR (toward Earth).
    #     A ground beacon has el_body_deg ≈ +90° (the LOS points straight nadir).
    #     "Below minimum elevation" means the beacon is too close to the satellite's
    #     local horizontal, i.e. el_deg < min_elevation_deg.
    #     (Because el = 0° is the local horizontal; we want el ≥ min_elevation_deg)
    #   UAV (ENU): z_hat = Up. A beacon ABOVE the UAV would have el_deg > 0.
    #     For a satellite beacon above the UAV, below_min_el = el_deg < min_elevation_deg.
    below_el = el_deg < cfg.min_elevation_deg   # same condition works for both
    out_gimbal = (abs(az_deg) > cfg.gimbal_pan_limit_deg or
                  abs(el_deg) > cfg.gimbal_tilt_limit_deg)
    can_see = (not blocked) and (not below_el) and (not out_gimbal)

    return SatVisibility(
        can_see_now    = can_see,
        el_body_deg    = round(el_deg, 4),
        az_body_deg    = round(az_deg, 4),
        range_km       = round(rng, 3),
        blocked        = blocked,
        below_min_el   = below_el,
        outside_gimbal = out_gimbal,
    )


# ---------------------------------------------------------------------------
# HandoverManager
# ---------------------------------------------------------------------------

class HandoverManager:
    """
    Manages automatic handover between two satellites in the same LEO orbit,
    offset by HandoverConfig.phase_offset_deg.

    Usage (called from OrbitalScenario or SimulationEngine each tick):
        mgr = HandoverManager(config)
        telem = mgr.step(dt, sat_platforms, beacon_platform, current_pat_state)
        # telem.active_sat_index tells you which satellite is now the link
        # telem.link_state / telem.pat_badge are the corrected display values
    """

    def __init__(self, config: HandoverConfig = None):
        self._cfg = config or HandoverConfig()
        self._state: str = "IDLE"
        self._active_idx: int = 0
        self._backup_idx:  int = 1
        self._backup_acq_steps: int = 0
        self._handover_start_time: Optional[float] = None
        self._metrics = HandoverMetrics()
        self._sim_time: float = 0.0
        self._no_coverage_start: Optional[float] = None
        self._pending_event: Optional[HandoverEvent] = None

    @property
    def active_index(self) -> int:
        return self._active_idx

    @property
    def backup_index(self) -> int:
        return self._backup_idx

    @property
    def metrics(self) -> HandoverMetrics:
        return self._metrics

    def reset(self):
        self._state = "IDLE"
        self._active_idx = 0
        self._backup_idx = 1
        self._backup_acq_steps = 0
        self._handover_start_time = None
        self._metrics = HandoverMetrics()
        self._sim_time = 0.0
        self._no_coverage_start = None
        self._pending_event = None

    def step(
        self,
        dt: float,
        sat_platforms: List[Platform],
        beacon_platform: Platform,
        current_pat_state: str = "SEARCHING",
    ) -> HandoverTelemetry:
        """
        Advance handover state machine by dt seconds.

        Parameters
        ----------
        dt                : step size (s)
        sat_platforms     : list of exactly 2 Platform objects (already advanced)
        beacon_platform   : beacon Platform (already advanced)
        current_pat_state : PAT state string from KalmanTracker for active sat
        """
        if len(sat_platforms) != 2:
            raise ValueError("HandoverManager requires exactly 2 satellite platforms")

        self._sim_time += dt
        active_plat = sat_platforms[self._active_idx]
        backup_plat = sat_platforms[self._backup_idx]

        # -- Visibility now ---------------------------------------------------
        active_vis = _check_visibility(active_plat, beacon_platform, self._cfg, 0.0)
        backup_vis = _check_visibility(backup_plat, beacon_platform, self._cfg, 0.0)

        # -- Predict active loss ----------------------------------------------
        future_active = _check_visibility(
            active_plat, beacon_platform, self._cfg, self._cfg.lead_time_s
        )
        active_vis.will_lose_soon = (active_vis.can_see_now and
                                     not future_active.can_see_now)

        active_sees = active_vis.can_see_now
        backup_sees = backup_vis.can_see_now
        will_lose   = active_vis.will_lose_soon

        # -- State machine ----------------------------------------------------
        if self._state == "IDLE":
            if not active_sees and not backup_sees:
                self._state = "NO_COVERAGE"
                self._metrics.total_no_coverage_s += dt
                if self._no_coverage_start is None:
                    self._no_coverage_start = self._sim_time
                    self._metrics.no_coverage_events += 1
            elif (not active_sees and backup_sees) or (will_lose and backup_sees):
                reason = "ALREADY_LOST" if not active_sees else "PREDICTED_LOSS"
                self._state = "TRANSFERRING"
                self._backup_acq_steps = 0
                self._handover_start_time = self._sim_time
                self._pending_event = HandoverEvent(
                    sim_time_s         = self._sim_time,
                    from_sat           = self._active_idx,
                    to_sat             = self._backup_idx,
                    succeeded          = False,
                    acquisition_time_s = None,
                    reason             = reason,
                )

        elif self._state == "NO_COVERAGE":
            self._metrics.total_no_coverage_s += dt
            if active_sees or backup_sees:
                self._no_coverage_start = None
                if active_sees:
                    self._state = "IDLE"
                else:
                    # promote backup to active
                    self._active_idx, self._backup_idx = self._backup_idx, self._active_idx
                    self._state = "IDLE"

        elif self._state == "TRANSFERRING":
            if backup_sees:
                self._backup_acq_steps += 1
                if self._backup_acq_steps >= self._cfg.backup_acquire_steps:
                    acq_t = self._sim_time - (self._handover_start_time or self._sim_time)
                    if self._pending_event is not None:
                        self._pending_event.succeeded = True
                        self._pending_event.acquisition_time_s = acq_t
                        self._metrics.record_event(self._pending_event)
                        self._pending_event = None
                    # Promote backup to active
                    self._active_idx, self._backup_idx = self._backup_idx, self._active_idx
                    self._state = "IDLE"
                    self._backup_acq_steps = 0
            else:
                self._backup_acq_steps = 0
                if not active_sees:
                    # Abort – go NO_COVERAGE
                    if self._pending_event is not None:
                        self._pending_event.succeeded = False
                        self._pending_event.acquisition_time_s = (
                            self._sim_time - (self._handover_start_time or self._sim_time)
                        )
                        self._metrics.record_event(self._pending_event)
                        self._pending_event = None
                    self._state = "NO_COVERAGE"
                    if self._no_coverage_start is None:
                        self._no_coverage_start = self._sim_time
                        self._metrics.no_coverage_events += 1
                # else: active still sees – continue TRANSFERRING, reset backup counter

        # -- Derive link_state and pat_badge ----------------------------------
        if self._state == "NO_COVERAGE":
            link_state = "NO_COVERAGE"
            pat_badge  = "NO_COVERAGE"
        else:
            cur_active_plat = sat_platforms[self._active_idx]
            cur_active_vis  = _check_visibility(cur_active_plat, beacon_platform, self._cfg)
            if not cur_active_vis.can_see_now:
                # Active lost sight; during TRANSFERRING the backup will take over
                link_state = "LINK_BLOCKED"
                pat_badge  = "LINK_BLOCKED"
            else:
                link_state = "LINK_OK"
                if current_pat_state == "LINK_BLOCKED":
                    pat_badge = "LINK_BLOCKED"
                else:
                    pat_badge = current_pat_state

        return HandoverTelemetry(
            active_sat_index        = self._active_idx,
            backup_sat_index        = self._backup_idx,
            state                   = self._state,
            link_state              = link_state,
            pat_badge               = pat_badge,
            active_vis              = active_vis,
            backup_vis              = backup_vis,
            metrics                 = self._metrics,
            backup_acquire_progress = self._backup_acq_steps,
            active_link_az_deg      = active_vis.az_body_deg,
            active_link_el_deg      = active_vis.el_body_deg,
            active_range_km         = active_vis.range_km,
            backup_link_az_deg      = backup_vis.az_body_deg,
            backup_link_el_deg      = backup_vis.el_body_deg,
            backup_range_km         = backup_vis.range_km,
            sim_time_s              = self._sim_time,
        )
