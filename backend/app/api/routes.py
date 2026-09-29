import cv2
from fastapi import APIRouter, HTTPException, Response, UploadFile, File
from pydantic import BaseModel, Field
from typing import Dict, Any, List, Literal, Optional

from backend.app.config.manager import config_manager
from backend.app.models.config_model import SystemConfig
from backend.app.simulation.engine import sim_engine

router = APIRouter(prefix="/api", tags=["System & Telemetry"])


class GimbalRateCommand(BaseModel):
    pan_rate_deg_s: float = Field(..., ge=-5.0, le=5.0, description="Pan rate command (-5°/s to +5°/s)")
    tilt_rate_deg_s: float = Field(..., ge=-5.0, le=5.0, description="Tilt rate command (-5°/s to +5°/s)")


class GimbalAngleCommand(BaseModel):
    pan_deg: float = Field(..., description="Target pan angle in degrees")
    tilt_deg: float = Field(..., description="Target tilt angle in degrees")


class TargetShapeCommand(BaseModel):
    shape: Literal["Square", "Circle", "Gaussian"] = Field(..., description="Beacon optical shape")


class TargetMotionCommand(BaseModel):
    trajectory_type: Literal[
        "Straight Line",
        "Circular",
        "Figure of 8",
        "Random",
        "Spiral",
        "Sinusoidal",
        "Waypoint",
        "User-defined",
    ] = Field(..., description="Trajectory motion pattern")
    speed_pixels_per_s: Optional[float] = Field(None, ge=1.0, le=500.0)


@router.get("/status")
def get_status() -> Dict[str, Any]:
    """Application health and subsystem readiness check."""
    return {
        "status": "operational",
        "system": "AI-Based Virtual Camera Tracking System for Mobile FSOC Terminals",
        "version": "1.0.0-part2",
        "simulation_running": sim_engine.is_running,
        "current_frame": sim_engine.frame_number,
        "sim_time_s": round(sim_engine.sim_time, 3),
        "measured_fps": sim_engine.measured_fps,
        "subsystems": {
            "virtual_environment_3d": "ready",
            "camera_fpa_model": "ready",
            "camera_3d_projective_model": "ready",
            "target_beacon_3d": "ready",
            "gimbal_actuator_limits": "ready",
            "config_manager": "ready",
            "telemetry_stream": "ready",
        },
    }


@router.get("/config", response_model=SystemConfig)
def get_configuration():
    """Returns active testbench configuration conforming to Problem Statement 4."""
    return config_manager.get_config()


@router.post("/config", response_model=SystemConfig)
def update_configuration(new_config: SystemConfig):
    """Updates and saves active configuration, notifying simulation engine."""
    saved_cfg = config_manager.set_config(new_config)
    sim_engine.update_config(saved_cfg)
    return saved_cfg


@router.post("/config/reset", response_model=SystemConfig)
def reset_configuration_defaults():
    """Resets configuration to official Problem Statement 4 default parameters."""
    default_cfg = config_manager.reset_defaults()
    sim_engine.update_config(default_cfg)
    return default_cfg


@router.post("/simulation/start")
def start_simulation():
    """Resumes/starts the simulation loop."""
    sim_engine.is_running = True
    return {"status": "started", "simulation_running": True}


@router.post("/simulation/pause")
def pause_simulation():
    """Pauses the simulation loop."""
    sim_engine.is_running = False
    return {"status": "paused", "simulation_running": False}


@router.post("/simulation/reset")
def reset_simulation():
    """Resets target position, camera angles, and metrics."""
    sim_engine.reset()
    return {"status": "reset", "sim_time_s": 0.0, "frame_number": 0}


@router.post("/simulation/step")
def step_simulation():
    """Steps the simulation ahead by 1 discrete frame."""
    telemetry = sim_engine.step()
    return telemetry


@router.get("/simulation/telemetry")
def get_telemetry():
    """Returns instantaneous simulation telemetry snapshot."""
    return sim_engine.step(dt=0.0)


@router.post("/simulation/gimbal/rate")
@router.post("/simulation/gimbal")  # Backward compatibility
def command_gimbal_rate(cmd: GimbalRateCommand):
    """Commands camera gimbal pan/tilt rate within safe physical bounds (max 5 deg/s)."""
    sim_engine.set_manual_gimbal_rates(cmd.pan_rate_deg_s, cmd.tilt_rate_deg_s)
    return {
        "status": "rate_command_accepted",
        "pan_rate_deg_s": cmd.pan_rate_deg_s,
        "tilt_rate_deg_s": cmd.tilt_rate_deg_s,
    }


@router.post("/simulation/gimbal/angles")
def command_gimbal_angles(cmd: GimbalAngleCommand):
    """Commands camera pan and tilt target setpoint angles (slews at max 5°/s)."""
    sim_engine.set_gimbal_target_angles(cmd.pan_deg, cmd.tilt_deg)
    return {
        "status": "target_angles_accepted",
        "target_pan_deg": sim_engine.camera.target_pan_deg,
        "target_tilt_deg": sim_engine.camera.target_tilt_deg,
    }


@router.post("/simulation/target/shape")
def set_target_shape(cmd: TargetShapeCommand):
    """Updates optical spot geometry (Square, Circle, Gaussian)."""
    cfg = config_manager.get_config()
    cfg.target.shape = cmd.shape
    config_manager.set_config(cfg)
    sim_engine.update_config(cfg)
    return {"status": "shape_updated", "shape": cmd.shape}


@router.post("/simulation/target/motion")
def set_target_motion(cmd: TargetMotionCommand):
    """Updates trajectory generator in real-time."""
    cfg = config_manager.get_config()
    cfg.motion.trajectory_type = cmd.trajectory_type
    if cmd.speed_pixels_per_s:
        cfg.motion.speed_pixels_per_s = cmd.speed_pixels_per_s
    config_manager.set_config(cfg)
    sim_engine.update_config(cfg)
    return {"status": "motion_updated", "trajectory_type": cmd.trajectory_type}


class TargetPositionCommand(BaseModel):
    x: float
    y: float
    z: Optional[float] = 1000.0


@router.post("/simulation/target/position")
def set_target_position(cmd: TargetPositionCommand):
    """Overrides target position directly in 3D world space (e.g. for testing acquisition & loss)."""
    sim_engine.target_manager.set_position(cmd.x, cmd.y, cmd.z or 1000.0)
    return {"status": "position_updated", "x": cmd.x, "y": cmd.y, "z": cmd.z}


class TargetSpeedCommand(BaseModel):
    speed_pixels_per_s: float = Field(..., ge=1.0, le=500.0, description="Beacon speed in pixels/second (1–500)")


@router.post("/simulation/target/speed")
def set_beacon_speed(cmd: TargetSpeedCommand):
    """
    Changes beacon speed mid-simulation without resetting or rebuilding the trajectory.
    Instantly patches the generator.speed on ALL active targets and syncs the config.
    Derived quantities (angular_speed for circular, omega for figure-8, etc.) are
    also recomputed so the speed change takes full effect on the next engine tick.
    """
    import math as _math
    new_speed = cmd.speed_pixels_per_s

    # 1. Patch every live target's generator in-place
    for target in sim_engine.target_manager.targets:
        gen = target._generator
        if gen is None:
            continue
        gen.speed = new_speed

        # Re-derive trajectory-specific speed-dependent quantities
        gen_class = type(gen).__name__
        if gen_class == "CircularTrajectory":
            gen.angular_speed = new_speed / max(gen.radius, 1.0)
        elif gen_class == "FigureOf8Trajectory":
            gen.omega = new_speed / max(gen.amplitude_x, 1.0)
        elif gen_class == "SpiralTrajectory":
            # omega is the angular rate — keep same radius growth, scale angular speed
            if hasattr(gen, "angular_speed"):
                r = max((_math.hypot(gen.x - gen.cx, gen.y - gen.cy)), 1.0)
                gen.angular_speed = new_speed / r
        elif gen_class == "StraightLineTrajectory":
            # Re-scale velocity vector to new speed while preserving direction
            cur_speed = _math.hypot(gen.vx, gen.vy)
            if cur_speed > 0:
                scale = new_speed / cur_speed
                gen.vx *= scale
                gen.vy *= scale

    # 2. Persist to config (non-resetting path — just updates the value)
    cfg = config_manager.get_config()
    cfg.motion.speed_pixels_per_s = new_speed
    config_manager.set_config(cfg)

    return {
        "status": "speed_updated",
        "speed_pixels_per_s": new_speed,
        "active_targets": len(sim_engine.target_manager.targets),
    }



class CustomPathCommand(BaseModel):
    waypoints: List[List[float]]   # [[x0,y0], [x1,y1], ...]
    speed_pixels_per_s: Optional[float] = None


