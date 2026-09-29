from typing import Optional, Literal, List, Tuple
from pydantic import BaseModel, Field


class DetectionCandidateTelemetry(BaseModel):
    candidate_id: int = Field(..., description="Candidate index")
    bbox: List[int] = Field(..., description="Bounding box [x, y, w, h]")
    centroid_x: float = Field(..., description="Contour centroid X using moments M10/M00")
    centroid_y: float = Field(..., description="Contour centroid Y using moments M01/M00")
    area: float = Field(..., description="Contour area M00")
    brightness: float = Field(..., description="Peak pixel brightness (0-255)")
    confidence: float = Field(..., description="Confidence score (0.0 - 1.0)")
    snr_db: float = Field(..., description="Local signal-to-noise ratio in dB")
    is_primary: bool = Field(False, description="True if designated primary beacon")
    classification: str = Field(
        "Primary Target",
        description="Target classification: Primary Target | Secondary Target | False Bright Object (Clutter)",
    )
    spatial_distance_to_track: Optional[float] = Field(None, description="Euclidean distance from predicted track (px)")
    temporal_consistency_score: float = Field(1.0, description="Temporal persistence score across consecutive frames (0-1)")


class DetectionTelemetry(BaseModel):
    beacon_detected: bool = Field(False, description="True if a valid beacon contour was resolved from frame")
    detected_centroid_x: Optional[float] = Field(None, description="Measured beacon centroid X on sensor")
    detected_centroid_y: Optional[float] = Field(None, description="Measured beacon centroid Y on sensor")
    bbox: Optional[List[int]] = Field(None, description="Beacon bounding box [x, y, w, h]")
    area: Optional[float] = Field(None, description="Beacon spot pixel area")
    brightness: Optional[float] = Field(None, description="Measured peak brightness")
    confidence: float = Field(0.0, description="Detection confidence score (0-1)")
    pixel_error_x: Optional[float] = Field(None, description="Center error Ex = Bx - 320")
    pixel_error_y: Optional[float] = Field(None, description="Center error Ey = By - 240")
    total_pixel_error: Optional[float] = Field(None, description="Total Euclidean error E = sqrt(Ex² + Ey²)")
    angular_error_x_deg: Optional[float] = Field(None, description="Angular azimuth error θx ≈ Ex * HFOV / W")
    angular_error_y_deg: Optional[float] = Field(None, description="Angular elevation error θy ≈ Ey * VFOV / H")
    snr_db: Optional[float] = Field(None, description="Beacon Signal-to-Noise Ratio in dB")
    processing_time_ms: float = Field(0.0, description="Computer vision execution latency in ms")
    candidate_count: int = Field(0, description="Total bright candidate contours resolved")
    candidates: List[DetectionCandidateTelemetry] = Field(default_factory=list, description="All detected candidates")
    flicker_intensity: float = Field(255.0, description="Current instantaneous modulated beacon intensity")

    # Part 4 AI & Multi-Method Architecture Fields
    active_method: str = Field(
        default="Classical CV",
        description="Active detection method: Classical CV | AI Detector | CV + Kalman | AI + Kalman",
    )
    ai_model_loaded: bool = Field(
        default=False, description="True if verified neural model weights are active; False if in classical fallback"
    )
    ai_model_status: str = Field(
        default="AI-Ready Architecture (Fallback: Classical CV - No trained weights loaded)",
        description="Truthful operational status of the AI detection pipeline",
    )
    kalman_active: bool = Field(default=False, description="True if Kalman state filtering is active")
    kalman_predicted_x: Optional[float] = Field(None, description="Kalman state priori predicted X (px)")
    kalman_predicted_y: Optional[float] = Field(None, description="Kalman state priori predicted Y (px)")
    kalman_velocity_x: Optional[float] = Field(None, description="Kalman filtered beacon pixel velocity Vx (px/s)")
    kalman_velocity_y: Optional[float] = Field(None, description="Kalman filtered beacon pixel velocity Vy (px/s)")
    target_classification: str = Field(
        default="Primary Target", description="Status of target identification & clutter rejection"
    )
    raw_candidate_count: int = Field(0, description="Total raw contours before clutter rejection")
    rejected_clutter_count: int = Field(0, description="Count of rejected false bright objects")


