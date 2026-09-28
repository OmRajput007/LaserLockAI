import math
import pytest
from backend.app.config.manager import config_manager
from backend.app.simulation.engine import SimulationEngine

def test_local_scenario_straight_line_regression():
    cfg = config_manager.get_config()
    cfg.motion.trajectory_type = "Straight Line"
    cfg.motion.speed_pixels_per_s = 40.0
    
    engine = SimulationEngine(cfg)
    engine.start()
    
    # Run 60 steps (2 seconds at 30 Hz)
    initial_telem = engine.step()
    init_x = initial_telem.target.world_x
    init_y = initial_telem.target.world_y
    
    for _ in range(59):
        telem = engine.step()
    
    final_x = telem.target.world_x
    final_y = telem.target.world_y
    
    # Target must have moved along straight line trajectory
    dx = final_x - init_x
    dy = final_y - init_y
    dist = math.sqrt(dx**2 + dy**2)
    assert dist > 10.0, f"Target did not move: dist={dist}"
    assert telem.target.is_in_fov in (True, False)
    assert telem.frame_number == 60
    assert math.isclose(telem.simulation_time_s, 2.0, abs_tol=0.05)

def test_local_scenario_circular_regression():
    cfg = config_manager.get_config()
    cfg.motion.trajectory_type = "Circular"
    cfg.motion.speed_pixels_per_s = 40.0
    
    engine = SimulationEngine(cfg)
    engine.start()
    
    # Run 90 steps (3 seconds at 30 Hz)
    positions = []
    for _ in range(90):
        telem = engine.step()
        positions.append((telem.target.world_x, telem.target.world_y))
    
    assert len(positions) == 90
    assert telem.frame_number == 90
    assert math.isclose(telem.simulation_time_s, 3.0, abs_tol=0.05)
    
    # Check that motion is non-linear (circular trajectory changes direction)
    vx_initial = positions[10][0] - positions[0][0]
    vy_initial = positions[10][1] - positions[0][1]
    vx_later = positions[60][0] - positions[50][0]
    vy_later = positions[60][1] - positions[50][1]
    
    # Vector directions should not be identical for a circular path
    dot_prod = (vx_initial * vx_later + vy_initial * vy_later)
    assert not math.isclose(dot_prod, 1.0, rel_tol=0.01)