@router.post("/simulation/target/custom_path")
def set_custom_path(cmd: CustomPathCommand):
    """
    Activates 'Custom Path' trajectory and loads user-drawn looped waypoints.
    Requires at least 2 waypoints. The backend automatically closes the loop
    by re-appending the first waypoint at the end.
    """
    from backend.app.target.motion_generators import CustomPathTrajectory

    if len(cmd.waypoints) < 2:
        raise HTTPException(status_code=400, detail="Custom path requires at least 2 waypoints.")

    waypoints_xy = [(float(wp[0]), float(wp[1])) for wp in cmd.waypoints]

    # Update config so trajectory_type reflects the new mode
    cfg = config_manager.get_config()
    cfg.motion.trajectory_type = "Custom Path"
    if cmd.speed_pixels_per_s:
        cfg.motion.speed_pixels_per_s = cmd.speed_pixels_per_s
    config_manager.set_config(cfg)

    # Directly swap the motion generator on the primary target
    primary = sim_engine.target_manager.primary_target
    gen = primary._generator

    if isinstance(gen, CustomPathTrajectory):
        # Already a custom path — update waypoints in-place
        gen.speed = cfg.motion.speed_pixels_per_s
        gen.cz = primary.z
        gen.set_waypoints(waypoints_xy)
    else:
        # Create new CustomPathTrajectory and attach it
        cz = primary.z
        new_gen = CustomPathTrajectory(
            waypoints_xy=waypoints_xy,
            cx=float(cfg.motion.screen_width) / 2.0,
            cy=float(cfg.motion.screen_height) / 2.0,
            cz=cz,
            speed=cfg.motion.speed_pixels_per_s,
            world_width=float(cfg.motion.screen_width),
            world_height=float(cfg.motion.screen_height),
            world_depth=float(cfg.motion.world_depth_z),
        )
        primary._generator = new_gen
        # Start from the first waypoint
        primary.x, primary.y, primary.z = new_gen.x, new_gen.y, new_gen.z

    return {
        "status": "custom_path_activated",
        "waypoint_count": len(waypoints_xy),
        "loop_closed": True,
    }


@router.get("/simulation/frame")
def get_camera_frame(annotated: bool = False):
    """
    Renders 640x480 FPA frame.
    If annotated=True, includes camera crosshairs, detected bounding box,
    moments centroid, error vector, and HUD telemetry metrics.
    """
    frame = sim_engine.render_fpa_frame(annotated=annotated)
    success, buffer = cv2.imencode(".jpg", frame)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to encode frame")
    return Response(content=buffer.tobytes(), media_type="image/jpeg")


@router.get("/simulation/detection/intermediates")
def get_detection_intermediates():
    """
    Returns base64 JPEG representations of intermediate computer vision stages:
    Grayscale, Preprocessed (Gaussian Blur), Threshold, and Morphed.
    """
    import base64
    raw_frame = sim_engine.generate_raw_fpa_frame()
    sim_engine.detector.classical_detector.process_frame(raw_frame, store_intermediates=True)
    stages = sim_engine.detector.classical_detector.last_intermediate_stages

    encoded_stages = {}
    for name, img in stages.items():
        ok, buf = cv2.imencode(".jpg", img)
        if ok:
            encoded_stages[name] = f"data:image/jpeg;base64,{base64.b64encode(buf.tobytes()).decode('ascii')}"

    return {
        "status": "success",
        "stages": encoded_stages,
        "telemetry": sim_engine.detector.last_telemetry,
    }


class DetectionTuneCommand(BaseModel):
    intensity_threshold: Optional[int] = Field(None, ge=0, le=255)
    use_otsu: Optional[bool] = None
    min_area: Optional[float] = Field(None, ge=1.0)
    max_area: Optional[float] = Field(None, le=5000.0)
    morph_kernel_size: Optional[int] = Field(None, ge=1, le=15)
    gaussian_blur_kernel: Optional[int] = Field(None, ge=1, le=15)
    annotate_frame: Optional[bool] = None


@router.post("/simulation/detection/tune")
def tune_detection_parameters(cmd: DetectionTuneCommand):
    """Updates computer vision hyperparameters in real-time."""
    cfg = config_manager.get_config()
    if cmd.intensity_threshold is not None:
        cfg.detection.intensity_threshold = cmd.intensity_threshold
    if cmd.use_otsu is not None:
        cfg.detection.use_otsu = cmd.use_otsu
    if cmd.min_area is not None:
        cfg.detection.min_area = cmd.min_area
    if cmd.max_area is not None:
        cfg.detection.max_area = cmd.max_area
    if cmd.morph_kernel_size is not None:
        cfg.detection.morph_kernel_size = cmd.morph_kernel_size
    if cmd.gaussian_blur_kernel is not None:
        cfg.detection.gaussian_blur_kernel = cmd.gaussian_blur_kernel
    if cmd.annotate_frame is not None:
        cfg.detection.annotate_frame = cmd.annotate_frame

    config_manager.set_config(cfg)
    sim_engine.detector.update_config(cfg.detection, cfg.camera)
    return {"status": "detection_tuned", "detection_config": cfg.detection}


# ==============================================================================
# PART 4 API ENDPOINTS: AI-ASSISTED DETECTION & TARGET IDENTIFICATION
# ==============================================================================

class DetectionMethodCommand(BaseModel):
    method: Literal["Classical CV", "AI Detector", "CV + Kalman", "AI + Kalman"] = Field(
        ..., description="Active detection architecture mode"
    )


@router.post("/simulation/detection/method")
def set_detection_method(cmd: DetectionMethodCommand):
    """Switches active detection method between Classical CV, AI Detector, CV+Kalman, AI+Kalman."""
    cfg = config_manager.get_config()
    cfg.detection.method = cmd.method
    cfg.detection.algorithm = cmd.method
    config_manager.set_config(cfg)
    sim_engine.detector.update_config(cfg.detection, cfg.camera)
    return {
        "status": "method_switched",
        "method": cmd.method,
        "active_method": sim_engine.detector.last_telemetry.active_method if sim_engine.detector.last_telemetry else cmd.method,
        "ai_model_loaded": sim_engine.detector.ai_detector.model_loaded,
        "kalman_active": "Kalman" in cmd.method,
    }


class AIConfigCommand(BaseModel):
    model_config = {"protected_namespaces": ()}
    ai_model_name: Optional[str] = None
    ai_confidence_threshold: Optional[float] = Field(None, ge=0.05, le=1.0)
    ai_input_resolution: Optional[str] = None
    ai_inference_device: Optional[Literal["CPU", "GPU", "CUDA", "DirectML"]] = None
    ai_detection_frequency_hz: Optional[float] = Field(None, ge=1.0, le=60.0)
    model_weights_path: Optional[str] = None


@router.post("/simulation/detection/ai")
def update_ai_configuration(cmd: AIConfigCommand):
    """Updates AI detection model hyperparameters and hardware execution device."""
    cfg = config_manager.get_config()
    if cmd.ai_model_name is not None:
        cfg.detection.ai_model_name = cmd.ai_model_name
    if cmd.ai_confidence_threshold is not None:
        cfg.detection.ai_confidence_threshold = cmd.ai_confidence_threshold
    if cmd.ai_input_resolution is not None:
        cfg.detection.ai_input_resolution = cmd.ai_input_resolution
    if cmd.ai_inference_device is not None:
        cfg.detection.ai_inference_device = cmd.ai_inference_device
    if cmd.ai_detection_frequency_hz is not None:
        cfg.detection.ai_detection_frequency_hz = cmd.ai_detection_frequency_hz
    if cmd.model_weights_path is not None:
        cfg.detection.model_weights_path = cmd.model_weights_path

    config_manager.set_config(cfg)
    sim_engine.detector.update_config(cfg.detection, cfg.camera)
    return {
        "status": "ai_config_updated",
        "ai_config": {
            "model_name": cfg.detection.ai_model_name,
            "confidence_threshold": cfg.detection.ai_confidence_threshold,
            "inference_device": cfg.detection.ai_inference_device,
            "weights_path": cfg.detection.model_weights_path,
            "model_loaded": sim_engine.detector.ai_detector.model_loaded,
            "model_status": sim_engine.detector.ai_detector.model_status,
        },
    }


class ClutterCommand(BaseModel):
    inject_false_bright_objects: Optional[bool] = Field(None, description="Enable false bright objects simulation")
    inject: Optional[bool] = Field(None, description="Alias for inject_false_bright_objects")
    false_bright_object_count: Optional[int] = Field(None, ge=1, le=5)
    count: Optional[int] = Field(None, ge=1, le=5, description="Alias for false_bright_object_count")
    reject_false_bright_objects: Optional[bool] = Field(None, description="Enable automatic rejection")


@router.post("/simulation/detection/clutter")
def toggle_clutter_simulation(cmd: ClutterCommand):
    """Toggles injection and rejection of false bright objects (glints/reflections)."""
    cfg = config_manager.get_config()
    is_inject = cmd.inject_false_bright_objects if cmd.inject_false_bright_objects is not None else cmd.inject
    if is_inject is not None:
        cfg.detection.inject_false_bright_objects = is_inject

    num_count = cmd.false_bright_object_count if cmd.false_bright_object_count is not None else cmd.count
    if num_count is not None:
        cfg.detection.false_bright_object_count = num_count

    if cmd.reject_false_bright_objects is not None:
        cfg.detection.reject_false_bright_objects = cmd.reject_false_bright_objects

    config_manager.set_config(cfg)
    sim_engine.update_config(cfg)
    return {
        "status": "clutter_configured",
        "inject_false_bright_objects": cfg.detection.inject_false_bright_objects,
        "false_bright_object_count": cfg.detection.false_bright_object_count,
        "reject_false_bright_objects": cfg.detection.reject_false_bright_objects,
    }