class TargetState(BaseModel):
    target_id: int = Field(1, description="Beacon target identifier")
    world_x: float = Field(..., description="Target X coordinate in 3D world space")
    world_y: float = Field(..., description="Target Y coordinate in 3D world space")
    world_z: float = Field(1000.0, description="Target Z coordinate in 3D world space (optical depth/range)")
    velocity_x: float = Field(0.0, description="Target velocity along X axis (units/s)")
    velocity_y: float = Field(0.0, description="Target velocity along Y axis (units/s)")
    velocity_z: float = Field(0.0, description="Target velocity along Z axis (units/s)")
    acceleration_x: float = Field(0.0, description="Target acceleration along X axis (units/s²)")
    acceleration_y: float = Field(0.0, description="Target acceleration along Y axis (units/s²)")
    acceleration_z: float = Field(0.0, description="Target acceleration along Z axis (units/s²)")
    pixel_x: Optional[float] = Field(None, description="Projected pixel X on 640x480 FPA (0-640)")
    pixel_y: Optional[float] = Field(None, description="Projected pixel Y on 640x480 FPA (0-480)")
    azimuth_cam_deg: Optional[float] = Field(None, description="Target bearing angle in camera frame")
    elevation_cam_deg: Optional[float] = Field(None, description="Target elevation angle in camera frame")
    range_z_cam: Optional[float] = Field(None, description="Target distance in front of optical aperture")
    is_in_fov: bool = Field(False, description="True if target projection falls inside camera FOV (4°x3°)")
    shape: str = Field("Square", description="Beacon geometry (Square, Circle, Gaussian)")
    size_pixels: int = Field(10, description="Beacon spot size in pixels")
    intensity: float = Field(255.0, description="Beacon spot peak intensity (0-255)")
    trajectory_trail: List[Tuple[float, float, float]] = Field(
        default_factory=list, description="Historical 3D world positions for trajectory rendering"
    )


class CameraState(BaseModel):
    pan_deg: float = Field(0.0, description="Current camera azimuth/pan angle in degrees")
    tilt_deg: float = Field(0.0, description="Current camera elevation/tilt angle in degrees")
    target_pan_deg: float = Field(0.0, description="Commanded setpoint pan angle in degrees")
    target_tilt_deg: float = Field(0.0, description="Commanded setpoint tilt angle in degrees")
    pan_rate_deg_s: float = Field(0.0, description="Pan angular velocity")
    tilt_rate_deg_s: float = Field(0.0, description="Tilt angular velocity")
    max_pan_speed_deg_s: float = Field(5.0, description="Max pan slew speed limit (5°/s)")
    max_tilt_speed_deg_s: float = Field(5.0, description="Max tilt slew speed limit (5°/s)")
    pan_min_limit_deg: float = Field(-180.0, description="Gimbal pan minimum limit")
    pan_max_limit_deg: float = Field(180.0, description="Gimbal pan maximum limit")
    tilt_min_limit_deg: float = Field(-85.0, description="Gimbal tilt minimum limit")
    tilt_max_limit_deg: float = Field(85.0, description="Gimbal tilt maximum limit")
    position_x: float = Field(1000.0, description="Camera 3D position X")
    position_y: float = Field(1000.0, description="Camera 3D position Y")
    position_z: float = Field(0.0, description="Camera 3D position Z")
    world_center_x: float = Field(1000.0, description="Boresight intersection X at target depth")
    world_center_y: float = Field(1000.0, description="Boresight intersection Y at target depth")
    world_center_z: float = Field(1000.0, description="Boresight intersection Z")
    fov_horizontal_deg: float = Field(4.0, description="Horizontal FOV")
    fov_vertical_deg: float = Field(3.0, description="Vertical FOV")
    resolution_width: int = Field(640, description="FPA width")
    resolution_height: int = Field(480, description="FPA height")
    update_rate_hz: float = Field(30.0, description="Frame rate")
    frustum_corners_world: List[List[float]] = Field(
        default_factory=list, description="4 corners of the FOV frustum at target depth in 3D"
    )
    adaptive_speed_factor: float = Field(1.0, description="Current adaptive pursuit speed multiplier (1.0 = nominal, up to 4.0 when target is lost)")
    lost_time_s: float = Field(0.0, description="Seconds the target has been continuously lost / searching")
    slew_saturated: bool = Field(False, description="True if commanded rate hit max slew rate limit")
    gimbal_limit: bool = Field(False, description="True if gimbal reached mechanical angle limit stop")


