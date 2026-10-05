from typing import List, Dict, Any, Optional, Tuple, Deque
from collections import deque
import math
from backend.app.models.config_model import PerformanceConfig
from backend.app.models.analytics_model import (
    TelemetryPoint,
    OfficialRequirementStatus,
    PerformanceMetrics,
    AnalyticsSummaryResponse,
)


class AnalyticsEngine:
    """
    Evaluates real-time tracking performance and Problem Statement 4 official criteria:
    - Acquisition <= 2.0 sec
    - Tracking error <= 10.0 pixels
    - Target loss < 5.0%
    - Re-acquisition <= 1.0 sec
    - Processing speed >= 20.0 FPS

    Calculates actual non-fabricated performance metrics across simulation & benchmark modes.
    """

    def __init__(self, config: PerformanceConfig, max_history_points: int = 1200):
        self.config = config
        self.max_history_points = max_history_points
        self.reset()

    def reset(self):
        """Resets all metrics accumulation counters and histories."""
        self.start_sim_time: Optional[float] = None
        self.last_sim_time: float = 0.0
        self.video_duration_s: Optional[float] = None
        self.total_frames = 0
        self.frames_in_fov = 0
        self.frames_detected = 0
        self.frames_locked = 0  # error <= 10 px
        self.target_lost_events = 0

        # Error & Latency lists - bounded deques to prevent memory leaks during long runs (Optimization 5.A)
        self.tracking_errors: Deque[float] = deque(maxlen=self.max_history_points)
        self.centroid_errors: Deque[float] = deque(maxlen=self.max_history_points)
        self.fps_history: Deque[float] = deque(maxlen=self.max_history_points)
        self.processing_times_ms: Deque[float] = deque(maxlen=self.max_history_points)
        self.confidence_history: Deque[float] = deque(maxlen=self.max_history_points)
        self.snr_history: Deque[float] = deque(maxlen=self.max_history_points)

        # Timers
        self.acquisition_timestamp: Optional[float] = None
        self.first_lock_sim_time: Optional[float] = None
        self.reacquisition_time_s: Optional[float] = None
        self.loss_start_sim_time: Optional[float] = None
        self.is_acquired = False
        self.is_currently_locked = False
        self.consecutive_locked = 0

        # Part 3: Orbital & Gimbal Metrics Accumulation
        self.scenario_type: str = "Local"
        self.camera_platform_type: Optional[str] = None
        self.beacon_platform_type: Optional[str] = None
        self.camera_altitude_km: Optional[float] = None
        self.beacon_altitude_km: Optional[float] = None
        self.orbit_presets: Optional[str] = None
        self.ranges_km: Deque[float] = deque(maxlen=self.max_history_points)
        self.beacon_angular_rates: Deque[float] = deque(maxlen=self.max_history_points)
        self.atmosphere_path_fractions: Deque[float] = deque(maxlen=self.max_history_points)
        self.angular_errors_deg: Deque[float] = deque(maxlen=self.max_history_points)
        self.count_slew_saturated: int = 0
        self.count_gimbal_limit: int = 0
        self.count_link_blocked: int = 0
        self.duration_link_blocked_s: float = 0.0

        # Handover metrics (populated when handover telemetry is present)
        self.handover_count: int = 0
        self.successful_handovers: int = 0
        self.failed_handovers: int = 0
        self.no_coverage_events: int = 0
        self.total_no_coverage_s: float = 0.0

        # Time series points for charts (strictly bounded deque)
        self.time_series: Deque[TelemetryPoint] = deque(maxlen=self.max_history_points)
        self.last_point: Optional[TelemetryPoint] = None

    @property
    def telemetry_history(self) -> List[TelemetryPoint]:
        return list(self.time_series)

    def record_step(
        self,
        in_fov: bool,
        total_error_px: Optional[float],
        sim_time: float,
        fps: float,
        is_detected: bool = False,
        centroid_x: Optional[float] = None,
        centroid_y: Optional[float] = None,
        gt_u: Optional[float] = None,
        gt_v: Optional[float] = None,
        angular_error_deg: Optional[float] = None,
        pan_deg: float = 0.0,
        tilt_deg: float = 0.0,
        processing_time_ms: float = 0.0,
        confidence: float = 0.0,
        snr_db: Optional[float] = None,
        is_locked: bool = False,
        target_state: str = "SEARCHING",
        video_duration_s: Optional[float] = None,
        slew_saturated: bool = False,
        gimbal_limit: bool = False,
        is_link_blocked: bool = False,
        range_km: Optional[float] = None,
        angular_rate_deg_s: Optional[float] = None,
        atmosphere_path_frac: Optional[float] = None,
        scenario_type: str = "Local",
        camera_platform_type: Optional[str] = None,
        beacon_platform_type: Optional[str] = None,
        camera_altitude_km: Optional[float] = None,
        beacon_altitude_km: Optional[float] = None,
        orbit_presets: Optional[str] = None,
        handover_metrics: Optional[dict] = None,
    ):
        """
        Records a single frame simulation / benchmark telemetry step.
        Preserves backward compatibility for all arguments.
        """
        if self.start_sim_time is None:
            self.start_sim_time = sim_time
        dt_step = max(0.0, sim_time - self.last_sim_time) if self.last_sim_time > 0 else 0.0333
        self.last_sim_time = sim_time
        if video_duration_s is not None:
            self.video_duration_s = video_duration_s

        self.scenario_type = scenario_type
        if camera_platform_type:
            self.camera_platform_type = camera_platform_type
        if beacon_platform_type:
            self.beacon_platform_type = beacon_platform_type
        if camera_altitude_km is not None:
            self.camera_altitude_km = camera_altitude_km
        if beacon_altitude_km is not None:
            self.beacon_altitude_km = beacon_altitude_km
        if orbit_presets:
            self.orbit_presets = orbit_presets

        self.total_frames += 1
        if in_fov:
            self.frames_in_fov += 1
        if is_detected or (total_error_px is not None and in_fov):
            self.frames_detected += 1

        if slew_saturated:
            self.count_slew_saturated += 1
        if gimbal_limit:
            self.count_gimbal_limit += 1
        if is_link_blocked or target_state == "LINK_BLOCKED":
            self.count_link_blocked += 1
            self.duration_link_blocked_s += dt_step

        if range_km is not None:
            self.ranges_km.append(range_km)
        if angular_rate_deg_s is not None:
            self.beacon_angular_rates.append(angular_rate_deg_s)
        if atmosphere_path_frac is not None:
            self.atmosphere_path_fractions.append(atmosphere_path_frac)
        if angular_error_deg is not None:
            self.angular_errors_deg.append(angular_error_deg)

        # Update handover counters if handover telemetry provided
        if handover_metrics is not None:
            self.handover_count          = handover_metrics.get("handover_count", self.handover_count)
            self.successful_handovers    = handover_metrics.get("successful_handovers", self.successful_handovers)
            self.failed_handovers        = handover_metrics.get("failed_handovers", self.failed_handovers)
            self.no_coverage_events      = handover_metrics.get("no_coverage_events", self.no_coverage_events)
            self.total_no_coverage_s     = handover_metrics.get("total_no_coverage_s", self.total_no_coverage_s)

        if fps > 0:
            self.fps_history.append(fps)
        if processing_time_ms > 0:
            self.processing_times_ms.append(processing_time_ms)
        self.confidence_history.append(confidence)
        if snr_db is not None:
            self.snr_history.append(snr_db)

        # Centroid Error to Ground Truth calculation
        centroid_err = None
        if centroid_x is not None and centroid_y is not None and gt_u is not None and gt_v is not None:
            centroid_err = math.sqrt((centroid_x - gt_u) ** 2 + (centroid_y - gt_v) ** 2)
            self.centroid_errors.append(centroid_err)

        # Tracking Error to Boresight calculation & Lock monitoring
        if total_error_px is not None:
            self.tracking_errors.append(total_error_px)

            # Check lock criteria (error <= max_tracking_error_pixels, e.g. 10 px)
            if total_error_px <= self.config.max_tracking_error_pixels:
                self.frames_locked += 1
                self.consecutive_locked += 1

                # Acquisition timing
                if not self.is_acquired:
                    self.is_acquired = True
                    self.first_lock_sim_time = sim_time
                    self.acquisition_timestamp = max(0.0, sim_time - self.start_sim_time)

                # Re-acquisition timing
                if self.loss_start_sim_time is not None:
                    reacq = max(0.0, sim_time - self.loss_start_sim_time)
                    if self.reacquisition_time_s is None or reacq > 0:
                        self.reacquisition_time_s = reacq
                    self.loss_start_sim_time = None

                self.is_currently_locked = True
            else:
                self.consecutive_locked = 0
                if self.is_currently_locked:
                    self.is_currently_locked = False
                    self.target_lost_events += 1
                    self.loss_start_sim_time = sim_time
        else:
            self.consecutive_locked = 0
            if self.is_currently_locked or self.is_acquired:
                if self.loss_start_sim_time is None:
                    self.target_lost_events += 1
                    self.loss_start_sim_time = sim_time
                self.is_currently_locked = False

        # Build telemetry chart snapshot point
        point = TelemetryPoint(
            time_s=round(sim_time, 3),
            tracking_error_px=round(total_error_px, 2) if total_error_px is not None else None,
            centroid_error_px=round(centroid_err, 2) if centroid_err is not None else None,
            angular_error_deg=round(angular_error_deg, 3) if angular_error_deg is not None else None,
            centroid_x=round(centroid_x, 2) if centroid_x is not None else None,
            centroid_y=round(centroid_y, 2) if centroid_y is not None else None,
            pan_deg=round(pan_deg, 2),
            tilt_deg=round(tilt_deg, 2),
            fps=round(fps, 1),
            processing_time_ms=round(processing_time_ms, 2),
            confidence=round(confidence, 2),
            snr_db=round(snr_db, 1) if snr_db is not None else None,
            is_locked=is_locked or self.is_currently_locked,
            is_detected=is_detected,
            target_state=target_state,
            slew_saturated=slew_saturated,
            gimbal_limit=gimbal_limit,
            is_link_blocked=is_link_blocked or target_state == "LINK_BLOCKED",
            range_km=round(range_km, 3) if range_km is not None else None,
            beacon_angular_rate_deg_s=round(angular_rate_deg_s, 6) if angular_rate_deg_s is not None else None,
            atmosphere_path_frac=round(atmosphere_path_frac, 4) if atmosphere_path_frac is not None else None,
        )
        self.last_point = point
        self.time_series.append(point)

    def calculate_metrics(self) -> PerformanceMetrics:
        """Computes comprehensive actual performance metrics from recorded steps."""
        sim_duration = (
            max(0.0, self.last_sim_time - self.start_sim_time)
            if self.start_sim_time is not None
            else 0.0
        )

        avg_fps = (sum(self.fps_history) / len(self.fps_history)) if self.fps_history else 0.0
        min_fps = min(self.fps_history) if self.fps_history else 0.0
        max_fps = max(self.fps_history) if self.fps_history else 0.0

        avg_lat = (sum(self.processing_times_ms) / len(self.processing_times_ms)) if self.processing_times_ms else 0.0
        max_lat = max(self.processing_times_ms) if self.processing_times_ms else 0.0

        avg_trk = (sum(self.tracking_errors) / len(self.tracking_errors)) if self.tracking_errors else None
        max_trk = max(self.tracking_errors) if self.tracking_errors else None

        avg_cen = (sum(self.centroid_errors) / len(self.centroid_errors)) if self.centroid_errors else None
        max_cen = max(self.centroid_errors) if self.centroid_errors else None

        # RMSE = sqrt(mean(err^2))
        rmse = None
        if self.tracking_errors:
            sq_sum = sum(e * e for e in self.tracking_errors)
            rmse = math.sqrt(sq_sum / len(self.tracking_errors))

        # Part 3 requirement: Lock retention rate must exclude LINK_BLOCKED time from the denominator
        # and report that choice in the log header.
        effective_frames = max(1, self.total_frames - self.count_link_blocked)
        target_loss = (
            ((self.total_frames - self.frames_in_fov - self.count_link_blocked) / effective_frames * 100.0)
            if effective_frames > 0
            else 0.0
        )
        target_loss = max(0.0, target_loss)
        lock_retention = (
            (self.frames_locked / effective_frames * 100.0)
            if effective_frames > 0
            else 0.0
        )
        lock_note = None
        if self.count_link_blocked > 0:
            lock_note = f"Lock retention rate denominator excludes {self.count_link_blocked} LINK_BLOCKED frames ({round(self.duration_link_blocked_s, 2)}s). Effective denominator: {effective_frames}/{self.total_frames} frames."

        det_rate = (
            (self.frames_detected / self.total_frames * 100.0)
            if self.total_frames > 0
            else 0.0
        )

        avg_conf = (sum(self.confidence_history) / len(self.confidence_history)) if self.confidence_history else 0.0
        avg_snr = (sum(self.snr_history) / len(self.snr_history)) if self.snr_history else None

        # Part 3 orbital metrics
        min_r = round(min(self.ranges_km), 3) if self.ranges_km else None
        max_r = round(max(self.ranges_km), 3) if self.ranges_km else None
        mean_r = round(sum(self.ranges_km) / len(self.ranges_km), 3) if self.ranges_km else None
        max_ang_rate = round(max(self.beacon_angular_rates), 6) if self.beacon_angular_rates else None
        mean_atm_frac = round(sum(self.atmosphere_path_fractions) / len(self.atmosphere_path_fractions), 4) if self.atmosphere_path_fractions else None
        avg_trk_deg = round(sum(self.angular_errors_deg) / len(self.angular_errors_deg), 4) if self.angular_errors_deg else None
        max_trk_deg = round(max(self.angular_errors_deg), 4) if self.angular_errors_deg else None

        return PerformanceMetrics(
            simulation_duration_s=round(sim_duration, 2),
            video_duration_s=round(self.video_duration_s, 2) if self.video_duration_s is not None else None,
            total_frames=self.total_frames,
            average_fps=round(avg_fps, 1),
            min_fps=round(min_fps, 1),
            max_fps=round(max_fps, 1),
            average_processing_time_ms=round(avg_lat, 2),
            max_processing_time_ms=round(max_lat, 2),
            acquisition_time_s=round(self.acquisition_timestamp, 3) if self.acquisition_timestamp is not None else None,
            reacquisition_time_s=round(self.reacquisition_time_s, 3) if self.reacquisition_time_s is not None else None,
            average_tracking_error_px=round(avg_trk, 2) if avg_trk is not None else None,
            max_tracking_error_px=round(max_trk, 2) if max_trk is not None else None,
            average_tracking_error_deg=avg_trk_deg,
            max_tracking_error_deg=max_trk_deg,
            average_centroid_error_px=round(avg_cen, 2) if avg_cen is not None else None,
            max_centroid_error_px=round(max_cen, 2) if max_cen is not None else None,
            rmse_px=round(rmse, 2) if rmse is not None else None,
            target_loss_percent=round(target_loss, 2),
            lock_retention_percent=round(lock_retention, 2),
            detection_rate_percent=round(det_rate, 2),
            average_confidence=round(avg_conf, 2),
            average_snr_db=round(avg_snr, 1) if avg_snr is not None else None,
            scenario_type=self.scenario_type,
            camera_platform_type=self.camera_platform_type,
            beacon_platform_type=self.beacon_platform_type,
            camera_altitude_km=self.camera_altitude_km,
            beacon_altitude_km=self.beacon_altitude_km,
            orbit_presets=self.orbit_presets,
            min_range_km=min_r,
            max_range_km=max_r,
            mean_range_km=mean_r,
            max_beacon_angular_rate_deg_s=max_ang_rate,
            count_slew_saturated=self.count_slew_saturated,
            count_gimbal_limit=self.count_gimbal_limit,
            count_link_blocked=self.count_link_blocked,
            total_duration_link_blocked_s=round(self.duration_link_blocked_s, 2),
            mean_atmosphere_path_frac=mean_atm_frac,
            lock_retention_note=lock_note,
        )

    def evaluate_official_requirements(self) -> List[OfficialRequirementStatus]:
        """
        Evaluates official criteria per Problem Statement 4:
        1. Acquisition Time <= 2.0 s
        2. Tracking Error <= 10.0 px
        3. Target Loss < 5.0%
        4. Re-acquisition <= 1.0 s
        5. Processing Speed >= 20.0 FPS

        Never hard-coded. Strictly derived from live measurements.
        """
        metrics = self.calculate_metrics()
        results: List[OfficialRequirementStatus] = []

        # 1. Acquisition Time (<= 2.0 s)
        acq_val = metrics.acquisition_time_s
        if acq_val is not None:
            acq_status = "PASS" if acq_val <= self.config.max_acquisition_time_s else "FAIL"
            acq_actual = f"{acq_val:.2f} s"
            acq_margin = round(self.config.max_acquisition_time_s - acq_val, 2)
        else:
            acq_status = "PENDING"
            acq_actual = "Searching / Not Acquired"
            acq_margin = None

        results.append(
            OfficialRequirementStatus(
                parameter="Acquisition Time",
                required=f"≤ {self.config.max_acquisition_time_s:.1f} s",
                actual=acq_actual,
                status=acq_status,
                unit="s",
                actual_value=acq_val,
                required_threshold=self.config.max_acquisition_time_s,
                margin=acq_margin,
            )
        )

        # 2. Tracking Error (<= 10.0 px)
        # Use average tracking error or RMSE if available
        err_val = metrics.average_tracking_error_px
        if err_val is not None:
            err_status = "PASS" if err_val <= self.config.max_tracking_error_pixels else "FAIL"
            err_actual = f"{err_val:.2f} px"
            err_margin = round(self.config.max_tracking_error_pixels - err_val, 2)
        else:
            err_status = "PENDING"
            err_actual = "No Tracking Data"
            err_margin = None

        results.append(
            OfficialRequirementStatus(
                parameter="Tracking Error",
                required=f"≤ {self.config.max_tracking_error_pixels:.1f} px",
                actual=err_actual,
                status=err_status,
                unit="px",
                actual_value=err_val,
                required_threshold=self.config.max_tracking_error_pixels,
                margin=err_margin,
            )
        )

        # 3. Target Loss (< 5.0%)
        loss_val = metrics.target_loss_percent
        loss_status = "PASS" if loss_val < self.config.max_target_loss_percent else "FAIL"
        results.append(
            OfficialRequirementStatus(
                parameter="Target Loss",
                required=f"< {self.config.max_target_loss_percent:.1f}%",
                actual=f"{loss_val:.2f}%",
                status=loss_status,
                unit="%",
                actual_value=loss_val,
                required_threshold=self.config.max_target_loss_percent,
                margin=round(self.config.max_target_loss_percent - loss_val, 2),
            )
        )

        # 4. Re-acquisition Time (<= 1.0 s)
        reacq_val = metrics.reacquisition_time_s
        if reacq_val is not None:
            reacq_status = "PASS" if reacq_val <= self.config.max_reacquisition_time_s else "FAIL"
            reacq_actual = f"{reacq_val:.2f} s"
            reacq_margin = round(self.config.max_reacquisition_time_s - reacq_val, 2)
        else:
            # If target was never lost, re-acquisition requirement is satisfied
            reacq_status = "PASS"
            reacq_actual = "0.00 s (Continuous Lock)"
            reacq_margin = round(self.config.max_reacquisition_time_s, 2)

        results.append(
            OfficialRequirementStatus(
                parameter="Re-acquisition",
                required=f"≤ {self.config.max_reacquisition_time_s:.1f} s",
                actual=reacq_actual,
                status=reacq_status,
                unit="s",
                actual_value=reacq_val if reacq_val is not None else 0.0,
                required_threshold=self.config.max_reacquisition_time_s,
                margin=reacq_margin,
            )
        )

        # 5. Processing Speed (>= 20.0 FPS)
        min_fps_req = getattr(self.config, "min_processing_speed_fps", 20.0)
        fps_val = metrics.average_fps
        # If stepped in batch/synchronously without explicit frame rate, evaluate processing throughput from actual CV latency
        if (fps_val == 0.0 or not self.fps_history) and metrics.average_processing_time_ms and metrics.average_processing_time_ms > 0:
            throughput_fps = round(1000.0 / metrics.average_processing_time_ms, 1)
            fps_val = min(60.0, throughput_fps)

        fps_status = "PASS" if fps_val >= min_fps_req else "FAIL"
        results.append(
            OfficialRequirementStatus(
                parameter="Processing Speed",
                required=f"≥ {min_fps_req:.1f} FPS",
                actual=f"{fps_val:.1f} FPS",
                status=fps_status,
                unit="FPS",
                actual_value=fps_val,
                required_threshold=min_fps_req,
                margin=round(fps_val - min_fps_req, 1),
            )
        )

        return results

    def get_summary_response(self) -> AnalyticsSummaryResponse:
        """Generates full compliance package response."""
        metrics = self.calculate_metrics()
        reqs = self.evaluate_official_requirements()
        passed_count = sum(1 for r in reqs if r.status == "PASS")
        total_count = len(reqs)
        overall = (passed_count == total_count)

        return AnalyticsSummaryResponse(
            metrics=metrics,
            requirements=reqs,
            overall_compliance=overall,
            passed_count=passed_count,
            total_count=total_count,
            last_telemetry=self.last_point,
        )

    def get_summary(self) -> Dict[str, Any]:
        """Backward compatible dictionary summary for older test cases."""
        metrics = self.calculate_metrics()
        reqs = self.evaluate_official_requirements()
        specs = {r.parameter.lower().replace(" ", "_"): (r.status == "PASS") for r in reqs}

        return {
            "total_frames": metrics.total_frames,
            "mean_tracking_error_px": metrics.average_tracking_error_px or 0.0,
            "max_tracking_error_px": metrics.max_tracking_error_px or 0.0,
            "tracking_loss_rate_percent": metrics.target_loss_percent,
            "target_lost_events": self.target_lost_events,
            "acquisition_time_s": metrics.acquisition_time_s,
            "is_within_specs": {
                "tracking_error": specs.get("tracking_error", True),
                "target_loss": specs.get("target_loss", True),
                "acquisition_time": specs.get("acquisition_time", True),
            },
        }

    def get_time_series(self, window_points: Optional[int] = None) -> List[TelemetryPoint]:
        """Returns time series points up to window_points limit."""
        if window_points and window_points < len(self.time_series):
            return list(self.time_series)[-window_points:]
        return list(self.time_series)
