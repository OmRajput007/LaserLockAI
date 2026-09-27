from abc import ABC, abstractmethod
from typing import Tuple
from backend.app.models.config_model import ControlConfig


class BaseGimbalController(ABC):
    """
    Abstract interface for closed-loop coarse pointing gimbal controllers.
    PID controller will be implemented in Part 6.
    """

    def __init__(self, config: ControlConfig):
        self.config = config

    @abstractmethod
    def reset(self):
        """Resets controller state, integrals, and derivative histories."""
        pass

    @abstractmethod
    def compute_control(
        self, error_x_px: float, error_y_px: float, dt: float
    ) -> Tuple[float, float]:
        """
        Computes pan and tilt gimbal rate commands (deg/s) from pixel tracking error.
        Returns:
            (cmd_pan_deg_s, cmd_tilt_deg_s)
        """
        pass


class OpenLoopController(BaseGimbalController):
    """
    Open-loop / manual bypass controller for Part 1 foundation.
    Does not apply automatic feedback commands.
    """

    def __init__(self, config: ControlConfig):
        super().__init__(config)

    def reset(self):
        pass

    def compute_control(
        self, error_x_px: float, error_y_px: float, dt: float
    ) -> Tuple[float, float]:
        return 0.0, 0.0