class TrackingTelemetry(BaseModel):
    state: str = Field(
        "SEARCHING",
        description="State Machine: SEARCHING | ACQUIRING | TRACKING | LOCKED | LOST | REACQUIRING | LINK_BLOCKED | NO_COVERAGE",
    )
    mode: str = Field(
        "SEARCHING",
        description="Alias for state for backward compatibility",
    )
    is_link_blocked: bool = Field(False, description="True if line-of-sight is blocked by Earth")
    slew_saturated: bool = Field(False, description="True if commanded rate hit max slew rate limit")
    gimbal_limit: bool = Field(False, description="True if gimbal reached mechanical angle limit stop")
    # Measured, Predicted, Filtered Positions
    measured_x: Optional[float] = Field(None, description="Detector measured beacon centroid X (px)")
    measured_y: Optional[float] = Field(None, description="Detector measured beacon centroid Y (px)")
    predicted_x: Optional[float] = Field(None, description="Kalman prior predicted position X (px)")
    predicted_y: Optional[float] = Field(None, description="Kalman prior predicted position Y (px)")
    filtered_x: Optional[float] = Field(None, description="Kalman posterior filtered position X (px)")
    filtered_y: Optional[float] = Field(None, description="Kalman posterior filtered position Y (px)")
    velocity_x: Optional[float] = Field(None, description="Target pixel velocity Vx (px/s)")
    velocity_y: Optional[float] = Field(None, description="Target pixel velocity Vy (px/s)")

    # Tracking & Angular Error
    error_x_px: Optional[float] = Field(None, description="Horizontal pixel deviation from boresight (320)")
    error_y_px: Optional[float] = Field(None, description="Vertical pixel deviation from boresight (240)")
    total_error_px: Optional[float] = Field(None, description="Euclidean distance to boresight (<=10 px req)")
    error_azimuth_deg: Optional[float] = Field(None, description="Angular azimuth error from boresight (deg)")
    error_elevation_deg: Optional[float] = Field(None, description="Angular elevation error from boresight (deg)")

    # Performance Timers & Loss Metrics
    acquisition_time_s: Optional[float] = Field(None, description="Time elapsed from search to tracking (<=2.0 s req)")
    reacquisition_time_s: Optional[float] = Field(None, description="Time elapsed from loss to tracking (<=1.0 s req)")
    target_lost_count: int = Field(0, description="Total target loss event occurrences")
    lost_frames: int = Field(0, description="Consecutive frames target has been lost")
    loss_duration_s: float = Field(0.0, description="Cumulative time target spent in lost state (s)")
    target_loss_percent: float = Field(0.0, description="Target loss rate (< 5% req)")
    is_locked: bool = Field(False, description="True if coarse alignment lock is confirmed")
    consecutive_locked_frames: int = Field(0, description="Consecutive frames inside lock criteria")

    # PID Controller Breakdown
    pan_pid_p: float = Field(0.0, description="Pan axis proportional term")
    pan_pid_i: float = Field(0.0, description="Pan axis integral term (with anti-windup)")
    pan_pid_d: float = Field(0.0, description="Pan axis derivative term")
    pan_cmd_deg_s: float = Field(0.0, description="Pan axis commanded gimbal rate (deg/s)")
    tilt_pid_p: float = Field(0.0, description="Tilt axis proportional term")
    tilt_pid_i: float = Field(0.0, description="Tilt axis integral term (with anti-windup)")
    tilt_pid_d: float = Field(0.0, description="Tilt axis derivative term")
    tilt_cmd_deg_s: float = Field(0.0, description="Tilt axis commanded gimbal rate (deg/s)")
    search_pattern_name: str = Field("Raster Search", description="Active search scan pattern")


