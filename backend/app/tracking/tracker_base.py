from abc import ABC, abstractmethod
from typing import Optional, Tuple
from backend.app.models.config_model import TrackingConfig


class BaseTracker(ABC):
    """
    Abstract interface for FSOC coarse alignment target tracking filters.
    Concrete implementations (e.g. Kalman Filter) will be implemented in Part 6.
    """

    def __init__(self, config: TrackingConfig):
        self.config = config
        self.is_initialized = False

    @abstractmethod
    def reset(self):
        """Resets filter state estimates and covariance matrices."""
        pass

    @abstractmethod
    def update(self, measurement: Optional[Tuple[float, float]], dt: float) -> Tuple[Optional[float], Optional[float]]:
        """
        Executes predict-update cycle on target position measurement (pixel_x, pixel_y).
        Returns estimated filtered position (est_x, est_y).
        """
        pass


class PassthroughTracker(BaseTracker):
    """Initial Part 1 baseline tracker that passes raw measurements directly."""

    def __init__(self, config: TrackingConfig):
        super().__init__(config)
        self.last_estimate: Optional[Tuple[float, float]] = None

    def reset(self):
        self.last_estimate = None
        self.is_initialized = False

    def update(self, measurement: Optional[Tuple[float, float]], dt: float) -> Tuple[Optional[float], Optional[float]]:
        self.last_estimate = measurement
        self.is_initialized = measurement is not None
        return measurement
