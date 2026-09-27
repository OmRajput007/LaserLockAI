import math
from typing import Tuple, Dict, Any, Optional
from backend.app.models.config_model import ControlConfig
from backend.app.control.controller_base import BaseGimbalController


class PIDAxis:
    """
    Precision 1D Discrete PID controller with anti-windup, derivative filtering,
    deadband, and strict actuator saturation output limiting.
    
    Formula:
        u(t) = Kp * e(t) + Ki * ∫ e(t) dt + Kd * de(t)/dt
    """

    def __init__(
        self,
        kp: float = 1.2,
        ki: float = 0.05,
        kd: float = 0.18,
        output_limit: float = 5.0,
        integral_limit: float = 2.5,
        derivative_alpha: float = 0.8,
        deadband: float = 0.02,
    ):
        self.kp = kp
        self.ki = ki
        self.kd = kd
        self.output_limit = output_limit
        self.integral_limit = integral_limit
        self.derivative_alpha = derivative_alpha
        self.deadband = deadband

        # State histories
        self.integral = 0.0
        self.last_error = 0.0
        self.last_derivative = 0.0
        self.is_first_step = True

        # Last computed components for telemetry & diagnostics
        self.p_term = 0.0
        self.i_term = 0.0
        self.d_term = 0.0
        self.output = 0.0
        self.is_saturated = False

    def reset(self):
        """Resets integral accumulator and derivative state."""
        self.integral = 0.0
        self.last_error = 0.0
        self.last_derivative = 0.0
        self.is_first_step = True
        self.p_term = 0.0
        self.i_term = 0.0
        self.d_term = 0.0
        self.output = 0.0
        self.is_saturated = False

    def update_gains(self, kp: float, ki: float, kd: float):
        self.kp = kp
        self.ki = ki
        self.kd = kd

    def compute(self, error: float, dt: float) -> float:
        """
        Computes control output for the current error and time step dt.
        Returns:
            clamped control command within [-output_limit, +output_limit]
        """
        if dt <= 0.00001:
            return self.output

        # 1. Deadband check to eliminate subpixel hunting / jitter
        if abs(error) < self.deadband:
            effective_error = 0.0
        else:
            effective_error = error

        # 2. Proportional term
        self.p_term = self.kp * effective_error

        # 3. Derivative term with first-order low-pass filter
        if self.is_first_step:
            derivative_raw = 0.0
            self.is_first_step = False
        else:
            derivative_raw = (effective_error - self.last_error) / dt

        filtered_derivative = (
            self.derivative_alpha * self.last_derivative
            + (1.0 - self.derivative_alpha) * derivative_raw
        )
        self.last_derivative = filtered_derivative
        self.last_error = effective_error
        self.d_term = self.kd * filtered_derivative

        # 4. Integral term with Anti-Windup (Conditional integration / clamping)
        # Avoid integrating if already saturated in the direction that worsens saturation
        tentative_integral = self.integral + effective_error * dt
        # Clamp integral accumulator to integral_limit bounds
        tentative_integral = max(-self.integral_limit, min(self.integral_limit, tentative_integral))

        tentative_output = self.p_term + self.ki * tentative_integral + self.d_term

        # Check saturation
        if tentative_output > self.output_limit:
            self.is_saturated = True
            # Only accumulate integral if error is driving away from saturation
            if effective_error < 0:
                self.integral = tentative_integral
            self.output = self.output_limit
        elif tentative_output < -self.output_limit:
            self.is_saturated = True
            if effective_error > 0:
                self.integral = tentative_integral
            self.output = -self.output_limit
        else:
            self.is_saturated = False
            self.integral = tentative_integral
            self.output = tentative_output

        self.i_term = self.ki * self.integral
        return self.output


class GimbalPIDController(BaseGimbalController):
    """
    2-Axis (Pan & Tilt) Closed-Loop Gimbal Pointing Controller for FSOC coarse alignment.
    Consists of separate Pan PID and Tilt PID axes.
    Operates strictly within 5.0 deg/s slew limits and enforces physical anti-windup.
    """

    def __init__(self, config: ControlConfig):
        super().__init__(config)
        self.pan_pid = PIDAxis(
            kp=config.kp_pan,
            ki=config.ki_pan,
            kd=config.kd_pan,
            output_limit=config.max_pan_rate_deg_s,
            integral_limit=config.integral_windup_limit,
            derivative_alpha=config.derivative_filter_alpha,
            deadband=0.01,
        )
        self.tilt_pid = PIDAxis(
            kp=config.kp_tilt,
            ki=config.ki_tilt,
            kd=config.kd_tilt,
            output_limit=config.max_tilt_rate_deg_s,
            integral_limit=config.integral_windup_limit,
            derivative_alpha=config.derivative_filter_alpha,
            deadband=0.01,
        )

    def reset(self):
        """Resets both Pan and Tilt PID states."""
        self.pan_pid.reset()
        self.tilt_pid.reset()

    def update_config(self, config: ControlConfig):
        self.config = config
        self.pan_pid.update_gains(config.kp_pan, config.ki_pan, config.kd_pan)
        self.pan_pid.output_limit = config.max_pan_rate_deg_s
        self.pan_pid.integral_limit = config.integral_windup_limit

        self.tilt_pid.update_gains(config.kp_tilt, config.ki_tilt, config.kd_tilt)
        self.tilt_pid.output_limit = config.max_tilt_rate_deg_s
        self.tilt_pid.integral_limit = config.integral_windup_limit

    def compute_control(
        self, error_x_deg: float, error_y_deg: float, dt: float
    ) -> Tuple[float, float]:
        """
        Computes pan and tilt gimbal rate commands (deg/s) from angular pointing errors.
        In camera coordinates:
          - Positive azimuth error (beacon to the right) requires positive pan rate.
          - Positive elevation error (beacon above boresight, which maps to -Ey in FPA pinhole)
            requires positive tilt rate.
        Returns:
            (pan_rate_cmd_deg_s, tilt_rate_cmd_deg_s)
        """
        if self.config.mode == "Open Loop":
            return 0.0, 0.0

        pan_cmd = self.pan_pid.compute(error_x_deg, dt)
        tilt_cmd = self.tilt_pid.compute(error_y_deg, dt)
        return pan_cmd, tilt_cmd

    def get_diagnostics(self) -> Dict[str, Any]:
        """Returns diagnostic telemetry for both control axes."""
        return {
            "pan": {
                "p": round(self.pan_pid.p_term, 3),
                "i": round(self.pan_pid.i_term, 3),
                "d": round(self.pan_pid.d_term, 3),
                "cmd": round(self.pan_pid.output, 3),
                "saturated": self.pan_pid.is_saturated,
            },
            "tilt": {
                "p": round(self.tilt_pid.p_term, 3),
                "i": round(self.tilt_pid.i_term, 3),
                "d": round(self.tilt_pid.d_term, 3),
                "cmd": round(self.tilt_pid.output, 3),
                "saturated": self.tilt_pid.is_saturated,
            },
        }
