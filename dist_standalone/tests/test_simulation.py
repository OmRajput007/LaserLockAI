import math
from backend.app.config.defaults import get_default_config
from backend.app.simulation.engine import SimulationEngine
from backend.app.camera.fpa_camera import FPACamera


def test_fpa_camera_projection_and_boresight():
    """Verify camera projection from 2000x2000 world to 640x480 FPA."""
    config = get_default_config().camera
    camera = FPACamera(config, world_width=2000, world_height=2000)

    # Initial boresight center is (1000, 1000)
    bx, by = camera.world_boresight
    assert bx == 1000.0
    assert by == 1000.0

    # Target exactly at boresight (1000, 1000) projects to (320, 240)
    px, py, in_fov = camera.project_world_to_sensor(1000.0, 1000.0)
    assert in_fov is True
    assert px == 320.0
    assert py == 240.0

    # Boresight error for target at center should be 0.0
    err_x, err_y, total_err, in_fov = camera.get_boresight_error(1000.0, 1000.0)
    assert total_err == 0.0

    # Target outside FOV (e.g. world at 100, 100)
    px_out, py_out, in_fov_out = camera.project_world_to_sensor(100.0, 100.0)
    assert in_fov_out is False


def test_simulation_engine_discrete_step():
    """Verify simulation engine discrete updates and telemetry generation."""
    config = get_default_config()
    sim = SimulationEngine(config)
    sim.reset()

    telemetry = sim.step()
    assert telemetry.frame_number == 1
    assert telemetry.simulation_time_s > 0.0
    assert telemetry.target.target_id == 1
    assert telemetry.camera.resolution_width == 640
    assert telemetry.camera.resolution_height == 480
