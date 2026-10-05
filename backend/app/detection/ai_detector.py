"""
AI-Ready Object Detection Module (Part 4) - YOLOv8 Integration.
Integrates Ultralytics YOLO (e.g. YOLOv8-Nano) with deterministic fallback to Classical CV.

Guarantees:
- One-time model load via ultralytics.YOLO.
- CASE A: model_loaded=True AND YOLO returns detections >= threshold -> use YOLO output.
- CASE B: model_loaded=True BUT YOLO returns nothing above threshold -> fallback to classical detector.
- CASE C: model_loaded=False (weights missing or ultralytics not installed) -> fallback to classical detector.
- STRICTLY HONEST: Never fabricates predictions; accurately reports model status and inference timing.
- Downstream compatibility: Exact same Detection and DetectionResult structure expected by TargetIdentificationEngine and Kalman filter.
"""

import os
import time
import math
import logging
from typing import Optional, List, Dict, Any
import numpy as np
import cv2

from backend.app.models.config_model import DetectionConfig, CameraConfig
from backend.app.detection.detector_base import BaseDetector, Detection, DetectionResult
from backend.app.detection.cv_detector import OpenCVBeaconDetector

logger = logging.getLogger("AIDetector")

try:
    from ultralytics import YOLO
    ULTRALYTICS_AVAILABLE = True
except ImportError:
    YOLO = None
    ULTRALYTICS_AVAILABLE = False