class DisturbanceTelemetry(BaseModel):
    preset_scenario: str = Field("Normal", description="Active test scenario")
    active_preset: str = Field("Normal", description="Active test scenario name")
    jitter_offset_x_px: float = Field(0.0, description="Instantaneous camera jitter X offset")
    jitter_offset_y_px: float = Field(0.0, description="Instantaneous camera jitter Y offset")
    jitter_dx_px: float = Field(0.0, description="Instantaneous camera jitter X offset")
    jitter_dy_px: float = Field(0.0, description="Instantaneous camera jitter Y offset")
    platform_offset_x_px: float = Field(0.0, description="Instantaneous platform motion X offset")
    platform_offset_y_px: float = Field(0.0, description="Instantaneous platform motion Y offset")
    platform_dx_px: float = Field(0.0, description="Instantaneous platform motion X offset")
    platform_dy_px: float = Field(0.0, description="Instantaneous platform motion Y offset")
    atmospheric_condition: str = Field("Clear", description="Atmospheric condition")
    atmospheric_transmittance: float = Field(1.0, description="Atmospheric transmission factor (0.0 to 1.0)")
    transmission_factor: float = Field(1.0, description="Atmospheric transmission factor (0.0 to 1.0)")
    ambient_light_factor: float = Field(1.0, description="Ambient illumination factor (0.05 to 1.0)")
    effective_visibility_km: float = Field(20.0, description="Meteorological optical range visibility (km)")
    is_occluded: bool = Field(False, description="True if temporary optical occlusion is currently blocking beacon")
    occlusion_active: bool = Field(False, description="True if temporary optical occlusion is active")
    occlusion_remaining_s: float = Field(0.0, description="Seconds remaining in current occlusion")
    applied_noise_types: List[str] = Field(default_factory=list, description="Currently active noise models")
    gaussian_active: bool = Field(False, description="Gaussian noise model active")
    salt_pepper_active: bool = Field(False, description="Salt & Pepper noise model active")
    poisson_active: bool = Field(False, description="Poisson noise model active")
    noise_type: str = Field("None", description="Active noise mode")
    noise_level_sigma: float = Field(0.0, description="Noise standard deviation (px, max 20.0)")
    salt_pepper_ratio: float = Field(0.02, description="Salt & pepper noise ratio")
    snr_reduction_db: float = Field(0.0, description="Forced SNR reduction in dB")
    effective_snr_db: Optional[float] = Field(None, description="Signal-to-noise ratio under disturbance")
    motion_blur_applied: bool = Field(False, description="Whether motion blur was applied")
    motion_blur_enabled: bool = Field(False, description="Whether motion blur disturbance is enabled")
    beacon_flicker_enabled: bool = Field(False, description="Whether optical beacon flicker modulation is active")
    beacon_flicker_frequency_hz: float = Field(10.0, description="Flicker modulation frequency in Hz")


class SimulationTelemetry(BaseModel):
    timestamp: float
    simulation_time_s: float
    frame_number: int
    is_running: bool
    fps: float
    target: TargetState
    targets: List[TargetState] = Field(default_factory=list)
    camera: CameraState
    tracking: TrackingTelemetry
    detection: DetectionTelemetry = Field(default_factory=DetectionTelemetry)
    disturbance: DisturbanceTelemetry = Field(default_factory=DisturbanceTelemetry)
    atmospheric_condition: str = "Clear"
    orbital: Optional[dict] = Field(default=None, description="Orbital scenario telemetry")
    handover: Optional[dict] = Field(default=None, description="Satellite handover state and metrics")