@router.get("/simulation/detection/comparison")
def get_detection_comparison():
    """
    Runs Classical CV and AI Detector side-by-side on the current camera frame
    and returns comparative metrics: detection time, confidence, centroid, bounding box.
    """
    raw_frame = sim_engine.generate_raw_fpa_frame()
    cv_res = sim_engine.detector.classical_detector.detect(raw_frame)
    ai_res = sim_engine.detector.ai_detector.detect(raw_frame)

    return {
        "classical_cv": {
            "active_method": "Classical CV",
            "method": "Classical CV",
            "detection_time_ms": round(cv_res.detection_time_ms, 2),
            "latency_ms": round(cv_res.detection_time_ms, 2),
            "detected": cv_res.beacon_detected,
            "centroid": [cv_res.primary_detection.centroid_x, cv_res.primary_detection.centroid_y] if cv_res.primary_detection else None,
            "bbox": cv_res.primary_detection.bbox if cv_res.primary_detection else None,
            "confidence": cv_res.primary_detection.confidence if cv_res.primary_detection else 0.0,
            "candidate_count": len(cv_res.detections),
            "status": "High precision moment centroid localization",
        },
        "ai_detector": {
            "active_method": ai_res.active_method,
            "method": "AI Detector (YOLO/ONNX)",
            "model_loaded": ai_res.model_loaded,
            "model_status": ai_res.model_status,
            "status": ai_res.model_status,
            "detection_time_ms": round(ai_res.detection_time_ms, 2),
            "latency_ms": round(ai_res.detection_time_ms, 2),
            "detected": ai_res.beacon_detected,
            "centroid": [ai_res.primary_detection.centroid_x, ai_res.primary_detection.centroid_y] if ai_res.primary_detection else None,
            "bbox": ai_res.primary_detection.bbox if ai_res.primary_detection else None,
            "confidence": ai_res.primary_detection.confidence if ai_res.primary_detection else 0.0,
            "candidate_count": len(ai_res.detections),
        },
    }


# ==============================================================================
# Part 5: Kalman Filter, PID Controller & Closed-Loop Tracking Endpoints
# ==============================================================================

class ControlModeCommand(BaseModel):
    mode: Literal["Open Loop", "PID Coarse Pointing", "State Feedback"] = Field(
        ..., description="Gimbal control mode"
    )


@router.post("/simulation/control/mode")
def set_control_mode(cmd: ControlModeCommand):
    """Switches gimbal control mode (Open Loop vs PID Coarse Pointing)."""
    cfg = config_manager.get_config()
    cfg.control.mode = cmd.mode
    config_manager.set_config(cfg)
    sim_engine.controller.update_config(cfg.control)
    return {
        "status": "control_mode_updated",
        "mode": cfg.control.mode,
    }


class PIDConfigCommand(BaseModel):
    kp_pan: Optional[float] = None
    ki_pan: Optional[float] = None
    kd_pan: Optional[float] = None
    kp_tilt: Optional[float] = None
    ki_tilt: Optional[float] = None
    kd_tilt: Optional[float] = None


@router.post("/simulation/control/pid")
def update_pid_parameters(cmd: PIDConfigCommand):
    """Updates 2-Axis PID controller gains for Pan (azimuth) and Tilt (elevation)."""
    cfg = config_manager.get_config()
    if cmd.kp_pan is not None:
        cfg.control.kp_pan = cmd.kp_pan
    if cmd.ki_pan is not None:
        cfg.control.ki_pan = cmd.ki_pan
    if cmd.kd_pan is not None:
        cfg.control.kd_pan = cmd.kd_pan
    if cmd.kp_tilt is not None:
        cfg.control.kp_tilt = cmd.kp_tilt
    if cmd.ki_tilt is not None:
        cfg.control.ki_tilt = cmd.ki_tilt
    if cmd.kd_tilt is not None:
        cfg.control.kd_tilt = cmd.kd_tilt

    config_manager.set_config(cfg)
    sim_engine.controller.update_config(cfg.control)
    return {
        "status": "pid_gains_updated",
        "pan": {
            "kp": cfg.control.kp_pan,
            "ki": cfg.control.ki_pan,
            "kd": cfg.control.kd_pan,
        },
        "tilt": {
            "kp": cfg.control.kp_tilt,
            "ki": cfg.control.ki_tilt,
            "kd": cfg.control.kd_tilt,
        },
    }


class TrackingFilterCommand(BaseModel):
    algorithm: Literal["None", "Kalman Filter", "Alpha-Beta", "Particle Filter"] = Field(
        ..., description="Tracking filter algorithm"
    )


@router.post("/simulation/tracking/filter")
def set_tracking_filter(cmd: TrackingFilterCommand):
    """Configures active tracking filter."""
    cfg = config_manager.get_config()
    cfg.tracking.algorithm = cmd.algorithm
    config_manager.set_config(cfg)
    sim_engine.tracker.update_config(cfg.tracking, cfg.camera)
    return {
        "status": "tracking_filter_updated",
        "algorithm": cfg.tracking.algorithm,
    }


class SearchCommand(BaseModel):
    action: Literal["start", "stop", "reset"] = Field("start", description="Search action")
    search_pattern: Optional[Literal["Raster Search", "Sector Search", "Spiral Search"]] = None


@router.post("/simulation/tracking/search")
def trigger_search_pattern(cmd: SearchCommand):
    """Manages autonomous search pattern execution when beacon is outside FOV."""
    cfg = config_manager.get_config()
    if cmd.search_pattern:
        cfg.tracking.search_pattern = cmd.search_pattern
        config_manager.set_config(cfg)
        sim_engine.tracker.update_config(cfg.tracking, cfg.camera)

    if cmd.action in ["start", "reset"]:
        sim_engine.tracker.state = "SEARCHING"
        sim_engine.tracker.search_generator.reset(sim_engine.camera.pan_deg, sim_engine.camera.tilt_deg)
    elif cmd.action == "stop":
        sim_engine.tracker.search_generator.is_active = False

    return {
        "status": "search_command_processed",
        "action": cmd.action,
        "search_pattern": cfg.tracking.search_pattern,
        "is_active": sim_engine.tracker.search_generator.is_active,
    }


@router.get("/simulation/tracking/telemetry")
def get_tracking_telemetry():
    """Returns detailed instantaneous tracking filter and PAT state machine telemetry."""
    if sim_engine.last_tracking_telemetry:
        return sim_engine.last_tracking_telemetry
    return sim_engine.step(dt=0.0).tracking


# ==============================================================================
# Part 6: Disturbance and Noise Engine Endpoints
# ==============================================================================

class DisturbancePresetCommand(BaseModel):
    preset: Literal[
        "Custom",
        "Normal",
        "High Noise",
        "High Jitter",
        "Haze",
        "Fog",
        "Rain",
        "Low Light",
        "Fast Motion",
        "Combined Disturbance",
    ] = Field(..., description="Preset benchmark scenario name")


@router.post("/simulation/disturbance/preset")
def apply_disturbance_preset(cmd: DisturbancePresetCommand):
    """Applies one-click benchmark evaluation disturbance scenario."""
    cfg = config_manager.get_config()
    sim_engine.disturbance.apply_preset(cmd.preset)
    cfg.disturbance = sim_engine.disturbance.config
    config_manager.set_config(cfg)
    sim_engine.config.disturbance = cfg.disturbance
    return {
        "status": "preset_applied",
        "preset": cmd.preset,
        "config": cfg.disturbance.model_dump(),
    }


class DisturbanceUpdateCommand(BaseModel):
    noise_type: Optional[Literal["None", "Salt & Pepper", "Gaussian", "Poisson", "Multi-Noise"]] = None
    gaussian_noise_enabled: Optional[bool] = None
    salt_pepper_enabled: Optional[bool] = None
    poisson_noise_enabled: Optional[bool] = None
    noise_std_dev: Optional[float] = None
    salt_pepper_ratio: Optional[float] = None

    camera_jitter_enabled: Optional[bool] = None
    camera_jitter_max_px: Optional[float] = None
    camera_jitter_frequency_hz: Optional[float] = None

    atmospheric_condition: Optional[Literal["Clear", "Haze", "Fog", "Rain", "Low Light"]] = None
    atmospheric_extinction_coeff: Optional[float] = None
    fog_density: Optional[float] = None
    rain_rate_mm_hr: Optional[float] = None
    ambient_light_factor: Optional[float] = None

    platform_motion_enabled: Optional[bool] = None
    platform_motion_type: Optional[Literal["Linear", "None", "Sinusoidal", "Circular", "Random", "Spiral", "Figure of 8"]] = None
    platform_motion_max_px: Optional[float] = None
    platform_motion_frequency_hz: Optional[float] = None

    motion_blur_enabled: Optional[bool] = None
    motion_blur_kernel_size: Optional[int] = None
    beacon_flicker_enabled: Optional[bool] = None
    beacon_flicker_frequency_hz: Optional[float] = None
    beacon_flicker_depth: Optional[float] = None
    temporary_occlusion_enabled: Optional[bool] = None
    occlusion_duration_s: Optional[float] = None
    occlusion_period_s: Optional[float] = None
    sudden_camera_movement_enabled: Optional[bool] = None
    sudden_movement_max_px: Optional[float] = None
    brightness_fluctuation_enabled: Optional[bool] = None
    brightness_fluctuation_amplitude: Optional[float] = None
    snr_reduction_db: Optional[float] = None


