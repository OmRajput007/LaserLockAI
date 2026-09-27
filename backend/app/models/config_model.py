from typing import List, Literal, Tuple, Optional
from pydantic import BaseModel, Field


class CameraConfig(BaseModel):
    sensor_type: str = Field(default="Monochrome Focal Plane Array", description="Camera sensor type")
    resolution_width: int = Field(default=640, description="Horizontal resolution in pixels")
    resolution_height: int = Field(default=480, description="Vertical resolution in pixels")
    fov_horizontal_deg: float = Field(default=4.0, description="Horizontal Field of View in degrees")
    fov_vertical_deg: float = Field(default=3.0, description="Vertical Field of View in degrees")
    update_rate_hz: float = Field(default=30.0, ge=30.0, description="Sensor update frequency (min 30 Hz)")
    initial_pan_deg: float = Field(default=0.0, description="Initial camera pan angle")
    initial_tilt_deg: float = Field(default=0.0, description="Initial camera tilt angle")
    max_pan_speed_deg_s: float = Field(default=5.0, description="Maximum pan gimbal speed in deg/s")
    max_tilt_speed_deg_s: float = Field(default=5.0, description="Maximum tilt gimbal speed in deg/s")
    pan_min_limit_deg: float = Field(default=-180.0, description="Minimum pan angle limit")
    pan_max_limit_deg: float = Field(default=180.0, description="Maximum pan angle limit")
    tilt_min_limit_deg: float = Field(default=-85.0, description="Minimum tilt angle limit")
    tilt_max_limit_deg: float = Field(default=85.0, description="Maximum tilt angle limit")
    focal_length_mm: float = Field(default=50.0, description="Effective optical focal length")
    position_x: float = Field(default=1000.0, description="Camera optical center world X position")
    position_y: float = Field(default=1000.0, description="Camera optical center world Y position")
    position_z: float = Field(default=0.0, description="Camera optical center world Z position")
    color_mode: Literal["Monochrome", "Colour"] = Field(
        default="Monochrome", description="Sensor output format: Monochrome (default) or Colour"
    )


class TargetConfig(BaseModel):
    target_id: int = Field(default=1, description="Primary target ID")
    target_type: str = Field(default="Beacon Spot", description="Optical beacon type")
    target_count: int = Field(default=1, ge=1, le=10, description="Number of targets (default: 1)")
    shape: Literal["Square", "Circle", "Gaussian"] = Field(
        default="Square", description="Beacon spot shape: Square (default), Circle, or Gaussian"
    )
    size_pixels: int = Field(default=10, description="Target dimension 10x10 pixels")
    initial_location_mode: Literal["Random", "Manual", "Center"] = Field(
        default="Random", description="Target initial placement"
    )
    intensity: float = Field(default=255.0, ge=0.0, le=255.0, description="Optical radiant peak intensity (0-255)")
    default_depth_z: float = Field(default=1000.0, ge=10.0, description="Nominal range/depth Z in world units")
    background_level: float = Field(default=15.0, ge=0.0, le=100.0, description="Sensor background/ambient baseline level")
    noise_sigma: float = Field(default=3.0, ge=0.0, le=20.0, description="Sensor readout baseline noise std dev")
    flicker_enabled: bool = Field(default=False, description="Enable beacon intensity periodic flicker modulation")
    flicker_frequency_hz: float = Field(default=8.0, ge=0.1, le=50.0, description="Beacon flicker modulation rate (Hz)")
    flicker_depth: float = Field(default=0.35, ge=0.0, le=1.0, description="Beacon flicker amplitude modulation index (0-1)")


class MotionConfig(BaseModel):
    trajectory_type: Literal[
        "Straight Line",
        "Circular",
        "Figure of 8",
        "Random",
        "Spiral",
        "Sinusoidal",
        "Waypoint",
        "User-defined",
    ] = Field(default="Straight Line", description="Mathematical motion pattern")
    speed_pixels_per_s: float = Field(default=40.0, ge=1.0, le=500.0, description="Target motion velocity")
    screen_width: int = Field(default=2000, ge=2000, description="Virtual scene world width (min 2000)")
    screen_height: int = Field(default=2000, ge=2000, description="Virtual scene world height (min 2000)")
    world_depth_z: int = Field(default=2000, description="Virtual scene optical range depth")


