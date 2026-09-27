import os
import json
import time
import math
import copy
from datetime import datetime
from typing import List, Dict, Any, Optional
import numpy as np

from backend.app.models.config_model import SystemConfig
from backend.app.models.analytics_model import (
    ExperimentRecord,
    AlgorithmComparisonResult,
    AlgorithmComparisonResponse,
    PerformanceMetrics,
    OfficialRequirementStatus,
)


class ExperimentEngine:
    """
    Manages archival of experimental testbench runs and executes
    standardized 5-algorithm objective benchmark comparisons.
    """

    def __init__(self, storage_path: str = "backend/data/experiments.json"):
        self.storage_path = storage_path
        self._ensure_storage_dir()
        self.experiments: Dict[str, ExperimentRecord] = {}
        self._load_from_disk()

    def _ensure_storage_dir(self):
        os.makedirs(os.path.dirname(self.storage_path), exist_ok=True)

    def _load_from_disk(self):
        if os.path.exists(self.storage_path):
            try:
                with open(self.storage_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    for item in data:
                        rec = ExperimentRecord(**item)
                        self.experiments[rec.experiment_id] = rec
            except Exception as e:
                print(f"[Warning] Failed to load experiments from {self.storage_path}: {e}")

    def _save_to_disk(self):
        try:
            self._ensure_storage_dir()
            data = [rec.model_dump() for rec in self.experiments.values()]
            with open(self.storage_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            print(f"[Warning] Failed to save experiments to disk: {e}")

    def save_experiment(self, record: ExperimentRecord) -> ExperimentRecord:
        self.experiments[record.experiment_id] = record
        self._save_to_disk()
        return record

    def get_experiment(self, exp_id: str) -> Optional[ExperimentRecord]:
        return self.experiments.get(exp_id)

    def list_experiments(self) -> List[ExperimentRecord]:
        return sorted(list(self.experiments.values()), key=lambda x: x.timestamp, reverse=True)

    def delete_experiment(self, exp_id: str) -> bool:
        if exp_id in self.experiments:
            del self.experiments[exp_id]
            self._save_to_disk()
            return True
        return False

    def run_algorithm_comparison(
        self,
        base_config: SystemConfig,
        scenario_name: str = "Straight-Line Cross-Track Traverse",
        duration_s: float = 3.0,
    ) -> AlgorithmComparisonResponse:
        """
        Executes an identical scenario across all 5 algorithm architectures:
        1. Basic CV (Thresholding + Moments, open-loop proportional)
        2. CV + Kalman (Moments fused with 4D kinematic Kalman filter)
        3. CV + PID (Moments with tuned closed-loop 2-axis PID)
        4. AI (AI detector with clutter rejection, direct PID)
        5. AI + Kalman + PID (AI detector + 4D Kalman + tuned anti-windup PID)

        Yields strictly objective measurements without subjective rankings.
        """
        from backend.app.simulation.engine import SimulationEngine

        algorithms = [
            {"id": "Basic CV", "method": "Classical CV", "kalman": False, "pid_mode": "P_ONLY"},
            {"id": "CV + Kalman", "method": "CV + Kalman", "kalman": True, "pid_mode": "STANDARD"},
            {"id": "CV + PID", "method": "Classical CV", "kalman": False, "pid_mode": "FULL_PID"},
            {"id": "AI", "method": "AI Detector", "kalman": False, "pid_mode": "STANDARD"},
            {"id": "AI + Kalman + PID", "method": "AI + Kalman", "kalman": True, "pid_mode": "FULL_PID"},
        ]

        total_frames = int(duration_s * base_config.camera.update_rate_hz)
        results: List[AlgorithmComparisonResult] = []

        for algo in algorithms:
            # Create a clone of base_config to ensure identical initial target, trajectory, and camera state
            cfg = copy.deepcopy(base_config)
            cfg.detection.method = algo["method"]  # type: ignore
            cfg.detection.algorithm = algo["method"]

            # Configure PID gains based on comparison mode
            if algo["pid_mode"] == "P_ONLY":
                cfg.control.mode = "PID Coarse Pointing"
                cfg.control.kp_pan = 1.0
                cfg.control.ki_pan = 0.0
                cfg.control.kd_pan = 0.0
                cfg.control.kp_tilt = 1.0
                cfg.control.ki_tilt = 0.0
                cfg.control.kd_tilt = 0.0
            elif algo["pid_mode"] == "FULL_PID":
                cfg.control.mode = "PID Coarse Pointing"
                cfg.control.kp_pan = 1.4
                cfg.control.ki_pan = 0.08
                cfg.control.kd_pan = 0.22
                cfg.control.kp_tilt = 1.4
                cfg.control.ki_tilt = 0.02
                cfg.control.kd_tilt = 0.15

            sim = SimulationEngine(cfg)
            sim.detector.set_method(algo["method"])

            # Run deterministic step iterations
            for _ in range(total_frames):
                sim.step(dt=sim.dt)

            metrics = sim.analytics.calculate_metrics()
            reqs = sim.analytics.evaluate_official_requirements()
            passed_reqs = sum(1 for r in reqs if r.status == "PASS")

            results.append(
                AlgorithmComparisonResult(
                    algorithm_name=algo["id"],
                    mean_tracking_error_px=metrics.average_tracking_error_px or 0.0,
                    max_tracking_error_px=metrics.max_tracking_error_px or 0.0,
                    rmse_px=metrics.rmse_px or 0.0,
                    lock_retention_percent=metrics.lock_retention_percent,
                    target_loss_percent=metrics.target_loss_percent,
                    acquisition_time_s=metrics.acquisition_time_s,
                    reacquisition_time_s=metrics.reacquisition_time_s,
                    average_latency_ms=metrics.average_processing_time_ms,
                    average_fps=metrics.average_fps,
                    passed_requirements_count=passed_reqs,
                    total_requirements_count=len(reqs),
                    overall_pass=(passed_reqs == len(reqs)),
                )
            )

        return AlgorithmComparisonResponse(
            scenario_name=scenario_name,
            duration_s=duration_s,
            total_frames_per_run=total_frames,
            compared_algorithms=results,
            timestamp=datetime.utcnow().isoformat() + "Z",
        )

    def export_csv(self) -> str:
        """Exports all archived experiments to CSV format."""
        headers = [
            "experiment_id",
            "timestamp",
            "name",
            "algorithm",
            "target_motion",
            "noise_type",
            "noise_level_sigma",
            "duration_s",
            "total_frames",
            "mean_tracking_error_px",
            "rmse_px",
            "lock_retention_percent",
            "target_loss_percent",
            "average_fps",
            "average_latency_ms",
            "overall_status",
        ]
        lines = [",".join(headers)]

        for rec in self.list_experiments():
            row = [
                rec.experiment_id,
                rec.timestamp,
                f'"{rec.name}"',
                rec.algorithm,
                rec.target_motion,
                rec.noise_type,
                str(rec.noise_level_sigma),
                str(rec.duration_s),
                str(rec.total_frames),
                str(rec.metrics.average_tracking_error_px or 0.0),
                str(rec.metrics.rmse_px or 0.0),
                str(rec.metrics.lock_retention_percent),
                str(rec.metrics.target_loss_percent),
                str(rec.metrics.average_fps),
                str(rec.metrics.average_processing_time_ms),
                rec.overall_status,
            ]
            lines.append(",".join(row))

        return "\n".join(lines)