@router.post("/simulation/disturbance/config")
def update_disturbance_config(cmd: DisturbanceUpdateCommand):
    """Updates fine-grained disturbance and noise engine parameters."""
    cfg = config_manager.get_config()
    cmd_data = cmd.model_dump(exclude_unset=True)
    for k, v in cmd_data.items():
        if hasattr(cfg.disturbance, k):
            setattr(cfg.disturbance, k, v)

    # Auto-populate physical atmospheric parameters when condition changes
    if "atmospheric_condition" in cmd_data and cmd_data["atmospheric_condition"] is not None:
        cond = cmd_data["atmospheric_condition"]
        cfg.disturbance.atmospheric_condition = cond
        if cond == "Clear":
            if "atmospheric_extinction_coeff" not in cmd_data:
                cfg.disturbance.atmospheric_extinction_coeff = 0.05
            if "ambient_light_factor" not in cmd_data:
                cfg.disturbance.ambient_light_factor = 1.0
            if "fog_density" not in cmd_data:
                cfg.disturbance.fog_density = 0.0
            if "rain_rate_mm_hr" not in cmd_data:
                cfg.disturbance.rain_rate_mm_hr = 0.0
        elif cond == "Haze":
            if "atmospheric_extinction_coeff" not in cmd_data:
                cfg.disturbance.atmospheric_extinction_coeff = 0.45
            if "ambient_light_factor" not in cmd_data:
                cfg.disturbance.ambient_light_factor = 0.95
        elif cond == "Fog":
            if "fog_density" not in cmd_data:
                cfg.disturbance.fog_density = 0.65
            if "atmospheric_extinction_coeff" not in cmd_data:
                cfg.disturbance.atmospheric_extinction_coeff = 1.85
            if "ambient_light_factor" not in cmd_data:
                cfg.disturbance.ambient_light_factor = 0.80
        elif cond == "Rain":
            if "rain_rate_mm_hr" not in cmd_data:
                cfg.disturbance.rain_rate_mm_hr = 35.0
            if "atmospheric_extinction_coeff" not in cmd_data:
                cfg.disturbance.atmospheric_extinction_coeff = 0.85
            if "ambient_light_factor" not in cmd_data:
                cfg.disturbance.ambient_light_factor = 0.70
        elif cond == "Low Light":
            if "ambient_light_factor" not in cmd_data:
                cfg.disturbance.ambient_light_factor = 0.18
            if "atmospheric_extinction_coeff" not in cmd_data:
                cfg.disturbance.atmospheric_extinction_coeff = 0.08

    # Synchronize noise_type and individual noise toggles
    g_active = bool(cfg.disturbance.gaussian_noise_enabled)
    sp_active = bool(cfg.disturbance.salt_pepper_enabled)
    p_active = bool(cfg.disturbance.poisson_noise_enabled)
    active_count = sum([g_active, sp_active, p_active])

    if "noise_type" in cmd_data and cmd_data["noise_type"] is not None:
        nt = cmd_data["noise_type"]
        if nt == "Multi-Noise":
            cfg.disturbance.gaussian_noise_enabled = True
            cfg.disturbance.salt_pepper_enabled = True
            cfg.disturbance.poisson_noise_enabled = True
        elif nt == "Gaussian":
            cfg.disturbance.gaussian_noise_enabled = True
            cfg.disturbance.salt_pepper_enabled = False
            cfg.disturbance.poisson_noise_enabled = False
        elif nt == "Salt & Pepper":
            cfg.disturbance.gaussian_noise_enabled = False
            cfg.disturbance.salt_pepper_enabled = True
            cfg.disturbance.poisson_noise_enabled = False
        elif nt == "Poisson":
            cfg.disturbance.gaussian_noise_enabled = False
            cfg.disturbance.salt_pepper_enabled = False
            cfg.disturbance.poisson_noise_enabled = True
        elif nt == "None":
            cfg.disturbance.gaussian_noise_enabled = False
            cfg.disturbance.salt_pepper_enabled = False
            cfg.disturbance.poisson_noise_enabled = False
    else:
        if active_count > 1:
            cfg.disturbance.noise_type = "Multi-Noise"
        elif g_active:
            cfg.disturbance.noise_type = "Gaussian"
        elif sp_active:
            cfg.disturbance.noise_type = "Salt & Pepper"
        elif p_active:
            cfg.disturbance.noise_type = "Poisson"
        elif active_count == 0 and cfg.disturbance.noise_type in ["Gaussian", "Salt & Pepper", "Poisson", "Multi-Noise"]:
            cfg.disturbance.noise_type = "None"

    config_manager.set_config(cfg)
    sim_engine.disturbance.update_config(cfg.disturbance, cfg.camera)
    sim_engine.config.disturbance = cfg.disturbance
    return {
        "status": "disturbance_config_updated",
        "disturbance": cfg.disturbance.model_dump(),
    }


class OcclusionCommand(BaseModel):
    duration_s: Optional[float] = Field(None, ge=0.1, le=10.0, description="Occlusion duration in seconds")


@router.post("/simulation/disturbance/occlusion")
def trigger_optical_occlusion(cmd: Optional[OcclusionCommand] = None):
    """Triggers an instantaneous temporary line-of-sight occlusion."""
    dur = cmd.duration_s if cmd and cmd.duration_s else None
    sim_engine.disturbance.trigger_temporary_occlusion(dur)
    return {
        "status": "occlusion_triggered",
        "duration_s": dur or sim_engine.disturbance.config.occlusion_duration_s,
        "is_occluded": sim_engine.disturbance.is_occluded,
    }


@router.get("/simulation/disturbance/telemetry")
def get_disturbance_telemetry():
    """Returns instantaneous physical disturbance telemetry."""
    if hasattr(sim_engine, "last_disturbance_telemetry"):
        return sim_engine.last_disturbance_telemetry
    return {
        "preset_scenario": sim_engine.config.disturbance.preset_scenario,
        "atmospheric_condition": sim_engine.config.disturbance.atmospheric_condition,
        "is_occluded": False,
    }


# ==============================================================================
# PART 7: MP4 VIDEO BENCHMARK MODE ENDPOINTS (PTZ BYPASS)
# ==============================================================================

import os
import time
import shutil
from backend.app.benchmark import benchmark_engine, SyntheticBenchmarkGenerator
from backend.app.models.benchmark_model import (
    VideoMetadata,
    FrameBenchmarkLog,
    BenchmarkResults,
    VideoPlaybackState,
)


class BenchmarkControlCommand(BaseModel):
    action: Literal["play", "pause", "stop", "step_forward", "step_backward", "seek", "set_speed"]
    frame_idx: Optional[int] = None
    speed: Optional[float] = None


class BenchmarkMethodCommand(BaseModel):
    method: Literal["Classical CV", "AI Detector", "CV + Kalman", "AI + Kalman"]


class SyntheticScenarioCommand(BaseModel):
    scenario: Literal[
        "Straight Line Traverse",
        "Circular Orbit",
        "Figure of 8",
        "Occlusion Test",
    ] = Field(..., description="Synthetic scenario to render")
    duration_s: Optional[float] = Field(10.0, ge=1.0, le=60.0, description="Video duration in seconds")


class ProcessVideoCommand(BaseModel):
    max_frames: Optional[int] = Field(None, ge=1, description="Max frames to process (None for entire video)")


