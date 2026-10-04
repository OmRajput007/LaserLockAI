"""
Official Default Parameters for Problem Statement 4:
Development of an AI-Based Virtual Camera Tracking System for Coarse Alignment of Mobile FSOC Terminals.
"""

from backend.app.models.config_model import (
    SystemConfig,
    CameraConfig,
    TargetConfig,
    MotionConfig,
    DetectionConfig,
    TrackingConfig,
    ControlConfig,
    DisturbanceConfig,
    PerformanceConfig,
)


def get_default_config() -> SystemConfig:
    """Returns a new instance of SystemConfig populated with official Problem Statement 4 defaults."""
    return SystemConfig(
        project_title="AI-Based Virtual Camera Tracking System for Mobile FSOC Terminals",
        version="1.0.0-part1",
        camera=CameraConfig(
            sensor_type="Monochrome Focal Plane Array",
            resolution_width=640,
            resolution_height=480,
            fov_horizontal_deg=4.0,
            fov_vertical_deg=3.0,
            update_rate_hz=30.0,  # Minimum 30 Hz
            initial_pan_deg=0.0,
            initial_tilt_deg=0.0,
            max_pan_speed_deg_s=5.0,  # Max 5°/s
            max_tilt_speed_deg_s=5.0,  # Max 5°/s
            focal_length_mm=50.0,
        ),
        target=TargetConfig(
            target_type="Beacon Spot",
            target_count=1,  # Target count: 1
            shape="Square",  # Square mandatory
            size_pixels=10,  # 10x10 pixels
            initial_location_mode="Random",  # Random initial location
            intensity=255.0,
        ),
        motion=MotionConfig(
            trajectory_type="Figure of 8",  # Straight Line, Circular, Figure of 8, Random
            speed_pixels_per_s=40.0,
            screen_width=2000,  # Screen size: 2000x2000 minimum
            screen_height=2000,
        ),
        detection=DetectionConfig(
            method="CV + Kalman",
            algorithm="CV + Kalman",
            intensity_threshold=120,
            subpixel_accuracy=True,
            reject_false_bright_objects=True,
        ),
        tracking=TrackingConfig(
            algorithm="Kalman Filter",
            update_interval_hz=30.0,
        ),
        control=ControlConfig(
            mode="PID Coarse Pointing",
            kp_pan=70.0,
            ki_pan=11.0,
            kd_pan=1.8,
            kp_tilt=70.0,
            ki_tilt=11.0,
            kd_tilt=1.8,
            integral_windup_limit=5.0,
        ),
        disturbance=DisturbanceConfig(
            noise_type="None",  # Salt & Pepper, Gaussian, Poisson
            noise_std_dev=5.0,  # Max noise std dev: 20 pixels
            camera_jitter_max_px=0.0,  # Max camera jitter: +-20 pixels/frame
            atmospheric_condition="Clear",  # Clear, Haze, Fog, Rain, Low Light
            platform_motion_type="Linear",  # Linear mandatory
            platform_motion_max_px=0.0,  # Max platform motion: +-20 pixels/frame
        ),
        performance=PerformanceConfig(
            max_acquisition_time_s=2.0,  # Acquisition <= 2 sec
            max_tracking_error_pixels=10.0,  # Tracking error <= 10 pixels
            max_target_loss_percent=5.0,  # Target loss < 5%
            max_reacquisition_time_s=1.0,  # Re-acquisition <= 1 sec
            min_processing_speed_fps=20.0,  # Processing speed >= 20 FPS
        ),
    )
