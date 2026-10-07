import time
import math
from typing import List, Tuple, Optional, Dict, Any
import numpy as np
import cv2

from backend.app.models.config_model import DetectionConfig, CameraConfig
from backend.app.models.telemetry_model import (
    DetectionTelemetry,
    DetectionCandidateTelemetry,
)
from backend.app.detection.detector_base import BaseDetector, Detection, DetectionResult


class CameraIntrinsics:
    """
    Pinhole camera intrinsic calibration model.
    K = [ [fx,  0, cx],
          [ 0, fy, cy],
          [ 0,  0,  1] ]
    """

    def __init__(self, width: int = 640, height: int = 480, fov_h_deg: float = 4.0, fov_v_deg: float = 3.0):
        self.width = width
        self.height = height
        self.fov_h_deg = fov_h_deg
        self.fov_v_deg = fov_v_deg

        self.cx = width / 2.0
        self.cy = height / 2.0

        # Exact pinhole focal lengths in pixels: f = (dim / 2) / tan(FOV / 2)
        fov_h_rad = math.radians(fov_h_deg)
        fov_v_rad = math.radians(fov_v_deg)
        self.fx = (width / 2.0) / math.tan(fov_h_rad / 2.0)
        self.fy = (height / 2.0) / math.tan(fov_v_rad / 2.0)

    @property
    def matrix(self) -> np.ndarray:
        return np.array([
            [self.fx, 0.0, self.cx],
            [0.0, self.fy, self.cy],
            [0.0, 0.0, 1.0],
        ], dtype=np.float64)

    def pixel_to_angle_deg(self, ex: float, ey: float, use_calibrated: bool = True) -> Tuple[float, float]:
        """
        Converts pixel error (Ex, Ey) from camera center to angular error in degrees.
        Supports both the exact intrinsic calibration model:
            θx = arctan(Ex / fx)
            θy = arctan(Ey / fy)
        and the linear small-angle approximation:
            θx ≈ Ex * HFOV / Width
            θy ≈ Ey * VFOV / Height
        """
        if use_calibrated:
            theta_x = math.degrees(math.atan2(ex, self.fx))
            theta_y = math.degrees(math.atan2(ey, self.fy))
        else:
            theta_x = ex * (self.fov_h_deg / float(self.width))
            theta_y = ey * (self.fov_v_deg / float(self.height))
        return theta_x, theta_y


