import json
from pathlib import Path
import tempfile
import pytest

from backend.app.config.defaults import get_default_config
from backend.app.config.manager import ConfigManager
from backend.app.models.config_model import SystemConfig


def test_default_parameters_match_problem_statement_4():
    """Verify that default parameters rigorously meet Problem Statement 4 specifications."""
    config = get_default_config()

    # Screen size: 2000 x 2000 minimum
    assert config.motion.screen_width >= 2000
    assert config.motion.screen_height >= 2000

    # Camera: Monochrome Focal Plane Array, 640x480, FOV 4°x3°, update rate >= 30 Hz
    assert config.camera.sensor_type == "Monochrome Focal Plane Array"
    assert config.camera.resolution_width == 640
    assert config.camera.resolution_height == 480
    assert config.camera.fov_horizontal_deg == 4.0
    assert config.camera.fov_vertical_deg == 3.0
    assert config.camera.update_rate_hz >= 30.0

    # Gimbal maximum pan/tilt speed: 5°/s
    assert config.camera.max_pan_speed_deg_s == 5.0
    assert config.camera.max_tilt_speed_deg_s == 5.0

    # Target: Beacon Spot, count 1, Square, 10x10 px, initial location Random
    assert config.target.target_type == "Beacon Spot"
    assert config.target.target_count == 1
    assert config.target.shape == "Square"
    assert config.target.size_pixels == 10
    assert config.target.initial_location_mode == "Random"

    # Mandatory motions supported
    assert config.motion.trajectory_type in ["Straight Line", "Circular", "Figure of 8", "Random"]

    # Tracking update interval >= 20 Hz
    assert config.tracking.update_interval_hz >= 20.0

    # Performance requirements
    assert config.performance.max_acquisition_time_s == 2.0
    assert config.performance.max_tracking_error_pixels == 10.0
    assert config.performance.max_target_loss_percent == 5.0
    assert config.performance.max_reacquisition_time_s == 1.0
    assert config.performance.min_processing_speed_fps == 20.0

    # Disturbance constraints
    assert config.disturbance.noise_std_dev <= 20.0
    assert config.disturbance.camera_jitter_max_px <= 20.0
    assert config.disturbance.platform_motion_max_px <= 20.0
    assert config.disturbance.platform_motion_type == "Linear"


def test_config_save_load_reset():
    """Verify configuration serialization, deserialization, and reset to defaults."""
    with tempfile.TemporaryDirectory() as temp_dir:
        mgr = ConfigManager(config_dir=Path(temp_dir))

        # Default configuration should be loaded
        initial_cfg = mgr.get_config()
        assert initial_cfg.camera.resolution_width == 640

        # Modify parameter
        modified_cfg = initial_cfg.model_copy(deep=True)
        modified_cfg.camera.fov_horizontal_deg = 5.5
        modified_cfg.target.size_pixels = 12

        mgr.set_config(modified_cfg)
        assert mgr.get_config().camera.fov_horizontal_deg == 5.5

        # Re-instantiate manager from same directory to verify persistence
        mgr2 = ConfigManager(config_dir=Path(temp_dir))
        assert mgr2.get_config().camera.fov_horizontal_deg == 5.5
        assert mgr2.get_config().target.size_pixels == 12

        # Reset to defaults
        reset_cfg = mgr2.reset_defaults()
        assert reset_cfg.camera.fov_horizontal_deg == 4.0
        assert reset_cfg.target.size_pixels == 10
