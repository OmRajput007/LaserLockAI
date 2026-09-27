import math
import pytest
from backend.app.config.defaults import get_default_config
from backend.app.camera.fpa_camera import FPACamera
from backend.app.target.motion_generators import (
    StraightLineTrajectory,
    CircularTrajectory,
    FigureOf8Trajectory,
    RandomTrajectory,
    SpiralTrajectory,
    SinusoidalTrajectory,
    WaypointTrajectory,
    UserDefinedTrajectory,
    create_motion_generator,
)
from backend.app.target.beacon import BeaconTarget, TargetManager
from backend.app.simulation.engine import SimulationEngine


def test_target_trajectories_kinematics():
    """Verify all 8 trajectories generate valid 3D positions, velocities, and accelerations."""
    patterns = [
        "Straight Line",
        "Circular",
        "Figure of 8",
        "Random",
        "Spiral",
        "Sinusoidal",
        "Waypoint",
        "User-defined",
    ]

    for p in patterns:
        gen = create_motion_generator(p, cx=1000.0, cy=1000.0, cz=1000.0, speed=40.0)
        gen.reset(initial_mode="Center")

        for _ in range(10):
            pos, vel, acc = gen.evaluate(dt=0.0333)
            # Position validation
            assert len(pos) == 3
            assert not any(math.isnan(coord) for coord in pos)

            # Velocity validation
            assert len(vel) == 3
            assert not any(math.isnan(v) for v in vel)

            # Acceleration validation
            assert len(acc) == 3
            assert not any(math.isnan(a) for a in acc)


def test_target_shapes_rendering():
    """Verify spot rendering for Square, Circle, and Gaussian optical spots."""
    import numpy as np

    for shape in ["Square", "Circle", "Gaussian"]:
        target = BeaconTarget(target_id=1, shape=shape, size_pixels=10, intensity=255.0)
        frame = np.zeros((480, 640), dtype=np.uint8)
        target.render_to_frame(frame, px=320.0, py=240.0)

        # Center pixel must have optical peak intensity
        assert frame[240, 320] > 200


def test_camera_projection_mathematics():
    """Verify 3D to 2D pin-hole camera projection mathematics."""
    config = get_default_config().camera
    camera = FPACamera(config)

    # 1. Target directly along boresight at range 1000m:
    # Camera at (1000, 1000, 0), Target at (1000, 1000, 1000), Pan=0, Tilt=0
    u, v, in_fov, az, el, depth = camera.project_3d_target(1000.0, 1000.0, 1000.0)
    assert in_fov is True
    assert depth == 1000.0
    assert abs(u - 320.0) < 0.01  # Center pixel X
    assert abs(v - 240.0) < 0.01  # Center pixel Y
    assert abs(az) < 0.001
    assert abs(el) < 0.001

    # 2. Target offset to the right by 2.0 degrees (half horizontal FOV)
    # tan(2°) * 1000m = 34.9207m
    offset_x = 1000.0 * math.tan(math.radians(2.0))
    u_edge, v_edge, in_fov_edge, az_edge, el_edge, _ = camera.project_3d_target(1000.0 + offset_x, 1000.0, 1000.0)
    assert abs(az_edge - 2.0) < 0.01
    assert abs(u_edge - 640.0) < 0.1  # Right boundary of sensor

    # 3. Target offset by 3.0 degrees (Outside horizontal FOV of 4.0°)
    offset_out = 1000.0 * math.tan(math.radians(3.0))
    u_out, v_out, in_fov_out, az_out, el_out, _ = camera.project_3d_target(1000.0 + offset_out, 1000.0, 1000.0)
    assert in_fov_out is False
    assert u_out > 640.0


def test_camera_fov_calculation_and_visibility():
    """Verify target visibility and boundary determination inside vs outside FOV."""
    config = get_default_config().camera
    camera = FPACamera(config)

    # In front of camera, inside FOV
    _, _, in_fov_center, _, _, _ = camera.project_3d_target(1000.0, 1000.0, 500.0)
    assert in_fov_center is True

    # Target BEHIND camera (Z < 0 in camera frame)
    _, _, in_fov_behind, _, _, depth_behind = camera.project_3d_target(1000.0, 1000.0, -100.0)
    assert in_fov_behind is False
    assert depth_behind <= 0.0


def test_camera_gimbal_limits_and_rate_limiting():
    """Verify maximum slew speed (5°/s) and physical stop limits."""
    config = get_default_config().camera
    camera = FPACamera(config)

    # 1. Test commanded target setpoint slew rate limiter
    camera.set_target_angles(pan_deg=20.0, tilt_deg=10.0)
    dt = 1.0  # 1 second
    camera.update_kinematics(dt)
    # In 1 second, camera should slew by exactly 5.0 degrees (max speed 5°/s)
    assert abs(camera.pan_deg - 5.0) < 0.01
    assert abs(camera.tilt_deg - 5.0) < 0.01

    # 2. Test physical stop limits
    camera.set_target_angles(pan_deg=250.0, tilt_deg=120.0)  # Exceeds +180° and +85°
    assert camera.target_pan_deg == 180.0
    assert camera.target_tilt_deg == 85.0