class DetectionConfig(BaseModel):
    # Part 4 Detection Architecture: Common interface across all 4 modes
    method: Literal["Classical CV", "AI Detector", "CV + Kalman", "AI + Kalman"] = Field(
        default="Classical CV",
        description="Active detection method: Classical CV | AI Detector | CV + Kalman | AI + Kalman",
    )
    algorithm: str = Field(
        default="Classical CV",
        description="Legacy alias for detection method",
    )

    # Classical Computer Vision Parameters
    intensity_threshold: int = Field(default=120, ge=0, le=255, description="Binarization threshold (0-255)")
    use_otsu: bool = Field(default=False, description="Use automatic Otsu thresholding")
    min_area: float = Field(default=3.0, ge=1.0, description="Minimum contour area to consider candidate")
    max_area: float = Field(default=600.0, le=5000.0, description="Maximum contour area for beacon spot")
    morph_kernel_size: int = Field(default=3, ge=1, le=11, description="Morphological structuring element size")
    gaussian_blur_kernel: int = Field(default=3, ge=1, le=15, description="Gaussian filter kernel size (odd)")
    subpixel_accuracy: bool = Field(default=True, description="Calculate centroid using image moments")
    annotate_frame: bool = Field(default=True, description="Render detection overlays (crosshairs, bbox, error vector)")

    # Part 4 AI Detector Configuration
    ai_model_name: str = Field(default="YOLOv8-Nano-FSOC", description="Target AI detection model architecture")
    ai_confidence_threshold: float = Field(default=0.50, ge=0.05, le=1.0, description="AI confidence score acceptance threshold")
    ai_input_resolution: str = Field(default="640x480", description="Model input image resolution")
    ai_inference_device: Literal["CPU", "GPU", "CUDA", "DirectML"] = Field(
        default="CPU", description="Inference execution device"
    )
    ai_detection_frequency_hz: float = Field(default=30.0, ge=1.0, le=60.0, description="AI inference frequency (Hz)")
    model_weights_path: str = Field(
        default="models/yolov8_beacon.onnx", description="Filepath to trained ONNX/YOLO model weights"
    )

    # Part 4 Target Identification & False Object Rejection
    target_id_mode: Literal["Multi-Criteria", "Highest Confidence", "Brightest Spot"] = Field(
        default="Multi-Criteria",
        description="Identification criterion: Position, Size, Brightness, Confidence, Temporal consistency",
    )
    reject_false_bright_objects: bool = Field(
        default=True, description="Disambiguate true FSOC beacon from solar glints/hot pixels/reflections"
    )
    max_spatial_jump_px: float = Field(
        default=80.0, description="Max plausible frame-to-frame pixel jump for temporal consistency"
    )
    min_track_persistence_frames: int = Field(
        default=2, ge=1, description="Minimum frames a candidate must persist before confirmation"
    )
    expected_spot_size_px: float = Field(
        default=10.0, description="Nominal optical diffraction spot dimension for size consistency checking"
    )

    # Part 4 Kalman Filter Smoothing (CV + Kalman / AI + Kalman)
    kalman_process_noise: float = Field(default=0.5, ge=0.01, le=10.0, description="Kalman process noise Q covariance")
    kalman_measurement_noise: float = Field(default=1.0, ge=0.01, le=20.0, description="Kalman measurement noise R covariance")
    kalman_max_coast_frames: int = Field(default=15, ge=1, le=60, description="Max coasting frames on occlusion")

    # Clutter / False Bright Object Simulation Injection (for testing & verification)
    inject_false_bright_objects: bool = Field(
        default=False, description="Inject synthetic false bright objects (glints/reflections) into camera frame"
    )
    false_bright_object_count: int = Field(
        default=2, ge=1, le=5, description="Number of false bright objects to inject for rejection testing"
    )