@router.post("/benchmark/upload")
async def upload_benchmark_video(file: UploadFile = File(...)):
    """
    Accepts MP4 video upload via drag & drop or file picker.
    Validates MP4 codec/headers, saves to disk, and decodes metadata.
    """
    if not file.filename.lower().endswith(".mp4"):
        raise HTTPException(status_code=400, detail="Only MP4 video files are supported (.mp4)")

    upload_dir = "benchmark_videos"
    os.makedirs(upload_dir, exist_ok=True)
    clean_name = os.path.basename(file.filename)
    dest_path = os.path.join(upload_dir, clean_name)

    # Save uploaded file contents
    with open(dest_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    try:
        metadata = benchmark_engine.load_video(dest_path, original_filename=clean_name)
    except Exception as e:
        if os.path.exists(dest_path):
            os.remove(dest_path)
        raise HTTPException(status_code=400, detail=f"Invalid or unreadable MP4 video: {str(e)}")

    return {
        "status": "video_loaded",
        "metadata": metadata.model_dump(),
    }


@router.post("/benchmark/synthetic")
def generate_synthetic_benchmark(cmd: SyntheticScenarioCommand):
    """
    Renders an official 30 FPS MP4 benchmark flight sequence with exact mathematical ground truth.
    Instantly loads it into the benchmark pipeline for one-click evaluation.
    """
    upload_dir = "benchmark_videos"
    mp4_path, csv_path, json_path, gt_points = SyntheticBenchmarkGenerator.generate_benchmark_video(
        scenario_name=cmd.scenario,
        output_dir=upload_dir,
        width=640,
        height=480,
        fps=30.0,
        duration_s=cmd.duration_s or 10.0,
    )

    metadata = benchmark_engine.load_video(mp4_path, original_filename=os.path.basename(mp4_path))
    gt_count = benchmark_engine.load_ground_truth_json(json_path)

    return {
        "status": "synthetic_benchmark_ready",
        "scenario": cmd.scenario,
        "metadata": metadata.model_dump(),
        "ground_truth_points": gt_count,
    }


@router.post("/benchmark/groundtruth")
async def upload_ground_truth(file: UploadFile = File(...)):
    """
    Uploads reference trajectory data (CSV or JSON) to evaluate detection errors.
    """
    fn = file.filename.lower()
    upload_dir = "benchmark_videos"
    os.makedirs(upload_dir, exist_ok=True)
    temp_path = os.path.join(upload_dir, f"gt_{os.path.basename(file.filename)}")

    with open(temp_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    try:
        if fn.endswith(".csv"):
            pts = benchmark_engine.load_ground_truth_csv(temp_path)
        elif fn.endswith(".json"):
            pts = benchmark_engine.load_ground_truth_json(temp_path)
        else:
            raise ValueError("Unsupported ground-truth format. Provide .csv or .json")
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)

    return {
        "status": "ground_truth_loaded",
        "points_count": pts,
    }


@router.post("/benchmark/method")
def set_benchmark_detector_method(cmd: BenchmarkMethodCommand):
    """Switches active detector algorithm for video benchmark."""
    benchmark_engine.set_detection_method(cmd.method)
    return {
        "status": "method_updated",
        "method": cmd.method,
    }


@router.post("/benchmark/control")
def control_benchmark_playback(cmd: BenchmarkControlCommand):
    """
    Handles video controls: play, pause, stop, step_forward, step_backward, seek, set_speed.
    """
    action = cmd.action

    if action == "seek" and cmd.frame_idx is not None:
        benchmark_engine.seek(cmd.frame_idx)
    elif action == "step_forward":
        benchmark_engine.step_forward()
    elif action == "step_backward":
        benchmark_engine.step_backward()
    elif action == "stop":
        benchmark_engine.is_playing = False
        benchmark_engine.seek(0)
    elif action == "play":
        benchmark_engine.is_playing = True
    elif action == "pause":
        benchmark_engine.is_playing = False
    elif action == "set_speed" and cmd.speed is not None:
        benchmark_engine.playback_speed = cmd.speed

    curr_log = benchmark_engine.frame_logs.get(benchmark_engine.current_frame_idx)
    return {
        "status": "control_applied",
        "action": action,
        "state": benchmark_engine.get_playback_state().model_dump(),
        "frame_log": curr_log.model_dump() if curr_log else None,
    }


@router.post("/benchmark/process")
def process_entire_benchmark_video(cmd: Optional[ProcessVideoCommand] = None):
    """
    Runs batch benchmark evaluation from start to finish at maximum computation speed.
    Returns complete benchmark results summary.
    """
    max_frames = cmd.max_frames if cmd else None
    results = benchmark_engine.process_entire_video(max_frames=max_frames)
    return {
        "status": "processing_complete",
        "results": results.model_dump(),
    }


@router.post("/benchmark/cancel")
def cancel_benchmark_processing():
    """Cancels running batch benchmark evaluation."""
    benchmark_engine.cancel_batch()
    return {"status": "cancelled"}


@router.get("/benchmark/state")
def get_benchmark_state():
    """Returns current playback state, video metadata, and progress."""
    return {
        "metadata": benchmark_engine.metadata.model_dump() if benchmark_engine.metadata else None,
        "state": benchmark_engine.get_playback_state().model_dump(),
        "ground_truth_loaded": len(benchmark_engine.ground_truth) > 0,
        "ground_truth_points": len(benchmark_engine.ground_truth),
    }


@router.get("/benchmark/frame/image")
def get_benchmark_frame_image(annotated: bool = True):
    """
    Returns the current video frame as a JPEG image for direct UI display.
    """
    import cv2
    frame = benchmark_engine.current_annotated_frame if annotated else benchmark_engine.current_raw_frame
    if frame is None:
        # Create empty placeholder frame
        frame = np.zeros((480, 640, 3), dtype=np.uint8)
        cv2.putText(frame, "NO VIDEO LOADED", (220, 240), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (120, 120, 120), 2)

    success, buffer = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
    if not success:
        raise HTTPException(status_code=500, detail="Failed to encode frame")

    return Response(
        content=buffer.tobytes(),
        media_type="image/jpeg",
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
    )


@router.get("/benchmark/frame/telemetry")
def get_benchmark_frame_telemetry():
    """Returns current frame benchmark telemetry log."""
    curr_log = benchmark_engine.frame_logs.get(benchmark_engine.current_frame_idx)
    return {
        "frame_idx": benchmark_engine.current_frame_idx,
        "log": curr_log.model_dump() if curr_log else None,
        "has_ground_truth": benchmark_engine.current_frame_idx in benchmark_engine.ground_truth,
    }


@router.get("/benchmark/results")
def get_benchmark_results():
    """Returns official benchmark results metrics and statistics."""
    results = benchmark_engine.compute_benchmark_results()
    return results.model_dump()


@router.get("/benchmark/export/csv")
def export_benchmark_csv():
    """Downloads frame-by-frame centroid telemetry log as CSV."""
    csv_str = benchmark_engine.export_csv()
    filename = f"benchmark_log_{int(time.time())}.csv"
    return Response(
        content=csv_str,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.get("/benchmark/export/json")
def export_benchmark_json():
    """Downloads full structured benchmark dataset and logs as JSON."""
    data = benchmark_engine.export_json()
    return data


@router.get("/benchmark/export/report")
def export_benchmark_report():
    """Generates official evaluation report in Markdown format."""
    md_report = benchmark_engine.export_summary_markdown()
    return Response(
        content=md_report,
        media_type="text/markdown",
        headers={"Content-Disposition": "attachment; filename=benchmark_report.md"},
    )


# ==============================================================================
# Part 8: Real-Time Analytics, Performance Evaluation & Official Requirements
# ==============================================================================

from backend.app.analytics.experiment_engine import ExperimentEngine
from backend.app.models.analytics_model import (
    AnalyticsSummaryResponse,
    ChartSeriesResponse,
    OfficialRequirementStatus,
    ExperimentRecord,
    AlgorithmComparisonResponse,
)

experiment_engine = ExperimentEngine()


@router.get("/analytics/summary")
def get_analytics_summary():
    """
    Returns live performance evaluation metrics and Problem Statement 4
    official requirements compliance status. Never hard-coded.
    """
    return sim_engine.analytics.get_summary_response().model_dump()


@router.get("/analytics/requirements")
def get_official_requirements_status() -> List[Dict[str, Any]]:
    """
    Returns evaluated status (PASS/FAIL) for all 5 official criteria:
    - Acquisition <= 2.0s
    - Tracking Error <= 10.0px
    - Target Loss < 5.0%
    - Re-acquisition <= 1.0s
    - Processing Speed >= 20.0 FPS
    """
    reqs = sim_engine.analytics.evaluate_official_requirements()
    return [r.model_dump() for r in reqs]


@router.get("/analytics/charts")
def get_realtime_chart_series(window: Optional[int] = None) -> List[Dict[str, Any]]:
    """
    Returns time-series telemetry data for the 11 real-time charts:
    1. Tracking Error vs Time
    2. Centroid Error vs Time
    3. Angular Error vs Time
    4. Centroid X vs Time
    5. Centroid Y vs Time
    6. Pan vs Time
    7. Tilt vs Time
    8. FPS vs Time
    9. Processing Time vs Time
    10. Confidence vs Time
    11. SNR vs Time
    """
    points = sim_engine.analytics.get_time_series(window)
    return [p.model_dump() for p in points]


@router.post("/analytics/reset")
def reset_analytics_metrics():
    """Resets all metrics accumulation counters and histories."""
    sim_engine.analytics.reset()
    return {"status": "analytics_reset"}


class CreateExperimentRequest(BaseModel):
    name: str = Field(..., description="Experiment title / scenario name")
    algorithm: Literal["Basic CV", "CV + Kalman", "CV + PID", "AI", "AI + Kalman", "AI + Kalman + PID"] = "CV + PID"
    target_motion: Literal[
        "Straight Line", "Circular", "Figure of 8", "Random", "Spiral", "Sinusoidal"
    ] = "Straight Line"
    noise_type: Literal["None", "Salt & Pepper", "Gaussian", "Poisson", "Multi-Noise"] = "None"
    noise_level_sigma: float = Field(0.0, ge=0.0, le=20.0)
    atmosphere: Literal["Clear", "Haze", "Fog", "Rain", "Low Light"] = "Clear"
    pid_kp: float = Field(0.25, ge=0.0, le=2.0)
    pid_ki: float = Field(0.02, ge=0.0, le=1.0)
    pid_kd: float = Field(0.05, ge=0.0, le=1.0)
    kalman_enabled: bool = True
    duration_s: float = Field(3.0, ge=1.0, le=60.0)


@router.post("/experiments/run")
def run_custom_experiment(cmd: CreateExperimentRequest):
    """
    Runs an experimental trial with user-specified configuration,
    measures actual performance, validates against official requirements,
    and archives the experimental trial.
    """
    import copy
    import uuid
    from datetime import datetime
    from backend.app.simulation.engine import SimulationEngine

    base_cfg = config_manager.get_config()
    cfg = copy.deepcopy(base_cfg)

    # Configure trial parameters
    cfg.motion.trajectory_type = cmd.target_motion  # type: ignore
    cfg.disturbance.atmospheric_condition = cmd.atmosphere  # type: ignore
    cfg.disturbance.noise_std_dev = cmd.noise_level_sigma
    if cmd.noise_type == "None":
        cfg.disturbance.noise_type = "None"
    elif cmd.noise_type == "Gaussian":
        cfg.disturbance.noise_type = "Gaussian"
        cfg.disturbance.gaussian_noise_enabled = True
    elif cmd.noise_type == "Salt & Pepper":
        cfg.disturbance.noise_type = "Salt & Pepper"
        cfg.disturbance.salt_pepper_enabled = True
    elif cmd.noise_type == "Poisson":
        cfg.disturbance.noise_type = "Poisson"
        cfg.disturbance.poisson_noise_enabled = True
    else:
        cfg.disturbance.noise_type = "Multi-Noise"
        cfg.disturbance.gaussian_noise_enabled = True
        cfg.disturbance.salt_pepper_enabled = True

    cfg.control.kp_pan = cmd.pid_kp
    cfg.control.ki_pan = cmd.pid_ki
    cfg.control.kd_pan = cmd.pid_kd
    cfg.control.kp_tilt = cmd.pid_kp
    cfg.control.ki_tilt = cmd.pid_ki
    cfg.control.kd_tilt = cmd.pid_kd

    # Map algorithm
    algo_map = {
        "Basic CV": "Classical CV",
        "CV + Kalman": "CV + Kalman",
        "CV + PID": "Classical CV",
        "AI": "AI Detector",
        "AI + Kalman": "AI + Kalman",
        "AI + Kalman + PID": "AI + Kalman",
    }
    method_name = algo_map.get(cmd.algorithm, "Classical CV")
    cfg.detection.method = method_name  # type: ignore
    cfg.detection.algorithm = method_name

    trial_sim = SimulationEngine(cfg)
    trial_sim.detector.set_method(method_name)

    total_frames = int(cmd.duration_s * cfg.camera.update_rate_hz)
    for _ in range(total_frames):
        trial_sim.step(dt=trial_sim.dt)

    metrics = trial_sim.analytics.calculate_metrics()
    reqs = trial_sim.analytics.evaluate_official_requirements()
    overall = "PASS" if all(r.status == "PASS" for r in reqs) else "FAIL"

    exp_id = f"EXP-{datetime.utcnow().strftime('%Y%m%d')}-{str(uuid.uuid4())[:6].upper()}"
    record = ExperimentRecord(
        experiment_id=exp_id,
        timestamp=datetime.utcnow().isoformat() + "Z",
        name=cmd.name,
        algorithm=cmd.algorithm,
        target_motion=cmd.target_motion,
        noise_type=cmd.noise_type,
        noise_level_sigma=cmd.noise_level_sigma,
        atmosphere=cmd.atmosphere,
        pid_kp=cmd.pid_kp,
        pid_ki=cmd.pid_ki,
        pid_kd=cmd.pid_kd,
        kalman_enabled=cmd.kalman_enabled,
        duration_s=cmd.duration_s,
        total_frames=total_frames,
        metrics=metrics,
        requirements=reqs,
        overall_status=overall,
    )

    experiment_engine.save_experiment(record)

    # Part 9: Automatically generate performance report after experiment
    try:
        from backend.app.reports import report_generator
        report_generator.generate_performance_report(
            config=cfg,
            metrics=metrics,
            requirements=reqs,
            time_series=trial_sim.analytics.telemetry_history,
            mode="Simulation Testbench",
            experiment_id=exp_id,
        )
    except Exception as e:
        print(f"[Warning] Failed to generate automatic performance report: {e}")

    return record.model_dump()


@router.get("/experiments/list")
def list_archived_experiments():
    """Lists all saved experimental testbench trials."""
    return [e.model_dump() for e in experiment_engine.list_experiments()]


@router.get("/experiments/{exp_id}")
def get_experiment_details(exp_id: str):
    """Retrieves full details of a specific experimental trial."""
    rec = experiment_engine.get_experiment(exp_id)
    if not rec:
        raise HTTPException(status_code=404, detail=f"Experiment {exp_id} not found")
    return rec.model_dump()


@router.delete("/experiments/{exp_id}")
def delete_archived_experiment(exp_id: str):
    """Deletes an archived experimental record."""
    success = experiment_engine.delete_experiment(exp_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"Experiment {exp_id} not found")
    return {"status": "deleted", "experiment_id": exp_id}


class CompareAlgorithmsRequest(BaseModel):
    scenario_name: str = "Standard Cross-Track Evaluation"
    duration_s: float = Field(3.0, ge=1.0, le=10.0)


@router.post("/experiments/compare")
def compare_all_algorithms(cmd: Optional[CompareAlgorithmsRequest] = None):
    """
    Executes identical scenarios with:
    1. Basic CV
    2. CV + Kalman
    3. CV + PID
    4. AI
    5. AI + Kalman + PID
    Returns strictly objective comparative measurements without subjective rankings.
    """
    scenario = cmd.scenario_name if cmd and cmd.scenario_name else "Standard Cross-Track Evaluation"
    dur = cmd.duration_s if cmd and cmd.duration_s else 3.0

    current_cfg = config_manager.get_config()
    comparison = experiment_engine.run_algorithm_comparison(
        base_config=current_cfg,
        scenario_name=scenario,
        duration_s=dur,
    )
    return comparison.model_dump()


@router.get("/experiments/export/csv")
def export_experiments_csv():
    """Exports archived experimental testbench runs to CSV."""
    csv_str = experiment_engine.export_csv()
    filename = f"experiments_{int(time.time())}.csv"
    return Response(
        content=csv_str,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.get("/experiments/export/json")
def export_experiments_json():
    """Exports archived experimental testbench runs to JSON."""
    return [e.model_dump() for e in experiment_engine.list_experiments()]


# ------------------------------------------------------------------------------
# Part 3: Automated Orbital Scenario Validation Suite (6 Testbench Runs)
# ------------------------------------------------------------------------------

class OrbitalValidationRunRequest(BaseModel):
    duration_s: float = Field(120.0, ge=1.0, le=300.0, description="Duration per test in seconds (120s standard)")


@router.post("/experiments/orbital-validation")
def run_orbital_validation_suite(req: Optional[OrbitalValidationRunRequest] = None):
    """
    Executes the automated 6-scenario Orbital Scenario Validation Suite:
      A. UAV below LEO 550 km (~0.8 deg/s)
      B. LEO to GEO Intersatellite Link (very low rate)
      C. LEO 550 km to LEO 550 km Crossing (~1.7 deg/s)
      D. Close Pass at 100 km (~8.7 deg/s, SLEW_SATURATED & LOCK LOST recovery)
      E. Two LEO 550 km satellites nearly opposite (LINK_BLOCKED, zero tracker failures)
      F. Local Scenario regression (Straight Line and Circular)
    """
    from backend.app.orbital.validation_suite import execute_full_validation_suite
    dur = req.duration_s if req and req.duration_s is not None else 120.0
    report = execute_full_validation_suite(duration_s=dur)
    return report.model_dump()


@router.get("/experiments/orbital-validation")
def get_orbital_validation_report():
    """Retrieves the latest cached Orbital Validation Suite report or runs on demand."""
    from backend.app.orbital.validation_suite import get_latest_validation_report
    report = get_latest_validation_report()
    return report.model_dump()



# ==============================================================================
# PART 9: AUTOMATIC REPORTING, TECHNICAL DOCUMENTATION, USER MANUAL & DEMO MODE
# ==============================================================================

from backend.app.reports import report_generator
from backend.app.demo.demo_orchestrator import demo_orchestrator
from backend.app.models.report_model import DemoStatusResponse


@router.get("/reports/latest")
def get_latest_performance_report():
    """Retrieves the most recent automated experimental performance report."""
    report = report_generator.get_latest_report()
    if not report:
        # If no report exists yet, generate on-demand from current simulation engine analytics
        metrics = sim_engine.analytics.calculate_metrics()
        reqs = sim_engine.analytics.evaluate_official_requirements()
        report = report_generator.generate_performance_report(
            config=sim_engine.config,
            metrics=metrics,
            requirements=reqs,
            time_series=sim_engine.analytics.time_series,
            mode="Simulation Testbench",
        )
    return report.model_dump()


@router.get("/reports/list")
def list_performance_reports():
    """Lists metadata for all archived performance reports."""
    return report_generator.list_reports()


@router.post("/reports/generate")
def generate_report_now():
    """Explicitly triggers automated performance report generation for active testbench."""
    metrics = sim_engine.analytics.calculate_metrics()
    reqs = sim_engine.analytics.evaluate_official_requirements()
    report = report_generator.generate_performance_report(
        config=sim_engine.config,
        metrics=metrics,
        requirements=reqs,
        time_series=sim_engine.analytics.time_series,
        mode="Simulation Testbench",
    )
    return report.model_dump()


@router.get("/reports/export/html")
def export_report_html(report_id: Optional[str] = None):
    """
    Exports a printable HTML report conforming to Problem Statement 4.
    Styled with @media print for 100% native Save-As-PDF in modern web browsers.
    """
    try:
        html_content = report_generator.export_html(report_id)
        return Response(content=html_content, media_type="text/html")
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/reports/export/csv")
def export_report_raw_csv(report_id: Optional[str] = None):
    """
    Exports frame-by-frame raw performance telemetry log as CSV conforming to Part 9.
    Columns: Frame, Timestamp, Centroid X/Y, Ref X/Y (only if ground truth exists),
             Error X/Y, Total Error, Confidence, Status, State, Pan, Tilt, FPS, Processing time.
    """
    try:
        csv_content = report_generator.export_csv(report_id)
        fn = f"report_raw_log_{report_id or 'latest'}.csv"
        return Response(
            content=csv_content,
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename={fn}"},
        )
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/reports/export/json")
def export_report_json(report_id: Optional[str] = None):
    """Exports full structured performance report as JSON."""
    try:
        json_content = report_generator.export_json(report_id)
        fn = f"report_{report_id or 'latest'}.json"
        return Response(
            content=json_content,
            media_type="application/json",
            headers={"Content-Disposition": f"attachment; filename={fn}"},
        )
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/reports/technical")
def get_technical_report():
    """
    Returns the comprehensive 23-section integrated technical report
    covering system engineering, mathematics, computer vision, AI, and verification results.
    """
    return report_generator.get_technical_report()


@router.get("/reports/user-manual")
def get_user_manual():
    """
    Returns the comprehensive 14-chapter system operations manual.
    """
    return report_generator.get_user_manual()


@router.get("/reports/{report_id}")
def get_performance_report_by_id(report_id: str):
    """Retrieves an archived performance report by its unique ID."""
    report = report_generator.get_report(report_id)
    if not report:
        raise HTTPException(status_code=404, detail=f"Report {report_id} not found")
    return report.model_dump()


class StartDemoRequest(BaseModel):
    step_duration_s: float = Field(12.0, ge=0.1, le=60.0, description="Duration per demonstration phase in seconds")


@router.post("/demo/start")
def start_simulation_demo(cmd: Optional[StartDemoRequest] = None):
    """
    START DEMO:
    Initiates 14-phase automated demonstration sequence:
    1. Loads config -> 2. Starts sim -> 3. Moves target -> 4. Searches -> 5. Detects ->
    6. Acquires -> 7. Tracks -> 8. Locks -> 9. Adds disturbance -> 10. Changes target direction ->
    11. Causes target loss -> 12. Reacquires -> 13. Shows performance -> 14. Generates report.
    """
    step_dur = cmd.step_duration_s if cmd and cmd.step_duration_s else 12.0
    started = demo_orchestrator.start_simulation_demo(step_duration_s=step_dur)
    if not started:
        raise HTTPException(status_code=409, detail="A demonstration is already in progress.")
    return {"status": "started", "demo_type": "SIMULATION_DEMO", "step_duration_s": step_dur}


@router.post("/demo/video/start")
def start_video_demo(cmd: Optional[StartDemoRequest] = None):
    """
    START VIDEO DEMO:
    Initiates 7-phase automated MP4 video benchmark demonstration sequence:
    1. Load sample video -> 2. Process frames -> 3. Detect beacon -> 4. Calculate centroid ->
    5. Show tracking -> 6. Generate metrics -> 7. Generate report.
    """
    step_dur = cmd.step_duration_s if cmd and cmd.step_duration_s else 4.0
    started = demo_orchestrator.start_video_demo(step_duration_s=step_dur)
    if not started:
        raise HTTPException(status_code=409, detail="A demonstration is already in progress.")
    return {"status": "started", "demo_type": "VIDEO_DEMO", "step_duration_s": step_dur}


@router.get("/demo/status", response_model=DemoStatusResponse)
def get_demo_status():
    """Returns real-time execution status of the active demonstration."""
    return demo_orchestrator.get_status()


@router.post("/demo/stop")
def stop_demo():
    """Halts any active demonstration immediately."""
    demo_orchestrator.stop_demo()
    return {"status": "stopped"}


# ─────────────────────────────────────────────────────────────────────────────
# Orbital Scenario Layer Endpoints (Part 1 & Part 2)
# ─────────────────────────────────────────────────────────────────────────────

from backend.app.orbital.scenario import (
    OrbitalScenarioConfig,
    SatelliteConfig,
    UAVConfig,
)
from backend.app.orbital.link_geometry import LinkConfig


class SatelliteConfigModel(BaseModel):
    preset: str = Field(default="LEO-550")
    altitude_km: Optional[float] = Field(default=None)
    inclination_deg: float = Field(default=53.0)
    phase_deg: float = Field(default=0.0)
    raan_deg: float = Field(default=0.0)


class UAVConfigModel(BaseModel):
    lat_deg: float = Field(default=28.6)
    lon_deg: float = Field(default=77.2)
    altitude_km: float = Field(default=10.0)
    pattern: str = Field(default="Circular")
    radius_km: float = Field(default=50.0)
    speed_km_s: float = Field(default=0.25)
    phase_deg: float = Field(default=0.0)


class OrbitalConfigRequest(BaseModel):
    camera_type: Literal["UAV", "SATELLITE"] = "SATELLITE"
    beacon_type: Literal["UAV", "SATELLITE"] = "UAV"
    camera_sat: SatelliteConfigModel = Field(default_factory=SatelliteConfigModel)
    camera_uav: UAVConfigModel = Field(default_factory=UAVConfigModel)
    beacon_sat: SatelliteConfigModel = Field(default_factory=lambda: SatelliteConfigModel(phase_deg=180.0))
    beacon_uav: UAVConfigModel = Field(default_factory=lambda: UAVConfigModel(altitude_km=10.0))
    atmosphere_margin_km: float = Field(default=100.0)
    tilt_limit_deg: float = Field(default=30.0)


class TimeWarpCommand(BaseModel):
    time_warp: float = Field(..., ge=1.0, le=60.0)


_current_orbital_config = OrbitalScenarioConfig()


@router.get("/orbital/config")
def get_orbital_configuration():
    """Returns active orbital scenario configuration."""
    return {
        "camera_type": _current_orbital_config.camera_type,
        "beacon_type": _current_orbital_config.beacon_type,
        "camera_sat": {
            "preset": _current_orbital_config.camera_sat.preset,
            "altitude_km": _current_orbital_config.camera_sat.altitude_km,
            "inclination_deg": _current_orbital_config.camera_sat.inclination_deg,
            "phase_deg": _current_orbital_config.camera_sat.phase_deg,
            "raan_deg": _current_orbital_config.camera_sat.raan_deg,
        },
        "camera_uav": {
            "lat_deg": _current_orbital_config.camera_uav.lat_deg,
            "lon_deg": _current_orbital_config.camera_uav.lon_deg,
            "altitude_km": _current_orbital_config.camera_uav.altitude_km,
            "pattern": _current_orbital_config.camera_uav.pattern,
            "radius_km": _current_orbital_config.camera_uav.radius_km,
            "speed_km_s": _current_orbital_config.camera_uav.speed_km_s,
            "phase_deg": _current_orbital_config.camera_uav.phase_deg,
        },
        "beacon_sat": {
            "preset": _current_orbital_config.beacon_sat.preset,
            "altitude_km": _current_orbital_config.beacon_sat.altitude_km,
            "inclination_deg": _current_orbital_config.beacon_sat.inclination_deg,
            "phase_deg": _current_orbital_config.beacon_sat.phase_deg,
            "raan_deg": _current_orbital_config.beacon_sat.raan_deg,
        },
        "beacon_uav": {
            "lat_deg": _current_orbital_config.beacon_uav.lat_deg,
            "lon_deg": _current_orbital_config.beacon_uav.lon_deg,
            "altitude_km": _current_orbital_config.beacon_uav.altitude_km,
            "pattern": _current_orbital_config.beacon_uav.pattern,
            "radius_km": _current_orbital_config.beacon_uav.radius_km,
            "speed_km_s": _current_orbital_config.beacon_uav.speed_km_s,
            "phase_deg": _current_orbital_config.beacon_uav.phase_deg,
        },
        "atmosphere_margin_km": _current_orbital_config.link.atmosphere_margin_km,
    }


@router.post("/orbital/config")
def update_orbital_configuration(req: OrbitalConfigRequest):
    """
    Updates orbital scenario configuration with strict altitude gap validation.
    Switching presets re-initialises scenario and returns the Part 1 maneuver note.
    """
    global _current_orbital_config

    # Validate 20-300 km altitude gap
    if req.camera_type == "SATELLITE" and req.camera_sat.altitude_km is not None:
        alt = req.camera_sat.altitude_km
        if 20.0 < alt < 300.0:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid satellite altitude ({alt} km): 20 km to 300 km is an unstable physical gap. UAV max is 20 km, satellite orbit min is 300 km.",
            )

    if req.beacon_type == "SATELLITE" and req.beacon_sat.altitude_km is not None:
        alt = req.beacon_sat.altitude_km
        if 20.0 < alt < 300.0:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid satellite altitude ({alt} km): 20 km to 300 km is an unstable physical gap. UAV max is 20 km, satellite orbit min is 300 km.",
            )

    if req.camera_type == "UAV":
        if req.camera_uav.altitude_km > 20.0 or req.camera_uav.altitude_km < 0.0:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid UAV altitude ({req.camera_uav.altitude_km} km): UAV altitude must be between 0 km and 20 km.",
            )

    if req.beacon_type == "UAV":
        if req.beacon_uav.altitude_km > 20.0 or req.beacon_uav.altitude_km < 0.0:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid UAV altitude ({req.beacon_uav.altitude_km} km): UAV altitude must be between 0 km and 20 km.",
            )

    # Build OrbitalScenarioConfig
    cam_sat = SatelliteConfig(
        preset=req.camera_sat.preset,
        altitude_km=req.camera_sat.altitude_km,
        inclination_deg=req.camera_sat.inclination_deg,
        phase_deg=req.camera_sat.phase_deg,
        raan_deg=req.camera_sat.raan_deg,
    )
    cam_uav = UAVConfig(
        lat_deg=req.camera_uav.lat_deg,
        lon_deg=req.camera_uav.lon_deg,
        altitude_km=req.camera_uav.altitude_km,
        pattern=req.camera_uav.pattern,
        radius_km=req.camera_uav.radius_km,
        speed_km_s=req.camera_uav.speed_km_s,
        phase_deg=req.camera_uav.phase_deg,
    )
    bea_sat = SatelliteConfig(
        preset=req.beacon_sat.preset,
        altitude_km=req.beacon_sat.altitude_km,
        inclination_deg=req.beacon_sat.inclination_deg,
        phase_deg=req.beacon_sat.phase_deg,
        raan_deg=req.beacon_sat.raan_deg,
    )
    bea_uav = UAVConfig(
        lat_deg=req.beacon_uav.lat_deg,
        lon_deg=req.beacon_uav.lon_deg,
        altitude_km=req.beacon_uav.altitude_km,
        pattern=req.beacon_uav.pattern,
        radius_km=req.beacon_uav.radius_km,
        speed_km_s=req.beacon_uav.speed_km_s,
        phase_deg=req.beacon_uav.phase_deg,
    )
    link_cfg = LinkConfig(atmosphere_margin_km=req.atmosphere_margin_km)

    new_cfg = OrbitalScenarioConfig(
        camera_type=req.camera_type,
        beacon_type=req.beacon_type,
        camera_sat=cam_sat,
        camera_uav=cam_uav,
        beacon_sat=bea_sat,
        beacon_uav=bea_uav,
        link=link_cfg,
    )

    _current_orbital_config = new_cfg
    telem = sim_engine.update_orbital_config(new_cfg)

    # Update camera tilt limits if specified
    sim_engine.camera.tilt_min = -req.tilt_limit_deg
    sim_engine.camera.tilt_max = req.tilt_limit_deg

    return {
        "status": "reinitialized",
        "maneuver_note": (
            "Note: Orbit switching re-initializes the scenario parameters; it is not a live maneuver. "
            "A real LEO-550 → GEO transfer requires ~3.8 km/s delta-v and ~5.3 h. "
            "This simulation re-initializes to the selected orbit."
        ),
        "telemetry": telem,
    }


