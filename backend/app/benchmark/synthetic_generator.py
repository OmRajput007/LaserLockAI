"""
synthetic_generator.py
======================
Generates standard 30 FPS MP4 benchmark video datasets with exact
mathematical ground truth coordinates.

Provides ready-to-test sequences conforming to Problem Statement 4:
1. Straight Line Traverse (40 px/s with noise)
2. Circular Orbit (Radius 160 px, with beacon flicker)
3. Figure of 8 Lemniscate (with sensor noise)
4. Temporary Occlusion Stress Test (with cloud obstruction for coasting verification)
"""

import os
import math
import json
import csv
import cv2
import numpy as np
from typing import List, Tuple, Dict, Any, Optional

from backend.app.models.benchmark_model import GroundTruthPoint


class SyntheticBenchmarkGenerator:
    """
    Creates standard 30 FPS MP4 benchmark video sequences paired with
    ground-truth CSV and JSON trajectory annotations.
    """

    @staticmethod
    def generate_benchmark_video(
        scenario_name: str,
        output_dir: str,
        width: int = 640,
        height: int = 480,
        fps: float = 30.0,
        duration_s: float = 10.0,
    ) -> Tuple[str, str, str, List[GroundTruthPoint]]:
        """
        Renders a synthetic MP4 benchmark video and ground-truth files.

        Returns:
            (mp4_filepath, csv_filepath, json_filepath, ground_truth_points)
        """
        os.makedirs(output_dir, exist_ok=True)
        safe_name = scenario_name.lower().replace(" ", "_")
        mp4_path = os.path.join(output_dir, f"{safe_name}_30fps.mp4")
        csv_path = os.path.join(output_dir, f"{safe_name}_gt.csv")
        json_path = os.path.join(output_dir, f"{safe_name}_gt.json")

        total_frames = int(round(fps * duration_s))
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        writer = cv2.VideoWriter(mp4_path, fourcc, fps, (width, height))

        if not writer.isOpened():
            raise RuntimeError(f"Failed to initialize VideoWriter for {mp4_path}")

        gt_points: List[GroundTruthPoint] = []
        rng = np.random.default_rng(42)

        cx, cy = width / 2.0, height / 2.0
        dt = 1.0 / fps

        # Render frame-by-frame
        for frame_idx in range(total_frames):
            t = frame_idx * dt

            # 1. Base dark camera frame with thermal noise
            bg_base = 18.0
            noise_sigma = 5.0
            frame_float = rng.normal(loc=bg_base, scale=noise_sigma, size=(height, width))

            # 2. Compute Ground Truth Position (x, y) based on scenario
            is_occluded = False
            spot_intensity = 255.0

            if scenario_name == "Straight Line Traverse":
                # Linear sweep at 40 px/s from left (120) to right (520)
                sweep_w = 400.0
                period = sweep_w / 40.0  # 10s
                norm_phase = (t / period) % 1.0
                x = 120.0 + norm_phase * sweep_w
                y = cy + 25.0 * math.sin(2.0 * math.pi * 0.2 * t)

            elif scenario_name == "Circular Orbit":
                # Circular orbit, radius 160 px, period 5s (2 full revolutions)
                radius = 160.0
                omega = 2.0 * math.pi / 5.0
                x = cx + radius * math.cos(omega * t)
                y = cy + radius * math.sin(omega * t)
                # Mild beacon flicker modulation (spot stays reliably above threshold)
                spot_intensity = 255.0 * (0.85 + 0.15 * math.sin(2.0 * math.pi * 2.0 * t))

            elif scenario_name == "Figure of 8":
                # Lemniscate pattern
                scale_x = 180.0
                scale_y = 90.0
                omega = 2.0 * math.pi / 6.0
                x = cx + scale_x * math.sin(omega * t)
                y = cy + scale_y * math.sin(omega * t) * math.cos(omega * t)
                # Additional noise
                frame_float += rng.normal(loc=0.0, scale=8.0, size=(height, width))

            elif scenario_name == "Occlusion Test":
                # Linear sweep with temporary cloud occlusion between frame 90 and 130
                speed = 35.0
                x = 140.0 + (t * speed) % 360.0
                y = cy + 10.0 * math.sin(2.0 * math.pi * 0.4 * t)
                if 90 <= frame_idx <= 130:
                    is_occluded = True

            else:  # Default Stationary / Center Jitter
                x = cx + rng.normal(0, 3.0)
                y = cy + rng.normal(0, 3.0)

            # Record true ground truth point
            gt_point = GroundTruthPoint(
                frame=frame_idx,
                timestamp_s=round(t, 4),
                x=round(float(x), 2),
                y=round(float(y), 2),
                radius_px=6.0,
            )
            gt_points.append(gt_point)

            # 3. Render Optical Spot onto Frame (Gaussian Airy disk spot)
            if not is_occluded:
                # Render 2D Gaussian optical spot
                rx = int(round(x))
                ry = int(round(y))
                patch_rad = 12
                y_min, y_max = max(0, ry - patch_rad), min(height, ry + patch_rad + 1)
                x_min, x_max = max(0, rx - patch_rad), min(width, rx + patch_rad + 1)

                for py in range(y_min, y_max):
                    for px in range(x_min, x_max):
                        dist_sq = (px - x) ** 2 + (py - y) ** 2
                        # Gaussian spot profile sigma = 2.5
                        spot_val = spot_intensity * math.exp(-dist_sq / (2.0 * 2.5 ** 2))
                        frame_float[py, px] = max(frame_float[py, px], spot_val)
            else:
                # Render cloud obstacle patch over target region
                bx, by = int(round(x)), int(round(y))
                cv2.ellipse(
                    frame_float,
                    (bx, by),
                    (45, 30),
                    angle=20,
                    startAngle=0,
                    endAngle=360,
                    color=float(bg_base + 10.0),
                    thickness=-1,
                )

            # Convert to uint8 and 3-channel BGR for standard MP4 encoding
            frame_u8 = np.clip(frame_float, 0, 255).astype(np.uint8)
            frame_bgr = cv2.cvtColor(frame_u8, cv2.COLOR_GRAY2BGR)
            writer.write(frame_bgr)

        writer.release()

        # 4. Save Ground-Truth CSV
        with open(csv_path, "w", newline="") as f:
            csv_writer = csv.writer(f)
            csv_writer.writerow(["frame", "timestamp_s", "x", "y", "radius_px"])
            for pt in gt_points:
                csv_writer.writerow([pt.frame, pt.timestamp_s, pt.x, pt.y, pt.radius_px])

        # 5. Save Ground-Truth JSON
        with open(json_path, "w") as f:
            json.dump([pt.model_dump() for pt in gt_points], f, indent=2)

        return mp4_path, csv_path, json_path, gt_points