class TrackingConfig(BaseModel):
    algorithm: Literal["None", "Kalman Filter", "Alpha-Beta", "Particle Filter"] = Field(
        default="Kalman Filter", description="Active tracking filter: None | Kalman Filter | Alpha-Beta"
    )
    update_interval_hz: float = Field(default=30.0, ge=20.0, description="Tracking update rate (>= 20 Hz)")
    process_noise_q: float = Field(default=0.5, ge=0.01, le=10.0, description="Kalman process noise Q covariance")
    measurement_noise_r: float = Field(default=1.0, ge=0.01, le=20.0, description="Kalman measurement noise R covariance")
    max_coast_frames: int = Field(default=15, ge=1, le=60, description="Max dead-reckoning coasting frames during occlusion")
    
    # Search Pattern
    search_pattern: Literal["Raster Search", "Sector Search", "Spiral Search"] = Field(
        default="Raster Search", description="Autonomous scan pattern when target is outside FOV"
    )
    search_pan_range_deg: float = Field(default=20.0, ge=5.0, le=90.0, description="Search azimuth scan range (+/- deg)")
    search_tilt_range_deg: float = Field(default=15.0, ge=5.0, le=45.0, description="Search elevation scan range (+/- deg)")
    search_slew_speed_deg_s: float = Field(default=4.0, ge=1.0, le=5.0, description="Search slew speed (max 5 deg/s)")

    # Lock & Acquisition Thresholds
    lock_angular_error_threshold_deg: float = Field(default=0.1, ge=0.01, le=1.0, description="Lock angular error threshold (deg)")
    lock_pixel_error_threshold_px: float = Field(default=10.0, ge=1.0, le=50.0, description="Lock pixel error threshold (<= 10 px req)")
    lock_confidence_threshold: float = Field(default=0.70, ge=0.1, le=1.0, description="Lock detection confidence threshold")
    lock_consecutive_frames: int = Field(default=5, ge=1, le=30, description="Consecutive frames required for lock confirmation")
    acquisition_timeout_s: float = Field(default=2.0, ge=0.5, le=10.0, description="Acquisition budget (<= 2.0 s)")
    reacquisition_timeout_s: float = Field(default=1.0, ge=0.2, le=5.0, description="Reacquisition budget (<= 1.0 s)")


class ControlConfig(BaseModel):
    mode: Literal["Open Loop", "PID Coarse Pointing", "State Feedback"] = Field(
        default="PID Coarse Pointing", description="Gimbal control mode: Open Loop | PID Coarse Pointing"
    )
    # Pan PID
    kp_pan: float = Field(default=1.2, description="Proportional gain for pan axis")
    ki_pan: float = Field(default=0.05, description="Integral gain for pan axis")
    kd_pan: float = Field(default=0.18, description="Derivative gain for pan axis")

    # Tilt PID
    kp_tilt: float = Field(default=1.2, description="Proportional gain for tilt axis")
    ki_tilt: float = Field(default=0.05, description="Integral gain for tilt axis")
    kd_tilt: float = Field(default=0.18, description="Derivative gain for tilt axis")

    # Output Limits & Anti-windup
    max_pan_rate_deg_s: float = Field(default=5.0, le=5.0, description="Max pan rate output limit (5.0 deg/s)")
    max_tilt_rate_deg_s: float = Field(default=5.0, le=5.0, description="Max tilt rate output limit (5.0 deg/s)")
    integral_windup_limit: float = Field(default=2.5, description="Anti-windup integral clamp bound (deg/s)")
    derivative_filter_alpha: float = Field(default=0.8, ge=0.0, le=0.99, description="Derivative low-pass filter coefficient")
    deadband_px: float = Field(default=0.5, ge=0.0, le=5.0, description="Centering error deadband to avoid jitter (px)")


