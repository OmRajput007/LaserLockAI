import math
from typing import Optional, Tuple
import numpy as np


class BeaconKalmanFilter:
    """
    2D/4D Discrete Linear Kalman Filter for FSOC Optical Beacon Tracking.
    State vector: [x, y, vx, vy]^T (pixel position and velocity on 640x480 FPA).
    
    Provides:
    - Kinematic state prediction (prior estimate x_pri)
    - Measurement update with innovation covariance (posterior estimate x_post)
    - Centroid jitter filtering and subpixel smoothing
    - Occlusion coasting (dead-reckoning when beacon is temporarily obscured or dropped)
    - Velocity estimation for PAT lead-angle compensation
    """

    def __init__(
        self,
        dt: float = 0.0333,
        process_noise: float = 0.5,
        measurement_noise: float = 1.0,
        max_coast_frames: int = 15,
    ):
        self.dt = dt
        self.process_noise = process_noise
        self.measurement_noise = measurement_noise
        self.max_coast_frames = max_coast_frames

        # State transition matrix F
        self.F = np.array([
            [1.0, 0.0, self.dt, 0.0],
            [0.0, 1.0, 0.0, self.dt],
            [0.0, 0.0, 1.0,     0.0],
            [0.0, 0.0, 0.0,     1.0],
        ], dtype=np.float64)

        # Measurement matrix H (we measure position [x, y])
        self.H = np.array([
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
        ], dtype=np.float64)

        # Process noise covariance Q (continuous white noise acceleration model)
        q = process_noise
        dt2 = (self.dt ** 2) / 2.0
        dt3 = (self.dt ** 3) / 3.0
        self.Q = q * np.array([
            [dt3, 0.0, dt2, 0.0],
            [0.0, dt3, 0.0, dt2],
            [dt2, 0.0, self.dt, 0.0],
            [0.0, dt2, 0.0, self.dt],
        ], dtype=np.float64)

        # Measurement noise covariance R
        r = measurement_noise
        self.R = r * np.eye(2, dtype=np.float64)

        # State vector [x, y, vx, vy]^T
        self.x = np.zeros(4, dtype=np.float64)
        # Covariance matrix P
        self.P = np.eye(4, dtype=np.float64) * 100.0

        self.is_initialized = False
        self.coasting_frames = 0
        self.last_predicted_x: Optional[float] = None
        self.last_predicted_y: Optional[float] = None

    def reset(self):
        """Resets filter state to uninitialized."""
        self.x = np.zeros(4, dtype=np.float64)
        self.P = np.eye(4, dtype=np.float64) * 100.0
        self.is_initialized = False
        self.coasting_frames = 0
        self.last_predicted_x = None
        self.last_predicted_y = None

    def update_dt(self, dt: float):
        """Updates discrete sample interval if camera rate changes."""
        self.dt = dt
        self.F[0, 2] = dt
        self.F[1, 3] = dt

    def predict(self) -> Tuple[float, float]:
        """
        Prior state extrapolation:
            x_k|k-1 = F * x_k-1
            P_k|k-1 = F * P_k-1 * F^T + Q
        Returns:
            (predicted_x, predicted_y)
        """
        if not self.is_initialized:
            return 320.0, 240.0

        self.x = self.F @ self.x
        self.P = self.F @ self.P @ self.F.T + self.Q

        self.last_predicted_x = float(self.x[0])
        self.last_predicted_y = float(self.x[1])
        return self.last_predicted_x, self.last_predicted_y

    def update(self, meas_x: float, meas_y: float) -> Tuple[float, float, float, float]:
        """
        Measurement update:
            y = z - H * x_pri
            S = H * P_pri * H^T + R
            K = P_pri * H^T * S^-1
            x_post = x_pri + K * y
            P_post = (I - K * H) * P_pri
        Returns:
            (filtered_x, filtered_y, velocity_x, velocity_y)
        """
        z = np.array([meas_x, meas_y], dtype=np.float64)

        if not self.is_initialized:
            # Initialize state with first measurement
            self.x = np.array([meas_x, meas_y, 0.0, 0.0], dtype=np.float64)
            self.P = np.eye(4, dtype=np.float64) * 5.0
            self.is_initialized = True
            self.coasting_frames = 0
            return meas_x, meas_y, 0.0, 0.0

        # Innovation / Residual
        y = z - self.H @ self.x
        S = self.H @ self.P @ self.H.T + self.R
        K = self.P @ self.H.T @ np.linalg.inv(S)

        # State and covariance update
        self.x = self.x + K @ y
        I = np.eye(4, dtype=np.float64)
        self.P = (I - K @ self.H) @ self.P

        self.coasting_frames = 0
        return float(self.x[0]), float(self.x[1]), float(self.x[2]), float(self.x[3])

    def coast(self) -> Tuple[Optional[float], Optional[float], bool]:
        """
        Coasting step when no measurement is received (e.g. occlusion).
        Uses dead-reckoning prediction up to max_coast_frames.
        Returns:
            (coasted_x, coasted_y, still_valid)
        """
        if not self.is_initialized:
            return None, None, False

        self.coasting_frames += 1
        if self.coasting_frames > self.max_coast_frames:
            # Lost target after exceeding coasting budget
            self.reset()
            return None, None, False

        # Propagate covariance with process noise during coasting
        return float(self.x[0]), float(self.x[1]), True

    @property
    def current_state(self) -> Tuple[float, float, float, float]:
        """Returns (x, y, vx, vy)."""
        return float(self.x[0]), float(self.x[1]), float(self.x[2]), float(self.x[3])

    @property
    def estimated_speed_px_s(self) -> float:
        """Returns Euclidean speed in px/s."""
        return math.sqrt(self.x[2] ** 2 + self.x[3] ** 2)
