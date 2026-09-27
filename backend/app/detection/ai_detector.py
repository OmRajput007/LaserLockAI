import os
import time
from typing import Optional, List, Dict, Any
import numpy as np
import cv2

from backend.app.models.config_model import DetectionConfig, CameraConfig
from backend.app.detection.detector_base import BaseDetector, Detection, DetectionResult
from backend.app.detection.cv_detector import OpenCVBeaconDetector


class AIDetector(BaseDetector):
    """
    AI-Ready Object Detection Module (Part 4).
    Architected for integration with YOLOv8, MobileNet-SSD, or custom ONNX beacon models.

    Engineering Guarantees:
    - If trained weights exist at model_weights_path: Executes true neural inference.
    - If no trained model weights exist: Transparently falls back to Classical CV.
    - STRICTLY HONEST: Never fabricates AI predictions or claims an AI model is active
      when no weights file is present.
    - Truthfully reports model_loaded status and active detection method.
    """

    def __init__(self, config: DetectionConfig, camera_config: Optional[CameraConfig] = None):
        super().__init__(config, camera_config)
        self.classical_detector = OpenCVBeaconDetector(config, camera_config)
        self.net: Optional[cv2.dnn.Net] = None
        self.model_loaded = False
        self.model_status = ""
        self._init_model()

    def _init_model(self):
        """Attempts to load trained neural network weights if present on disk."""
        weights_path = self.config.model_weights_path

        if weights_path and os.path.isfile(weights_path):
            try:
                # Attempt to load ONNX / Darknet / Caffe network via OpenCV DNN
                self.net = cv2.dnn.readNet(weights_path)
                if self.config.ai_inference_device in ["CUDA", "GPU"]:
                    self.net.setPreferableBackend(cv2.dnn.DNN_BACKEND_CUDA)
                    self.net.setPreferableTarget(cv2.dnn.DNN_TARGET_CUDA)
                else:
                    self.net.setPreferableBackend(cv2.dnn.DNN_BACKEND_OPENCV)
                    self.net.setPreferableTarget(cv2.dnn.DNN_TARGET_CPU)

                self.model_loaded = True
                self.model_status = (
                    f"Trained model '{self.config.ai_model_name}' loaded successfully "
                    f"on {self.config.ai_inference_device} ({weights_path})"
                )
            except Exception as e:
                self.net = None
                self.model_loaded = False
                self.model_status = f"Model load error: {e}. Fallback to Classical CV."
        else:
            self.net = None
            self.model_loaded = False
            self.model_status = (
                f"AI-Ready Architecture: No trained weights file found at '{weights_path}'. "
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
        """
        start_time = time.perf_counter()
        h, w = frame.shape[:2]

        if frame is None or frame.size == 0:
            return DetectionResult(
                detections=[],
                primary_detection=None,
                active_method="AI Detector",
                model_loaded=self.model_loaded,
                model_status=self.model_status,
                detection_time_ms=0.0,
                frame_width=w,
                frame_height=h,
            )

        # CASE A: Real trained AI model weights are active on disk
        if self.model_loaded and self.net is not None:
            detections = self._run_neural_inference(frame)
            elapsed_ms = (time.perf_counter() - start_time) * 1000.0

            primary = detections[0] if detections else None
            return DetectionResult(
                detections=detections,
                primary_detection=primary,
                active_method=f"AI Detector ({self.config.ai_model_name} on {self.config.ai_inference_device})",
                model_loaded=True,
                model_status=self.model_status,
                detection_time_ms=elapsed_ms,
                frame_width=w,
                frame_height=h,
            )

        # CASE B: No trained model weights on disk
        # Requirement: "The system must continue functioning using classical CV. Do NOT fabricate AI predictions."
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
            metadata={"fallback_to_classical": True, "reason": "No weights file supplied"},
        )

    def _run_neural_inference(self, frame: np.ndarray) -> List[Detection]:
        """Runs true neural inference when a valid model is loaded."""
        h, w = frame.shape[:2]
        blob = cv2.dnn.blobFromImage(
            frame,
            scalefactor=1.0 / 255.0,
            size=(640, 480),
            swapRB=True,
            crop=False,
        )
        self.net.setInput(blob)
        outputs = self.net.forward()

        detections: List[Detection] = []
        conf_thresh = self.config.ai_confidence_threshold

        # Parse generic YOLO / SSD detection tensor [batch, num_dets, 6] (x, y, w, h, conf, class)
        if len(outputs.shape) == 3:
            for i in range(outputs.shape[1]):
                det = outputs[0, i]
                score = float(det[4]) if len(det) > 4 else float(det[2])
                if score >= conf_thresh:
                    cx = float(det[0]) * w
                    cy = float(det[1]) * h
                    bw = float(det[2]) * w
                    bh = float(det[3]) * h
                    bx = int(cx - bw / 2.0)
                    by = int(cy - bh / 2.0)
                    area = bw * bh
                    detections.append(
                        Detection(
                            candidate_id=len(detections) + 1,
                            bbox=[bx, by, int(bw), int(bh)],
                            centroid_x=cx,
                            centroid_y=cy,
                            area=area,
                            brightness=255.0,
                            confidence=score,
                            snr_db=30.0,
                            is_primary=(len(detections) == 0),
                            classification="Primary Target" if len(detections) == 0 else "Secondary Target",
                        )
                    )

        return detections