@router.post("/orbital/reset")
def reset_orbital_scenario():
    """Resets the orbital scenario to initial orbit positions."""
    telem = sim_engine.reset_orbital()
    return {"status": "reset", "telemetry": telem}


@router.get("/orbital/telemetry")
def get_orbital_telemetry():
    """Returns latest computed orbital telemetry."""
    if sim_engine.last_orbital_telemetry is None:
        sim_engine.last_orbital_telemetry = sim_engine.orbital_scenario.step(0.0).to_dict()
    return sim_engine.last_orbital_telemetry


@router.post("/orbital/time-warp")
def set_time_warp(cmd: TimeWarpCommand):
    """
    Sets preview time-warp factor (1x, 10x, 60x).
    Disallowed and rejected when tracking simulation is actively running.
    """
    if sim_engine.is_running:
        raise HTTPException(
            status_code=400,
            detail="Time-warp locked to 1x during active tracking: at 60x a 0.82 deg/s beacon appears at ~49 deg/s, beyond any realistic gimbal.",
        )
    sim_engine.set_orbital_time_warp(cmd.time_warp)
    return {
        "status": "time_warp_updated",
        "time_warp": cmd.time_warp,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Satellite handover endpoints
# ─────────────────────────────────────────────────────────────────────────────

class HandoverConfigRequest(BaseModel):
    enable:               bool  = True
    min_elevation_deg:    float = 5.0
    lead_time_s:          float = 30.0
    phase_offset_deg:     float = 20.0
    gimbal_pan_limit_deg: float = 60.0
    gimbal_tilt_limit_deg:float = 60.0
    backup_acquire_steps: int   = 3


@router.post("/orbital/handover/config")
def configure_handover(cmd: HandoverConfigRequest):
    """
    Enables automatic satellite handover in Orbital scenario mode.
    Rebuilds the OrbitalScenario with a backup satellite offset by
    phase_offset_deg along the same orbit.

    Must be called while the simulation is stopped (or will auto-stop).
    """
    from backend.app.orbital.scenario import OrbitalScenarioConfig
    from backend.app.orbital.handover import HandoverConfig
    from backend.app.orbital.link_geometry import LinkConfig

    was_running = sim_engine.is_running
    sim_engine.stop()

    ho_cfg = HandoverConfig(
        min_elevation_deg    = cmd.min_elevation_deg,
        lead_time_s          = cmd.lead_time_s,
        phase_offset_deg     = cmd.phase_offset_deg,
        gimbal_pan_limit_deg = cmd.gimbal_pan_limit_deg,
        gimbal_tilt_limit_deg= cmd.gimbal_tilt_limit_deg,
        backup_acquire_steps = cmd.backup_acquire_steps,
    )

    # Inherit current orbital config if already in Orbital mode
    current_orb = sim_engine.last_orbital_telemetry or {}
    cam_orbit   = current_orb.get("camera_orbit") or {}
    alt_km      = float(cam_orbit.get("altitude_km", 550.0))
    inc_deg     = float(cam_orbit.get("inclination_deg", 53.0))
    raan_deg    = float(cam_orbit.get("raan_deg", 0.0))
    preset      = "LEO-550"

    from backend.app.orbital.scenario import SatelliteConfig, UAVConfig
    new_cfg = OrbitalScenarioConfig(
        camera_type     = "SATELLITE",
        beacon_type     = "UAV",
        camera_sat      = SatelliteConfig(
            preset          = preset,
            altitude_km     = alt_km,
            inclination_deg = inc_deg,
            phase_deg       = 0.0,
            raan_deg        = raan_deg,
        ),
        beacon_uav      = UAVConfig(altitude_km=0.0),
        enable_handover = cmd.enable,
        handover_config = ho_cfg,
    )
    sim_engine.update_orbital_config(new_cfg)
    sim_engine.scenario_mode = "Orbital"
    if was_running:
        sim_engine.start()

    return {
        "status":            "handover_configured",
        "enable":            cmd.enable,
        "phase_offset_deg":  cmd.phase_offset_deg,
        "lead_time_s":       cmd.lead_time_s,
        "min_elevation_deg": cmd.min_elevation_deg,
    }


@router.get("/orbital/handover/metrics")
def get_handover_metrics():
    """Returns cumulative handover performance log."""
    mgr = sim_engine.orbital_scenario.handover_manager
    if mgr is None:
        return {"error": "Handover not enabled", "metrics": None}
    m = mgr.metrics
    return {
        "handover_count":           m.handover_count,
        "successful_handovers":     m.successful_handovers,
        "failed_handovers":         m.failed_handovers,
        "no_coverage_events":       m.no_coverage_events,
        "total_no_coverage_s":      round(m.total_no_coverage_s, 2),
        "mean_acquisition_time_s":  round(m.mean_acquisition_time_s, 3) if m.mean_acquisition_time_s is not None else None,
        "events": [
            {
                "sim_time_s":         ev.sim_time_s,
                "from_sat":           ev.from_sat,
                "to_sat":             ev.to_sat,
                "succeeded":          ev.succeeded,
                "acquisition_time_s": ev.acquisition_time_s,
                "reason":             ev.reason,
            }
            for ev in m.events
        ],
    }
