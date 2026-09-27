from abc import ABC, abstractmethod
from typing import Tuple
import numpy as np
from backend.app.models.config_model import DisturbanceConfig


class BaseDisturbanceEngine(ABC):
    """
    Abstract interface for optical channel disturbances, sensor noise,
    platform vibrations, and atmospheric attenuation.
    Concrete noise / atmospheric models will be implemented in Part 7.
    """

    def __init__(self, config: DisturbanceConfig):
        self.config = config

    @abstractmethod
    def apply_platform_motion(self, t: float) -> Tuple[float, float]:
        """Returns instantaneous (delta_x_px, delta_y_px) platform motion disturbance."""
        pass

    @abstractmethod
    def apply_sensor_noise(self, frame: np.ndarray) -> np.ndarray:
        """Applies Salt & Pepper, Gaussian, or Poisson noise to the FPA frame."""
        pass


class PassthroughDisturbanceEngine(BaseDisturbanceEngine):
    """Part 1 baseline disturbance module with zero perturbations."""

    def apply_platform_motion(self, t: float) -> Tuple[float, float]:
        return 0.0, 0.0

    def apply_sensor_noise(self, frame: np.ndarray) -> np.ndarray:
        return frame


from backend.app.disturbances.optical_disturbance_engine import OpticalDisturbanceEngine