class OpenCVBeaconDetector(BaseDetector):
    """
    Real OpenCV-based Computer Vision Beacon Detector (Part 3 & Part 4).
    Operates strictly on actual virtual camera image frames without accessing ground-truth coordinates!

    Pipeline:
    1. Input Frame (640x480 Monochrome or Colour)
    2. Grayscale Conversion (if colour)
    3. Preprocessing (Gaussian blur noise suppression)
    4. Thresholding (Fixed intensity threshold or Otsu binarization)
    5. Morphological Operations (Opening to eliminate salt noise, closing to solidify spot)
    6. Contour Detection (cv2.findContours)
    7. Candidate Filtering (area, aspect ratio, peak brightness)
    8. Beacon Detection & Centroid Calculation (Image moments M10/M00, M01/M00)
    9. Error Metrics (Pixel center error, Euclidean error, Angular error with intrinsic support)
    10. Frame Annotation (Crosshairs, bounding box, centroid marker, error vector, HUD telemetry)
    """

    def __init__(self, config: DetectionConfig, camera_config: Optional[CameraConfig] = None):
        super().__init__(config, camera_config)
        self.camera_config = camera_config or CameraConfig()
        self.intrinsics = CameraIntrinsics(
            width=self.camera_config.resolution_width,
            height=self.camera_config.resolution_height,
            fov_h_deg=self.camera_config.fov_horizontal_deg,
            fov_v_deg=self.camera_config.fov_vertical_deg,
        )
        self.last_telemetry: Optional[DetectionTelemetry] = None
        self.last_intermediate_stages: Dict[str, np.ndarray] = {}

    def update_config(self, config: DetectionConfig, camera_config: Optional[CameraConfig] = None):
        super().update_config(config, camera_config)
        if camera_config:
            self.camera_config = camera_config
            self.intrinsics = CameraIntrinsics(
                width=self.camera_config.resolution_width,
                height=self.camera_config.resolution_height,
                fov_h_deg=self.camera_config.fov_horizontal_deg,
                fov_v_deg=self.camera_config.fov_vertical_deg,
            )

    def detect(self, frame: np.ndarray) -> DetectionResult:
        """
        Common detector interface implementation:
        detect(frame) -> DetectionResult (containing all detections and primary)
        """
        telemetry = self.process_frame(frame)
        h, w = frame.shape[:2] if frame is not None else (480, 640)

        # Convert candidate telemetry to standard Detection entities
        detections: List[Detection] = []
        for c in telemetry.candidates:
            detections.append(
                Detection(
                    candidate_id=c.candidate_id,
                    bbox=c.bbox,
                    centroid_x=c.centroid_x,
                    centroid_y=c.centroid_y,
                    area=c.area,
                    brightness=c.brightness,
                    confidence=c.confidence,
                    snr_db=c.snr_db,
                    is_primary=c.is_primary,
                    classification=c.classification,
                )
            )

        primary = detections[0] if detections else None
        return DetectionResult(
            detections=detections,
            primary_detection=primary,
            active_method="Classical CV",
            model_loaded=False,
            model_status="Classical CV Operational",
            detection_time_ms=telemetry.processing_time_ms,
            frame_width=w,
            frame_height=h,
            flicker_intensity=telemetry.flicker_intensity,
        )

    def detect_tuple(self, frame: np.ndarray) -> Tuple[Optional[float], Optional[float], float]:
        """
        Legacy tuple return: (centroid_x, centroid_y, confidence).
        """
        result = self.process_frame(frame)
        return result.detected_centroid_x, result.detected_centroid_y, result.confidence

    def process_frame(
        self,
        frame: np.ndarray,
        flicker_intensity: float = 255.0,
        store_intermediates: bool = False,
    ) -> DetectionTelemetry:
        """
        Processes a raw camera frame and returns comprehensive DetectionTelemetry.
        Strict rule: This method NEVER receives or uses target ground-truth coordinates.
        """
        start_time = time.perf_counter()

        if frame is None or frame.size == 0:
            return DetectionTelemetry(
                beacon_detected=False,
                confidence=0.0,
                processing_time_ms=0.0,
                flicker_intensity=flicker_intensity,
            )

        h, w = frame.shape[:2]

        # Stage 1: Grayscale conversion (if colour input)
        if len(frame.shape) == 3 and frame.shape[2] == 3:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        elif len(frame.shape) == 3 and frame.shape[2] == 4:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGRA2GRAY)
        else:
            gray = frame.copy() if frame.dtype == np.uint8 else frame.astype(np.uint8)

        # Stage 2: Preprocessing - Gaussian Blur noise suppression
        k_blur = self.config.gaussian_blur_kernel
        if k_blur % 2 == 0:
            k_blur += 1  # Kernel size must be odd
        k_blur = max(1, k_blur)

        if k_blur > 1:
            preprocessed = cv2.GaussianBlur(gray, (k_blur, k_blur), 0)
        else:
            preprocessed = gray.copy()

        # Stage 3: Thresholding
        if self.config.use_otsu:
            thresh_val, thresh = cv2.threshold(
                preprocessed, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU
            )
        else:
            thresh_val = float(self.config.intensity_threshold)
            _, thresh = cv2.threshold(
                preprocessed, self.config.intensity_threshold, 255, cv2.THRESH_BINARY
            )

        # Stage 4: Morphological operations (Opening to remove noise specks, closing to consolidate spot)
        k_morph = max(1, self.config.morph_kernel_size)
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k_morph, k_morph))
        opened = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel)
        morphed = cv2.morphologyEx(opened, cv2.MORPH_CLOSE, kernel)

        if store_intermediates:
            self.last_intermediate_stages = {
                "grayscale": gray,
                "preprocessed": preprocessed,
                "threshold": thresh,
                "morphed": morphed,
            }

        # Stage 5: Contour detection
        contours, _ = cv2.findContours(morphed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        # Estimate image background baseline and noise stddev for SNR computation
        # Use border pixels or global percentile
        bg_sample = np.concatenate([gray[0, :], gray[-1, :], gray[:, 0], gray[:, -1]])
        est_bg_mean = float(np.median(bg_sample))
        est_noise_sigma = float(np.std(bg_sample))
        if est_noise_sigma < 0.5:
            est_noise_sigma = 1.0

        # Dynamic fallback: if fixed thresholding yielded zero contours,
        # try Otsu thresholding ONLY if there is actual bright spot contrast above noise floor
        peak_brightness_val = float(gray.max())
        if len(contours) == 0 and not self.config.use_otsu and peak_brightness_val >= 80.0 and (peak_brightness_val - est_bg_mean) >= 30.0:
            _, thresh_otsu = cv2.threshold(preprocessed, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
            opened_otsu = cv2.morphologyEx(thresh_otsu, cv2.MORPH_OPEN, kernel)
            morphed_otsu = cv2.morphologyEx(opened_otsu, cv2.MORPH_CLOSE, kernel)
            cnts_otsu, _ = cv2.findContours(morphed_otsu, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            if len(cnts_otsu) > 0:
                contours = cnts_otsu
                thresh = thresh_otsu
                morphed = morphed_otsu

        # Stage 6: Candidate filtering & feature extraction
        candidates: List[DetectionCandidateTelemetry] = []
        candidate_idx = 1

        min_a = max(1.0, self.config.min_area)
        max_a = max(600.0, getattr(self.config, 'max_area', 600.0))

        for cnt in contours:
            # Area calculation via image moments or contourArea
            area = float(cv2.contourArea(cnt))
            if area < min_a or area > max_a:
                continue

            # Bounding box
            bx, by, bw, bh = cv2.boundingRect(cnt)

            # Centroid calculation using Image Moments:
            # Cx = M10 / M00, Cy = M01 / M00
            moments = cv2.moments(cnt)
            m00 = moments.get("m00", 0.0)
            if m00 > 1e-4:
                cx = moments["m10"] / m00
                cy = moments["m01"] / m00
            else:
                cx = bx + bw / 2.0
                cy = by + bh / 2.0

            # Pixel brightness inside candidate ROI
            roi = gray[by : by + bh, bx : bx + bw]
            if roi.size > 0:
                peak_brightness = float(np.max(roi))
                mean_brightness = float(np.mean(roi))
            else:
                peak_brightness = float(gray[int(round(cy)), int(round(cx))])
                mean_brightness = peak_brightness

            # Signal-to-Noise Ratio (SNR) in dB
            signal_delta = max(0.0, peak_brightness - est_bg_mean)
            snr_linear = signal_delta / est_noise_sigma if est_noise_sigma > 0 else 1.0
            snr_db = 20.0 * math.log10(max(1.0, snr_linear))

            # Confidence score calculation
            # Factors: brightness ratio, spot circularity/compactness, aspect ratio, SNR
            perimeter = cv2.arcLength(cnt, True)
            if perimeter > 0:
                circularity = (4.0 * math.pi * area) / (perimeter ** 2)
            else:
                circularity = 0.5
            circularity = min(1.0, max(0.0, circularity))

            aspect_ratio = float(bw) / float(bh) if bh > 0 else 1.0
            aspect_score = 1.0 - min(1.0, abs(1.0 - aspect_ratio))

            brightness_score = min(1.0, peak_brightness / 255.0)
            snr_score = min(1.0, snr_db / 30.0)

            confidence = float(
                0.40 * brightness_score +
                0.25 * snr_score +
                0.20 * aspect_score +
                0.15 * circularity
            )
            confidence = round(min(1.0, max(0.0, confidence)), 3)

            candidates.append(
                DetectionCandidateTelemetry(
                    candidate_id=candidate_idx,
                    bbox=[int(bx), int(by), int(bw), int(bh)],
                    centroid_x=round(float(cx), 2),
                    centroid_y=round(float(cy), 2),
                    area=round(area, 2),
                    brightness=round(peak_brightness, 1),
                    confidence=confidence,
                    snr_db=round(snr_db, 1),
                )
            )
            candidate_idx += 1

        # Stage 7: Primary Beacon Selection
        # Primary beacon is the candidate with the highest confidence score
        candidates.sort(key=lambda c: c.confidence, reverse=True)
        for idx, c in enumerate(candidates):
            c.is_primary = (idx == 0)
            c.classification = "Primary Target" if idx == 0 else "Secondary Target"

        elapsed_ms = round((time.perf_counter() - start_time) * 1000.0, 2)

        cam_cx = w / 2.0  # 320.0
        cam_cy = h / 2.0  # 240.0

        if candidates:
            primary = candidates[0]
            bx = primary.centroid_x
            by = primary.centroid_y

            # Camera center error:
            # Ex = Bx - Cx
            # Ey = By - Cy
            # Total error E = sqrt(Ex² + Ey²)
            ex = bx - cam_cx
            ey = by - cam_cy
            total_error = math.sqrt(ex ** 2 + ey ** 2)

            # Angular error calculation with intrinsic calibration support:
            # θx ≈ Ex * HFOV / Width
            # θy ≈ Ey * VFOV / Height
            ang_err_x, ang_err_y = self.intrinsics.pixel_to_angle_deg(ex, ey, use_calibrated=True)

            telemetry = DetectionTelemetry(
                beacon_detected=True,
                detected_centroid_x=round(bx, 2),
                detected_centroid_y=round(by, 2),
                bbox=primary.bbox,
                area=primary.area,
                brightness=primary.brightness,
                confidence=primary.confidence,
                pixel_error_x=round(ex, 2),
                pixel_error_y=round(ey, 2),
                total_pixel_error=round(total_error, 2),
                angular_error_x_deg=round(ang_err_x, 3),
                angular_error_y_deg=round(ang_err_y, 3),
                snr_db=primary.snr_db,
                processing_time_ms=elapsed_ms,
                candidate_count=len(candidates),
                candidates=candidates,
                flicker_intensity=flicker_intensity,
            )
        else:
            telemetry = DetectionTelemetry(
                beacon_detected=False,
                detected_centroid_x=None,
                detected_centroid_y=None,
                bbox=None,
                area=None,
                brightness=None,
                confidence=0.0,
                pixel_error_x=None,
                pixel_error_y=None,
                total_pixel_error=None,
                angular_error_x_deg=None,
                angular_error_y_deg=None,
                snr_db=None,
                processing_time_ms=elapsed_ms,
                candidate_count=0,
                candidates=[],
                flicker_intensity=flicker_intensity,
            )

        self.last_telemetry = telemetry
        return telemetry

    def annotate_frame(
        self,
        frame: np.ndarray,
        telemetry: Optional[DetectionTelemetry] = None,
        tracking: Optional[Any] = None,
        show_telemetry: bool = True,
    ) -> np.ndarray:
        """
        Renders visualization overlays directly onto the camera frame:
        - Camera Crosshairs (cyan/reticle at center 320, 240)
        - Inner 10px tracking tolerance ring
        - Outer 20px warning ring
        - Beacon Bounding Box (bright green box around primary candidate)
        - Beacon Centroid (cyan crosshair/dot at detected centroid)
        - Error Vector (bright yellow/red line from center to beacon centroid)
        - Telemetry HUD: Pixel error (Ex, Ey, E), Angular error (θx, θy), Confidence, SNR, CV Latency
        - Additional candidate bounding boxes (yellow) if multiple targets exist
        """
        # Ensure 3-channel BGR for colorful annotations
        if len(frame.shape) == 2:
            annotated = cv2.cvtColor(frame, cv2.COLOR_GRAY2BGR)
        else:
            annotated = frame.copy()

        h, w = annotated.shape[:2]
        cx_img = int(w // 2)
        cy_img = int(h // 2)

        det = telemetry or self.last_telemetry

        # Single source of truth for PAT lock and link blockage state
        pat_state = None
        is_blocked = False
        is_locked = False
        if tracking is not None:
            pat_state = getattr(tracking, "state", getattr(tracking, "mode", None))
            is_blocked = bool(getattr(tracking, "is_link_blocked", False) or pat_state in ("LINK_BLOCKED", "NO_COVERAGE"))
            is_locked = bool(getattr(tracking, "is_locked", False) or (pat_state == "LOCKED" and not is_blocked))

        # 1. Camera Crosshairs & Boresight Reticle
        # Center reticle lines
        crosshair_color = (255, 200, 0)  # Cyan/Gold BGR
        cv2.line(annotated, (cx_img - 30, cy_img), (cx_img - 8, cy_img), crosshair_color, 1)
        cv2.line(annotated, (cx_img + 8, cy_img), (cx_img + 30, cy_img), crosshair_color, 1)
        cv2.line(annotated, (cx_img, cy_img - 30), (cx_img, cy_img - 8), crosshair_color, 1)
        cv2.line(annotated, (cx_img, cy_img + 8), (cx_img, cy_img + 30), crosshair_color, 1)

        # 10-pixel Coarse Alignment Tolerance Circle (Green)
        cv2.circle(annotated, (cx_img, cy_img), 10, (0, 255, 120), 1)

        # 20-pixel Warning Ring (Amber)
        cv2.circle(annotated, (cx_img, cy_img), 20, (0, 180, 255), 1)

        # 2. Draw Candidates & Primary Detection (Only when link is not blocked)
        is_pri_clutter = False
        if not is_blocked and det and det.beacon_detected and det.detected_centroid_x is not None and det.detected_centroid_y is not None:
            bx = int(round(det.detected_centroid_x))
            by = int(round(det.detected_centroid_y))

            # Determine if the primary candidate is a genuine beacon or clutter
            pri_cand = det.candidates[0] if det.candidates else None
            pri_id = pri_cand.candidate_id if pri_cand else 1
            is_pri_clutter = bool(
                (pri_cand and pri_cand.classification == "False Bright Object (Clutter)")
                or (getattr(det, "target_classification", None) == "False Bright Object (Clutter)")
                or pri_id > 1  # Genuine beacon has ID 1; false bright objects/glints are IDs > 1
            )

            # Draw secondary candidates if any
            if len(det.candidates) > 1:
                for cand in det.candidates[1:]:
                    cbx, cby, cbw, cbh = cand.bbox
                    is_cand_clutter = bool(
                        cand.classification == "False Bright Object (Clutter)"
                        or cand.candidate_id > 1
                    )
                    cand_label = f"CLUTTER #{cand.candidate_id}" if is_cand_clutter else f"#{cand.candidate_id}"
                    cand_color = (0, 165, 255) if is_cand_clutter else (0, 255, 255)
                    cv2.rectangle(annotated, (cbx, cby), (cbx + cbw, cby + cbh), cand_color, 1)
                    cv2.putText(
                        annotated,
                        cand_label,
                        (cbx, max(10, cby - 3)),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.35,
                        cand_color,
                        1,
                    )

            # Primary Beacon / Clutter Bounding Box
            if det.bbox:
                px, py, pw, ph = det.bbox
                if is_pri_clutter:
                    box_color = (0, 165, 255)  # Amber for Clutter / Solar Glint
                    label_text = f"CLUTTER #{pri_id}"
                else:
                    box_color = (0, 255, 0)    # Bright Green for verified genuine beacon
                    label_text = f"BEACON #{pri_id}"

                cv2.rectangle(annotated, (px, py), (px + pw, py + ph), box_color, 2)
                cv2.putText(
                    annotated,
                    label_text,
                    (px, max(12, py - 4)),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.4,
                    box_color,
                    1,
                )

            # Beacon Centroid Marker
            cv2.circle(annotated, (bx, by), 3, (255, 255, 0), -1)  # Cyan dot
            cv2.circle(annotated, (bx, by), 7, (0, 255, 0), 1)   # Green ring

            # Error Vector: Line from camera center (320, 240) to detected centroid
            vector_color = (0, 120, 255) if (det.total_pixel_error or 0) > 10.0 else (0, 255, 120)
            cv2.line(annotated, (cx_img, cy_img), (bx, by), vector_color, 2)

            # Midpoint error label along vector (only when telemetry is enabled)
            if show_telemetry:
                mid_x = (cx_img + bx) // 2
                mid_y = (cy_img + by) // 2
                cv2.putText(
                    annotated,
                    f"E={det.total_pixel_error:.1f}px",
                    (mid_x + 5, mid_y - 5),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.35,
                    vector_color,
                    1,
                )

        # 3. HUD Overlay Information Panel (Telemetry Data)
        if show_telemetry:
            hud_bg_color = (15, 20, 30)
            cv2.rectangle(annotated, (8, 8), (280, 115), hud_bg_color, -1)
            cv2.rectangle(annotated, (8, 8), (280, 115), (60, 80, 100), 1)

            if is_blocked:
                status_text = f"STATUS: {pat_state or 'LINK_BLOCKED'} (OCCLUDED)"
                status_color = (0, 70, 255)
                centroid_str = "Centroid: NONE (LOS BLOCKED BY EARTH)"
                err_pixel_str = "Pixel Err: N/A (LINK BLOCKED)"
                err_ang_str = "Angular: N/A (LINK BLOCKED)"
                perf_str = f"PAT State: {pat_state or 'LINK_BLOCKED'} | CV: {det.processing_time_ms if det else 0.0:.1f}ms"
            elif det and det.beacon_detected and det.detected_centroid_x is not None:
                if is_pri_clutter:
                    status_text = "STATUS: CLUTTER DETECTED [REJECTED]" if (getattr(det, 'rejected_clutter_count', 0) > 0) else f"STATUS: CLUTTER DETECTED [{pat_state or 'TRACKING'}]"
                    status_color = (0, 165, 255)
                elif is_locked:
                    status_text = "STATUS: BEACON DETECTED [LOCKED]"
                    status_color = (0, 255, 120)
                elif pat_state:
                    status_text = f"STATUS: BEACON DETECTED [{pat_state}]"
                    status_color = (255, 200, 0) if pat_state in ("TRACKING", "ACQUIRING") else (0, 180, 255)
                else:
                    is_aligned = (det.total_pixel_error or 999.0) <= 10.0
                    status_text = "STATUS: BEACON DETECTED [ALIGNED]" if is_aligned else "STATUS: BEACON DETECTED [UNLOCKED]"
                    status_color = (0, 255, 120) if is_aligned else (0, 180, 255)

                centroid_str = f"Centroid (Bx, By): ({det.detected_centroid_x:.1f}, {det.detected_centroid_y:.1f})"
                err_pixel_str = f"Pixel Err: Ex={det.pixel_error_x:+.1f} Ey={det.pixel_error_y:+.1f} | E={det.total_pixel_error:.1f}px" if det.pixel_error_x is not None and det.total_pixel_error is not None else "Pixel Err: N/A"
                err_ang_str = f"Angular: thX={det.angular_error_x_deg:+.2f} deg  thY={det.angular_error_y_deg:+.2f} deg" if det.angular_error_x_deg is not None else "Angular: N/A"
                perf_str = f"Conf: {det.confidence:.2f} | SNR: {det.snr_db:.1f}dB | CV: {det.processing_time_ms:.1f}ms"
            else:
                status_text = f"STATUS: {pat_state or 'ACQUIRING'} / NO BEACON"
                status_color = (0, 70, 255)
                centroid_str = "Centroid: NONE (TARGET OUT OF FOV)"
                err_pixel_str = "Pixel Err: N/A"
                err_ang_str = "Angular: N/A"
                perf_str = f"Candidates: 0 | CV Latency: {det.processing_time_ms if det else 0.0:.1f}ms"

            cv2.putText(annotated, status_text, (15, 26), cv2.FONT_HERSHEY_SIMPLEX, 0.42, status_color, 1)
            cv2.putText(annotated, centroid_str, (15, 46), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (220, 220, 220), 1)
            cv2.putText(annotated, err_pixel_str, (15, 66), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (100, 220, 255), 1)
            cv2.putText(annotated, err_ang_str, (15, 86), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (100, 220, 255), 1)
            cv2.putText(annotated, perf_str, (15, 106), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (180, 180, 180), 1)

            # Bottom-right Optical Specification Overlay
            spec_text = f"FOV: {self.intrinsics.fov_h_deg:.1f}x{self.intrinsics.fov_v_deg:.1f} deg | FPA: {w}x{h} | fx={self.intrinsics.fx:.1f}px"
            cv2.putText(annotated, spec_text, (w - 380, h - 12), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (120, 120, 120), 1)

        return annotated