class AIDetector(BaseDetector):
    """
    AI-Ready Object Detection Module.
    Uses YOLOv8 (ultralytics) for real-time neural optical beacon detection with
    deterministic fallback to Classical CV.
    """

    def __init__(self, config: DetectionConfig, camera_config: Optional[CameraConfig] = None):
        super().__init__(config, camera_config)
        self.classical_detector = OpenCVBeaconDetector(config, camera_config)
        self.yolo_model: Optional[Any] = None
        self.model_loaded = False
        self.model_status = ""
        self._init_model()

    def _resolve_weights_path(self, path_str: Optional[str]) -> Optional[str]:
        """Resolves relative or absolute path to weights file."""
        if not path_str:
            return None
        if os.path.isfile(path_str):
            return os.path.abspath(path_str)
        # Try relative to workspace root
        base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
        candidate = os.path.join(base_dir, path_str)
        if os.path.isfile(candidate):
            return candidate
        # If .pt.zip exists instead of .pt, check candidate
        if os.path.isfile(candidate + ".zip"):
            return candidate + ".zip"
        return None

    def _init_model(self):
        """Attempts to load trained YOLO neural network weights once if present on disk."""
        if not ULTRALYTICS_AVAILABLE or YOLO is None:
            self.yolo_model = None
            self.model_loaded = False
            self.model_status = (
                "AI-Ready Architecture: 'ultralytics' library is not installed in the Python environment. "
                "Operating in Classical CV fallback without fabricated predictions."
            )
            return

        raw_path = self.config.model_weights_path
        resolved_path = self._resolve_weights_path(raw_path)

        # Avoid redundant disk reload if weights path has not changed
        if self.model_loaded and self.yolo_model is not None and getattr(self, "_loaded_weights_path", None) == resolved_path:
            return

        if resolved_path and os.path.isfile(resolved_path):
            try:
                # Load the model exactly ONCE into memory
                model = YOLO(resolved_path)

                # Device routing: CUDA / GPU if configured and available, else CPU
                device = "cpu"
                if self.config.ai_inference_device in ["CUDA", "GPU"]:
                    try:
                        import torch
                        if torch.cuda.is_available():
                            device = "cuda"
                    except Exception:
                        device = "cpu"

                try:
                    if device == "cuda":
                        model.to("cuda")
                except Exception as dev_err:
                    logger.warning(f"Could not route YOLO model to CUDA: {dev_err}. Retaining CPU.")
                    device = "cpu"

                self.yolo_model = model
                self.model_loaded = True
                self._loaded_weights_path = resolved_path
                self.model_status = (
                    f"Trained model '{self.config.ai_model_name}' loaded successfully "
                    f"on {device.upper()} ({os.path.basename(resolved_path)})"
                )
                logger.info(self.model_status)
            except Exception as e:
                self.yolo_model = None
                self.model_loaded = False
                self.model_status = f"YOLO model load error: {e}. Fallback to Classical CV."
                logger.warning(self.model_status)
        else:
            self.yolo_model = None
            self.model_loaded = False
            self.model_status = (
                f"AI-Ready Architecture: No trained weights file found at '{raw_path}'. "
                f"Operating in Classical CV fallback without fabricated predictions."
            )

    def update_config(self, config: DetectionConfig, camera_config: Optional[CameraConfig] = None):
        super().update_config(config, camera_config)
        self.classical_detector.update_config(config, camera_config)
        self._init_model()

    def detect(self, frame: np.ndarray) -> DetectionResult:
        """
        Common detector interface implementation:
        detect(frame) -> DetectionResult

        Cases:
        CASE A: model_loaded=True AND YOLO returns detections >= threshold -> use YOLO output
        CASE B: model_loaded=True BUT YOLO returns nothing above threshold -> fallback to classical_detector
        CASE C: model_loaded=False -> fallback to classical_detector (existing)
        """
        start_time = time.perf_counter()
        if frame is None or frame.size == 0:
            return DetectionResult(
                detections=[],
                primary_detection=None,
                active_method="AI Detector",
                model_loaded=self.model_loaded,
                model_status=self.model_status,
                detection_time_ms=0.0,
                frame_width=640,
                frame_height=480,
            )

        h, w = frame.shape[:2]

        # Check if YOLO model is loaded and ready
        if self.model_loaded and self.yolo_model is not None:
            try:
                detections = self._run_neural_inference(frame)
                elapsed_ms = (time.perf_counter() - start_time) * 1000.0

                # CASE A: YOLO found detections above threshold
                if len(detections) > 0:
                    primary = detections[0]
                    # Sample optical intensity at centroid for telemetry/flicker monitoring
                    flicker_int = self._sample_intensity(frame, primary.centroid_x, primary.centroid_y)

                    return DetectionResult(
                        detections=detections,
                        primary_detection=primary,
                        active_method=f"AI Detector ({self.config.ai_model_name} on {self.config.ai_inference_device})",
                        model_loaded=True,
                        model_status=self.model_status,
                        detection_time_ms=elapsed_ms,
                        frame_width=w,
                        frame_height=h,
                        flicker_intensity=flicker_int,
                        raw_candidate_count=len(detections),
                        metadata={"source": "YOLO", "candidates_count": len(detections)},
                    )
                else:
                    # CASE B: Model loaded, but no detections passed the confidence threshold
                    # Fallback to classical detector for this frame
                    classical_result = self.classical_detector.detect(frame)
                    elapsed_ms = (time.perf_counter() - start_time) * 1000.0

                    return DetectionResult(
                        detections=classical_result.detections,
                        primary_detection=classical_result.primary_detection,
                        active_method="AI Detector (Standby Fallback: Classical CV)",
                        model_loaded=True,
                        model_status=self.model_status,
                        detection_time_ms=elapsed_ms,
                        frame_width=w,
                        frame_height=h,
                        flicker_intensity=classical_result.flicker_intensity,
                        raw_candidate_count=classical_result.raw_candidate_count,
                        rejected_clutter_count=classical_result.rejected_clutter_count,
                        metadata={
                            "fallback_to_classical": True,
                            "reason": "YOLO confidence threshold not met",
                            "threshold": self.config.ai_confidence_threshold,
                        },
                    )
            except Exception as e:
                logger.error(f"Error during YOLO inference: {e}. Executing classical fallback.")

        # CASE C: No model loaded on disk
        classical_result = self.classical_detector.detect(frame)
        elapsed_ms = (time.perf_counter() - start_time) * 1000.0

        return DetectionResult(
            detections=classical_result.detections,
            primary_detection=classical_result.primary_detection,
            active_method="AI Detector (Standby Fallback: Classical CV)",
            model_loaded=False,
            model_status=self.model_status,
            detection_time_ms=elapsed_ms,
            frame_width=w,
            frame_height=h,
            flicker_intensity=classical_result.flicker_intensity,
            raw_candidate_count=classical_result.raw_candidate_count,
            rejected_clutter_count=classical_result.rejected_clutter_count,
            metadata={"fallback_to_classical": True, "reason": "No weights file supplied or ultralytics unavailable"},
        )

    def _sample_intensity(self, frame: np.ndarray, cx: float, cy: float) -> float:
        """Helper to sample optical intensity at detection centroid."""
        h, w = frame.shape[:2]
        ix, iy = int(round(cx)), int(round(cy))
        if 0 <= ix < w and 0 <= iy < h:
            val = frame[iy, ix]
            if isinstance(val, np.ndarray):
                return float(np.mean(val))
            return float(val)
        return 255.0

    def _run_neural_inference(self, frame: np.ndarray) -> List[Detection]:
        """Runs Ultralytics YOLO inference and returns formatted Detection objects."""
        h, w = frame.shape[:2]
        conf_thresh = self.config.ai_confidence_threshold

        # Run inference via the loaded model with optimized size and minimum confidence
        results = self.yolo_model(frame, conf=min(0.15, conf_thresh), imgsz=640, verbose=False)

        detections: List[Detection] = []
        if not results or len(results) == 0:
            return detections

        first_res = results[0]
        boxes = getattr(first_res, "boxes", None)
        if boxes is None or len(boxes) == 0:
            return detections

        # Extract all boxes, confidences, coordinates
        for i in range(len(boxes)):
            box = boxes[i]
            # Extract confidence
            conf = float(box.conf[0].item()) if hasattr(box.conf, "__len__") else float(box.conf.item())
            if conf < conf_thresh:
                continue

            # Extract [x1, y1, x2, y2]
            xyxy = box.xyxy[0].tolist() if hasattr(box.xyxy, "tolist") else [float(v) for v in box.xyxy[0]]
            x1, y1, x2, y2 = xyxy
            bw = max(1.0, float(x2 - x1))
            bh = max(1.0, float(y2 - y1))
            bx = int(max(0, x1))
            by = int(max(0, y1))
            cx = float(x1 + bw / 2.0)
            cy = float(y1 + bh / 2.0)
            area = float(bw * bh)

            brightness = self._sample_intensity(frame, cx, cy)
            snr_db = round(20.0 * math.log10(max(1.0, conf * 100.0)), 1)

            detections.append(
                Detection(
                    candidate_id=0,  # Will be assigned after sorting
                    bbox=[bx, by, int(bw), int(bh)],
                    centroid_x=cx,
                    centroid_y=cy,
                    area=area,
                    brightness=brightness,
                    confidence=conf,
                    snr_db=snr_db,
                    is_primary=False,
                    classification="Secondary Target",
                )
            )

        # Sort candidate detections by confidence descending
        detections.sort(key=lambda d: d.confidence, reverse=True)

        # Assign candidate IDs and mark highest-confidence as primary
        for idx, det in enumerate(detections):
            det.candidate_id = idx + 1
            det.is_primary = (idx == 0)
            det.classification = "Primary Target" if idx == 0 else "Secondary Target"

        return detections