class DisturbanceConfig(BaseModel):
    # Multi-Noise Engine (Salt & Pepper, Gaussian, Poisson simultaneously)
    noise_type: Literal["None", "Salt & Pepper", "Gaussian", "Poisson", "Multi-Noise"] = Field(
        default="None", description="Primary image noise type"
    )
    gaussian_noise_enabled: bool = Field(default=False, description="Enable additive Gaussian noise")
    salt_pepper_enabled: bool = Field(default=False, description="Enable impulse Salt & Pepper noise")
    poisson_noise_enabled: bool = Field(default=False, description="Enable Poisson photon shot noise")
    noise_std_dev: float = Field(default=5.0, ge=0.0, le=20.0, description="Max noise std dev <= 20 pixels")
    salt_pepper_ratio: float = Field(default=0.02, ge=0.0, le=0.20, description="Salt & Pepper pixel corruption density")

    # Camera Jitter (Max +/-20 pixels/frame)
    camera_jitter_enabled: bool = Field(default=False, description="Enable high-frequency mechanical camera jitter")
    camera_jitter_max_px: float = Field(default=0.0, ge=0.0, le=20.0, description="Max camera jitter <= 20 px/frame")
    camera_jitter_frequency_hz: float = Field(default=15.0, ge=1.0, le=60.0, description="Camera vibration frequency (Hz)")

    # Atmospheric Conditions (Clear, Haze, Fog, Rain, Low Light)
    atmospheric_condition: Literal["Clear", "Haze", "Fog", "Rain", "Low Light"] = Field(
        default="Clear", description="Atmospheric transmission condition"
    )
    atmospheric_extinction_coeff: float = Field(default=0.05, ge=0.0, le=3.0, description="Optical extinction coefficient beta (1/km)")
    fog_density: float = Field(default=0.5, ge=0.0, le=1.0, description="Fog scattering optical density")
    rain_rate_mm_hr: float = Field(default=25.0, ge=0.0, le=150.0, description="Precipitation rate (mm/hr)")
    ambient_light_factor: float = Field(default=1.0, ge=0.05, le=2.0, description="Scene ambient irradiance multiplier")

    # Platform Motion (Linear mandatory, Circular, Random, Spiral, Figure of 8)
    platform_motion_enabled: bool = Field(default=False, description="Enable mobile terminal platform base motion")
    platform_motion_type: Literal[
        "Linear", "None", "Sinusoidal", "Circular", "Random", "Spiral", "Figure of 8"
    ] = Field(default="Linear", description="Platform motion trajectory type")
    platform_motion_max_px: float = Field(default=0.0, ge=0.0, le=20.0, description="Max platform motion <= 20 px/frame")
    platform_motion_frequency_hz: float = Field(default=1.0, ge=0.1, le=10.0, description="Platform oscillation frequency (Hz)")

    # Other Disturbances
    motion_blur_enabled: bool = Field(default=False, description="Enable motion blur convolution from rapid movement")
    motion_blur_kernel_size: int = Field(default=5, ge=1, le=31, description="Motion blur convolution kernel size (px)")
    beacon_flicker_enabled: bool = Field(default=False, description="Enable beacon radiant intensity flicker")
    beacon_flicker_frequency_hz: float = Field(default=10.0, ge=0.5, le=50.0, description="Beacon flicker modulation rate (Hz)")
    beacon_flicker_depth: float = Field(default=0.5, ge=0.0, le=1.0, description="Beacon flicker modulation index (0-1)")
    temporary_occlusion_enabled: bool = Field(default=False, description="Enable periodic or triggered optical occlusion")
    occlusion_duration_s: float = Field(default=1.0, ge=0.1, le=5.0, description="Occlusion event duration (seconds)")
    occlusion_period_s: float = Field(default=6.0, ge=1.0, le=30.0, description="Occlusion recurring interval (seconds)")
    sudden_camera_movement_enabled: bool = Field(default=False, description="Enable sudden shock / wind gust impulse")
    sudden_movement_max_px: float = Field(default=12.0, ge=0.0, le=20.0, description="Sudden shock amplitude (px)")
    brightness_fluctuation_enabled: bool = Field(default=False, description="Enable ambient background drift")
    brightness_fluctuation_amplitude: float = Field(default=15.0, ge=0.0, le=50.0, description="Background drift amplitude")
    snr_reduction_db: float = Field(default=0.0, ge=0.0, le=30.0, description="Forced SNR reduction attenuation (dB)")

    # Predefined Scenarios
    preset_scenario: Literal[
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
    ] = Field(default="Normal", description="One-click disturbance evaluation benchmark scenario")



class PerformanceConfig(BaseModel):
    max_acquisition_time_s: float = Field(default=2.0, description="Acquisition <= 2 sec requirement")
    max_tracking_error_pixels: float = Field(default=10.0, description="Tracking error <= 10 pixels requirement")
    max_target_loss_percent: float = Field(default=5.0, description="Target loss < 5% requirement")
    max_reacquisition_time_s: float = Field(default=1.0, description="Re-acquisition <= 1 sec requirement")
    min_processing_speed_fps: float = Field(default=20.0, description="Processing speed >= 20 FPS requirement")


class SystemConfig(BaseModel):
    project_title: str = "AI-Based Virtual Camera Tracking System for Mobile FSOC Terminals"
    version: str = "1.0.0-part3"
    camera: CameraConfig = Field(default_factory=CameraConfig)
    target: TargetConfig = Field(default_factory=TargetConfig)
    motion: MotionConfig = Field(default_factory=MotionConfig)
    detection: DetectionConfig = Field(default_factory=DetectionConfig)
    tracking: TrackingConfig = Field(default_factory=TrackingConfig)
    control: ControlConfig = Field(default_factory=ControlConfig)
    disturbance: DisturbanceConfig = Field(default_factory=DisturbanceConfig)
    performance: PerformanceConfig = Field(default_factory=PerformanceConfig)
