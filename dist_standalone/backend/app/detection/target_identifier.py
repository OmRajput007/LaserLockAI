import math
from typing import List, Dict, Tuple, Optional
import numpy as np

from backend.app.models.config_model import DetectionConfig
from backend.app.detection.detector_base import Detection


class TargetIdentificationEngine:
    """
    Target Identification and False Bright Object Disambiguation Engine (Part 4).
    Disambiguates genuine FSOC optical beacon(s) from false bright objects
    (solar glints, cloud reflections, stray lights, sensor artifacts).

    Identification Criteria:
    1. Position: Proximity to prior beacon track or Kalman prediction (spatial gating).
    2. Size: Optical spot area plausibility matching expected optical diffraction aperture (10x10 px).
    3. Brightness: Peak optical radiance, contrast, and signal-to-noise ratio.
    4. Confidence: Morphological circularity, aspect ratio, and spot compactness.
    5. Temporal Consistency: Persistent kinematic continuity across consecutive simulation frames.
    """

    def __init__(self, config: DetectionConfig):
        self.config = config
        self.expected_size = config.expected_spot_size_px  # 10.0 px
        self.expected_area = config.expected_spot_size_px ** 2  # 100.0 px²
        self.max_jump_px = config.max_spatial_jump_px  # 80.0 px
        self.min_persistence = config.min_track_persistence_frames  # 2 frames

        # Active track state: {track_id: {x, y, persistence, misses, area, brightness}}
        self.active_tracks: Dict[int, Dict] = {}
        self.next_track_id = 1
        self.primary_track_id: Optional[int] = None

    def reset(self):
        """Resets all track histories."""
        self.active_tracks.clear()
        self.next_track_id = 1
        self.primary_track_id = None

    def update_config(self, config: DetectionConfig):
        self.config = config
        self.expected_size = config.expected_spot_size_px
        self.expected_area = config.expected_spot_size_px ** 2
        self.max_jump_px = config.max_spatial_jump_px
        self.min_persistence = config.min_track_persistence_frames

    def process_candidates(
        self,
        raw_candidates: List[Detection],
        predicted_pos: Optional[Tuple[float, float]] = None,
    ) -> Tuple[List[Detection], Optional[Detection], int]:
        """
        Evaluates raw candidate detections through multi-criteria identification.
        Classifies each candidate as:
        - "Primary Target"
        - "Secondary Target"
        - "False Bright Object (Clutter)"

        Returns:
            (identified_candidates, primary_detection, rejected_clutter_count)
        """
        if not raw_candidates:
            # Increment misses on existing tracks
            for tid in list(self.active_tracks.keys()):
                self.active_tracks[tid]["misses"] += 1
                if self.active_tracks[tid]["misses"] > 5:
                    del self.active_tracks[tid]
                    if self.primary_track_id == tid:
                        self.primary_track_id = None
            return [], None, 0

        scored_candidates: List[Tuple[float, Detection]] = []
        rejected_clutter_count = 0

        # Reference position: predicted position from Kalman or last primary track
        ref_x = None
        ref_y = None
        if predicted_pos and predicted_pos[0] is not None:
            ref_x, ref_y = predicted_pos
        elif self.primary_track_id in self.active_tracks:
            ref_x = self.active_tracks[self.primary_track_id]["x"]
            ref_y = self.active_tracks[self.primary_track_id]["y"]

        for cand in raw_candidates:
            # 1. Size Score: Plausibility relative to 10x10 px optical spot
            # False bright objects like large cloud glints (>400 px²) or 1px hot pixels are penalized
            if cand.area > 0:
                area_ratio = cand.area / self.expected_area
                log_ratio = abs(math.log(max(0.01, min(100.0, area_ratio))))
                size_score = math.exp(- (log_ratio ** 2) / 2.0)
            else:
                size_score = 0.0

            # Direct hard-rejection for extreme false bright objects if enabled
            is_clutter = False
            if self.config.reject_false_bright_objects:
                # Glints that are larger than 4x expected area or smaller than 0.05x
                if cand.area > 400.0 or cand.area < 2.0:
                    is_clutter = True

            # 2. Position Score (Spatial Gating):
            if ref_x is not None and ref_y is not None:
                dist = math.sqrt((cand.centroid_x - ref_x) ** 2 + (cand.centroid_y - ref_y) ** 2)
                cand.spatial_distance = dist
                if dist > self.max_jump_px * 2.5:
                    pos_score = 0.1
                else:
                    pos_score = math.exp(- (dist ** 2) / (2.0 * (self.max_jump_px ** 2)))
            else:
                cand.spatial_distance = None
                pos_score = 0.8  # No reference available, neutral score

            # 3. Brightness Score
            brightness_score = min(1.0, cand.brightness / 255.0)

            # 4. Confidence Score (circularity, aspect ratio, SNR)
            conf_score = cand.confidence

            # 5. Temporal Consistency Score
            # Match candidate with existing tracks
            best_track_id = None
            min_track_dist = float("inf")
            for tid, tinfo in self.active_tracks.items():
                tdist = math.sqrt((cand.centroid_x - tinfo["x"]) ** 2 + (cand.centroid_y - tinfo["y"]) ** 2)
                if tdist < self.max_jump_px and tdist < min_track_dist:
                    min_track_dist = tdist
                    best_track_id = tid

            if best_track_id is not None:
                persistence = self.active_tracks[best_track_id]["persistence"] + 1
                temporal_score = min(1.0, persistence / 4.0)
            else:
                persistence = 1
                temporal_score = 0.35  # First frame candidate

            cand.temporal_score = temporal_score

            # Composite Identification Score (Weights summing to 1.0)
            # S_ID = 0.30*Pos + 0.25*Size + 0.20*Brightness + 0.15*Conf + 0.10*Temporal
            id_score = float(
                0.30 * pos_score +
                0.25 * size_score +
                0.20 * brightness_score +
                0.15 * conf_score +
                0.10 * temporal_score
            )

            if is_clutter:
                cand.classification = "False Bright Object (Clutter)"
                cand.is_primary = False
                rejected_clutter_count += 1
            else:
                scored_candidates.append((id_score, cand))

        # Sort valid candidates by identification score descending
        scored_candidates.sort(key=lambda item: item[0], reverse=True)

        identified_list: List[Detection] = []
        primary_det: Optional[Detection] = None

        if scored_candidates:
            # Top candidate is primary beacon
            best_score, primary_det = scored_candidates[0]
            primary_det.is_primary = True
            primary_det.classification = "Primary Target"
            identified_list.append(primary_det)

            # Update or create primary track
            if self.primary_track_id in self.active_tracks:
                self.active_tracks[self.primary_track_id].update({
                    "x": primary_det.centroid_x,
                    "y": primary_det.centroid_y,
                    "persistence": self.active_tracks[self.primary_track_id]["persistence"] + 1,
                    "misses": 0,
                })
            else:
                tid = self.next_track_id
                self.next_track_id += 1
                self.primary_track_id = tid
                self.active_tracks[tid] = {
                    "x": primary_det.centroid_x,
                    "y": primary_det.centroid_y,
                    "persistence": 1,
                    "misses": 0,
                }

            # Secondary candidates
            for idx, (score, cand) in enumerate(scored_candidates[1:], start=2):
                cand.is_primary = False
                cand.classification = "Secondary Target"
                identified_list.append(cand)

        # Append rejected clutter items with label
        for cand in raw_candidates:
            if cand.classification == "False Bright Object (Clutter)":
                identified_list.append(cand)

        return identified_list, primary_det, rejected_clutter_count
