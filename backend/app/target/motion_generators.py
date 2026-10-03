"""
motion_generators.py
====================
3D Kinematic Trajectory Generators for FSOC Mobile Terminal Beacon Simulation.

Supported motion patterns (8 total):
  1. Straight Line   — constant-velocity linear motion across 3D world space
  2. Circular        — Archimedean circle in the XY plane at fixed Z
  3. Figure of 8     — Lissajous figure-of-eight trajectory
  4. Random          — Bounded Brownian / random-walk motion
  5. Spiral          — expanding Archimedean spiral in XY at fixed Z
  6. Sinusoidal      — sinusoidal lateral oscillation along X-axis
  7. Waypoint        — discrete waypoint-to-waypoint interpolation
  8. User-defined    — alias for Sinusoidal (custom entry point)

Each generator implements:
    reset(initial_mode)  -> None
    evaluate(dt)         -> (pos, vel, acc) tuples of (x, y, z)
"""

import math
import random
from typing import Tuple, List, Optional


# Type aliases
Vec3 = Tuple[float, float, float]


class BaseTrajectory:
    """Abstract base class for all trajectory generators."""

    def __init__(self, cx: float = 1000.0, cy: float = 1000.0, cz: float = 1000.0,
                 speed: float = 40.0, world_width: float = 2000.0, world_height: float = 2000.0,
                 world_depth: float = 2000.0):
        self.cx = cx
        self.cy = cy
        self.cz = cz
        self.speed = speed
        self.world_width = world_width
        self.world_height = world_height
        self.world_depth = world_depth

        # Kinematic state
        self.x = cx
        self.y = cy
        self.z = cz
        self.vx = 0.0
        self.vy = 0.0
        self.vz = 0.0
        self.ax = 0.0
        self.ay = 0.0
        self.az = 0.0
        self.t = 0.0

    def reset(self, initial_mode: str = "Random"):
        """Resets trajectory to initial conditions."""
        if initial_mode == "Center":
            self.x, self.y, self.z = self.cx, self.cy, self.cz
        elif initial_mode == "Manual":
            pass  # Caller sets position externally
        else:  # "Random"
            margin = 200.0
            self.x = random.uniform(margin, self.world_width - margin)
            self.y = random.uniform(margin, self.world_height - margin)
            self.z = self.cz
        self.vx = self.vy = self.vz = 0.0
        self.ax = self.ay = self.az = 0.0
        self.t = 0.0

    def evaluate(self, dt: float) -> Tuple[Vec3, Vec3, Vec3]:
        """
        Advances trajectory by dt seconds.
        Returns:
            (position, velocity, acceleration) each as (x, y, z) tuple.
        """
        raise NotImplementedError

    def _clamp_world(self):
        """Clamps position within world bounds."""
        margin = 50.0
        self.x = max(margin, min(self.world_width - margin, self.x))
        self.y = max(margin, min(self.world_height - margin, self.y))
        self.z = max(100.0, min(self.world_depth - 100.0, self.z))


class StraightLineTrajectory(BaseTrajectory):
    """Constant-velocity linear motion. Reverses direction at world boundaries."""

    def reset(self, initial_mode: str = "Random"):
        super().reset(initial_mode)
        angle = random.uniform(0, 2 * math.pi)
        self.vx = self.speed * math.cos(angle)
        self.vy = self.speed * math.sin(angle)
        self.vz = 0.0

    def evaluate(self, dt: float) -> Tuple[Vec3, Vec3, Vec3]:
        self.t += dt
        prev_x, prev_y = self.x, self.y

        self.x += self.vx * dt
        self.y += self.vy * dt
        self.z += self.vz * dt

        # Reflect at boundaries
        margin = 50.0
        if self.x <= margin or self.x >= self.world_width - margin:
            self.vx *= -1
            self.x = max(margin, min(self.world_width - margin, self.x))
        if self.y <= margin or self.y >= self.world_height - margin:
            self.vy *= -1
            self.y = max(margin, min(self.world_height - margin, self.y))

        self.ax = (self.vx - (self.x - prev_x) / dt) / dt if dt > 0 else 0.0
        self.ay = (self.vy - (self.y - prev_y) / dt) / dt if dt > 0 else 0.0
        self.az = 0.0

        return (self.x, self.y, self.z), (self.vx, self.vy, self.vz), (self.ax, self.ay, self.az)


class CircularTrajectory(BaseTrajectory):
    """Circular orbit in XY-plane at fixed Z depth scaled to sensor FOV."""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        # Sized within camera FOV (~70m x 52m at 1000m range)
        self.radius = 15.0
        self.angular_speed = 0.05  # ~2.8 deg/s angular rate
        self.theta = 0.0

    def reset(self, initial_mode: str = "Random"):
        super().reset(initial_mode)
        self.theta = random.uniform(0, 2 * math.pi) if initial_mode == "Random" else 0.0
        if initial_mode == "Center":
            self.x = self.cx
            self.y = self.cy
        else:
            self.x = self.cx + self.radius * (math.cos(self.theta) - 1.0)
            self.y = self.cy + self.radius * math.sin(self.theta)

    def evaluate(self, dt: float) -> Tuple[Vec3, Vec3, Vec3]:
        self.t += dt
        self.theta += self.angular_speed * dt

        self.x = self.cx + self.radius * (math.cos(self.theta) - 1.0)
        self.y = self.cy + self.radius * math.sin(self.theta)
        self.z = self.cz

        self.vx = -self.radius * self.angular_speed * math.sin(self.theta)
        self.vy = self.radius * self.angular_speed * math.cos(self.theta)
        self.vz = 0.0

        self.ax = -self.radius * self.angular_speed ** 2 * math.cos(self.theta)
        self.ay = -self.radius * self.angular_speed ** 2 * math.sin(self.theta)
        self.az = 0.0

        return (self.x, self.y, self.z), (self.vx, self.vy, self.vz), (self.ax, self.ay, self.az)


class FigureOf8Trajectory(BaseTrajectory):
    """Lissajous figure-of-8 (2:1 frequency ratio) trajectory scaled to sensor FOV."""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        # Sized within camera FOV (~70m x 52m at 1000m range)
        self.amplitude_x = 20.0
        self.amplitude_y = 12.0
        self.omega = self.speed / 500.0

    def reset(self, initial_mode: str = "Random"):
        super().reset(initial_mode)
        self.t = random.uniform(0, 2 * math.pi) if initial_mode == "Random" else 0.0
        if initial_mode == "Center":
            self.x = self.cx
            self.y = self.cy
        else:
            self.x = self.cx + self.amplitude_x * math.sin(self.omega * self.t)
            self.y = self.cy + self.amplitude_y * math.sin(2 * self.omega * self.t)

    def evaluate(self, dt: float) -> Tuple[Vec3, Vec3, Vec3]:
        self.t += dt
        t = self.t

        self.x = self.cx + self.amplitude_x * math.sin(self.omega * t)
        self.y = self.cy + self.amplitude_y * math.sin(2 * self.omega * t)
        self.z = self.cz

        self.vx = self.amplitude_x * self.omega * math.cos(self.omega * t)
        self.vy = 2 * self.amplitude_y * self.omega * math.cos(2 * self.omega * t)
        self.vz = 0.0

        self.ax = -self.amplitude_x * self.omega ** 2 * math.sin(self.omega * t)
        self.ay = -4 * self.amplitude_y * self.omega ** 2 * math.sin(2 * self.omega * t)
        self.az = 0.0

        return (self.x, self.y, self.z), (self.vx, self.vy, self.vz), (self.ax, self.ay, self.az)


class RandomTrajectory(BaseTrajectory):
    """Bounded random-walk motion with smooth velocity transitions."""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self._target_vx = 0.0
        self._target_vy = 0.0
        self._update_interval = 0.5  # seconds between direction changes
        self._time_since_update = 0.0

    def reset(self, initial_mode: str = "Random"):
        super().reset(initial_mode)
        self._randomise_velocity()
        self._time_since_update = 0.0

    def _randomise_velocity(self):
        angle = random.uniform(0, 2 * math.pi)
        speed = random.uniform(self.speed * 0.3, self.speed)
        self._target_vx = speed * math.cos(angle)
        self._target_vy = speed * math.sin(angle)

    def evaluate(self, dt: float) -> Tuple[Vec3, Vec3, Vec3]:
        self.t += dt
        self._time_since_update += dt

        if self._time_since_update >= self._update_interval:
            self._randomise_velocity()
            self._time_since_update = 0.0

        # Smooth velocity interpolation
        alpha = min(dt * 3.0, 1.0)
        self.vx += alpha * (self._target_vx - self.vx)
        self.vy += alpha * (self._target_vy - self.vy)

        prev_vx, prev_vy = self.vx, self.vy
        self.x += self.vx * dt
        self.y += self.vy * dt
        self.z = self.cz

        self.ax = (self.vx - prev_vx) / dt if dt > 0 else 0.0
        self.ay = (self.vy - prev_vy) / dt if dt > 0 else 0.0
        self.az = 0.0

        # Bounce at boundaries
        margin = 100.0
        if self.x <= margin or self.x >= self.world_width - margin:
            self.vx *= -1
            self._target_vx *= -1
            self.x = max(margin, min(self.world_width - margin, self.x))
        if self.y <= margin or self.y >= self.world_height - margin:
            self.vy *= -1
            self._target_vy *= -1
            self.y = max(margin, min(self.world_height - margin, self.y))

        return (self.x, self.y, self.z), (self.vx, self.vy, self.vz), (self.ax, self.ay, self.az)


class SpiralTrajectory(BaseTrajectory):
    """Expanding Archimedean spiral in XY-plane at fixed Z."""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.max_radius = min(self.world_width, self.world_height) * 0.35
        self.angular_speed = self.speed / 100.0
        self.expansion_rate = self.max_radius / (2 * math.pi * 5)  # 5 revolutions to expand

    def reset(self, initial_mode: str = "Random"):
        super().reset(initial_mode)
        self.t = 0.0
        self.x = self.cx
        self.y = self.cy

    def evaluate(self, dt: float) -> Tuple[Vec3, Vec3, Vec3]:
        self.t += dt
        t = self.t

        # Archimedean spiral: r = expansion_rate * theta
        theta = self.angular_speed * t
        r = (self.expansion_rate * theta) % self.max_radius

        self.x = self.cx + r * math.cos(theta)
        self.y = self.cy + r * math.sin(theta)
        self.z = self.cz

        dr_dt = self.expansion_rate * self.angular_speed
        dtheta_dt = self.angular_speed

        self.vx = dr_dt * math.cos(theta) - r * dtheta_dt * math.sin(theta)
        self.vy = dr_dt * math.sin(theta) + r * dtheta_dt * math.cos(theta)
        self.vz = 0.0

        self.ax = -r * dtheta_dt ** 2 * math.cos(theta)
        self.ay = -r * dtheta_dt ** 2 * math.sin(theta)
        self.az = 0.0

        return (self.x, self.y, self.z), (self.vx, self.vy, self.vz), (self.ax, self.ay, self.az)


class SinusoidalTrajectory(BaseTrajectory):
    """Sinusoidal oscillation — linear progression along X with sinusoidal Y deviation."""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.amplitude = self.world_height * 0.20
        self.frequency = self.speed / (2 * math.pi * self.world_width * 0.1)
        self.vx_base = self.speed * 0.5

    def reset(self, initial_mode: str = "Random"):
        super().reset(initial_mode)
        self.t = 0.0
        if initial_mode == "Center":
            self.x, self.y, self.z = self.cx, self.cy, self.cz
        elif initial_mode == "Random":
            self.x = random.uniform(200.0, 800.0)
            self.y = self.cy
            self.z = self.cz

    def evaluate(self, dt: float) -> Tuple[Vec3, Vec3, Vec3]:
        self.t += dt

        self.x += self.vx_base * dt
        if self.x > self.world_width - 100.0:
            self.x = 100.0  # wrap around

        self.y = self.cy + self.amplitude * math.sin(2 * math.pi * self.frequency * self.t)
        self.z = self.cz

        self.vx = self.vx_base
        self.vy = self.amplitude * 2 * math.pi * self.frequency * math.cos(2 * math.pi * self.frequency * self.t)
        self.vz = 0.0

        self.ax = 0.0
        self.ay = -self.amplitude * (2 * math.pi * self.frequency) ** 2 * math.sin(2 * math.pi * self.frequency * self.t)
        self.az = 0.0

        return (self.x, self.y, self.z), (self.vx, self.vy, self.vz), (self.ax, self.ay, self.az)


class WaypointTrajectory(BaseTrajectory):
    """Discrete waypoint-to-waypoint interpolation at constant speed."""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self._waypoints: List[Vec3] = []
        self._wp_idx = 0
        self._generate_waypoints()

    def _generate_waypoints(self):
        margin = 200.0
        self._waypoints = [
            (margin, margin, self.cz),
            (self.world_width - margin, margin, self.cz),
            (self.world_width - margin, self.world_height - margin, self.cz),
            (margin, self.world_height - margin, self.cz),
            (self.cx, self.cy, self.cz),
        ]

    def reset(self, initial_mode: str = "Random"):
        super().reset(initial_mode)
        self._wp_idx = 0
        if self._waypoints:
            wp = self._waypoints[0]
            self.x, self.y, self.z = wp

    def evaluate(self, dt: float) -> Tuple[Vec3, Vec3, Vec3]:
        self.t += dt
        if not self._waypoints:
            return (self.x, self.y, self.z), (0.0, 0.0, 0.0), (0.0, 0.0, 0.0)

        target = self._waypoints[self._wp_idx % len(self._waypoints)]
        tx, ty, tz = target
        dx, dy, dz = tx - self.x, ty - self.y, tz - self.z
        dist = math.sqrt(dx * dx + dy * dy + dz * dz)

        if dist < self.speed * dt:
            self.x, self.y, self.z = tx, ty, tz
            self._wp_idx = (self._wp_idx + 1) % len(self._waypoints)
            self.vx = self.vy = self.vz = 0.0
        else:
            prev_vx, prev_vy = self.vx, self.vy
            self.vx = dx / dist * self.speed
            self.vy = dy / dist * self.speed
            self.vz = 0.0
            self.x += self.vx * dt
            self.y += self.vy * dt
            self.ax = (self.vx - prev_vx) / dt if dt > 0 else 0.0
            self.ay = (self.vy - prev_vy) / dt if dt > 0 else 0.0

        return (self.x, self.y, self.z), (self.vx, self.vy, self.vz), (self.ax, self.ay, self.az)


class CustomPathTrajectory(BaseTrajectory):
    """
    User-drawn closed loop path trajectory.

    The user supplies an ordered list of 2D world-space (x, y) waypoints.
    The first waypoint is automatically appended at the end to guarantee
    path closure (continuous looping). The beacon travels between consecutive
    waypoints at constant speed, cycling forever.
    """

    def __init__(self, waypoints_xy: List[Tuple[float, float]], **kwargs):
        super().__init__(**kwargs)
        self._raw_waypoints = waypoints_xy
        self._waypoints: List[Vec3] = []
        self._wp_idx = 0
        self._build_closed_path()

    def _build_closed_path(self):
        """Converts (x,y) pairs to Vec3 tuples and closes the loop."""
        if not self._raw_waypoints:
            self._waypoints = [(self.cx, self.cy, self.cz)]
            return

        wps = [(float(x), float(y), self.cz) for x, y in self._raw_waypoints]
        # Close the loop: append the first point at the end
        if wps[0] != wps[-1]:
            wps.append(wps[0])
        self._waypoints = wps

    def set_waypoints(self, waypoints_xy: List[Tuple[float, float]]):
        """Updates the path in real-time without reinitialising the generator."""
        self._raw_waypoints = waypoints_xy
        self._wp_idx = 0
        self._build_closed_path()
        if self._waypoints:
            self.x, self.y, self.z = self._waypoints[0]
            self.vx = self.vy = self.vz = 0.0

    def reset(self, initial_mode: str = "Random"):
        self._wp_idx = 0
        if self._waypoints:
            self.x, self.y, self.z = self._waypoints[0]
        self.vx = self.vy = self.vz = 0.0
        self.ax = self.ay = self.az = 0.0
        self.t = 0.0

    def evaluate(self, dt: float) -> Tuple[Vec3, Vec3, Vec3]:
        self.t += dt
        if not self._waypoints or len(self._waypoints) < 2:
            return (self.x, self.y, self.z), (0.0, 0.0, 0.0), (0.0, 0.0, 0.0)

        target = self._waypoints[self._wp_idx % len(self._waypoints)]
        tx, ty, tz = target
        dx, dy, dz = tx - self.x, ty - self.y, tz - self.z
        dist = math.sqrt(dx * dx + dy * dy + dz * dz)

        if dist < max(self.speed * dt, 1.0):
            # Snapped to waypoint — advance to next
            self.x, self.y, self.z = tx, ty, tz
            self._wp_idx = (self._wp_idx + 1) % len(self._waypoints)
            self.vx = self.vy = self.vz = 0.0
            self.ax = self.ay = self.az = 0.0
        else:
            prev_vx, prev_vy = self.vx, self.vy
            self.vx = dx / dist * self.speed
            self.vy = dy / dist * self.speed
            self.vz = 0.0
            self.x += self.vx * dt
            self.y += self.vy * dt
            self.ax = (self.vx - prev_vx) / dt if dt > 0 else 0.0
            self.ay = (self.vy - prev_vy) / dt if dt > 0 else 0.0

        return (self.x, self.y, self.z), (self.vx, self.vy, self.vz), (self.ax, self.ay, self.az)


class UserDefinedTrajectory(SinusoidalTrajectory):
    """
    User-defined trajectory entry point.
    Defaults to sinusoidal motion; can be extended or overridden.
    """
    pass


def create_motion_generator(
    trajectory_type: str,
    cx: float = 1000.0,
    cy: float = 1000.0,
    cz: float = 1000.0,
    speed: float = 40.0,
    world_width: float = 2000.0,
    world_height: float = 2000.0,
    world_depth: float = 2000.0,
) -> BaseTrajectory:
    """
    Factory: creates and returns the correct trajectory generator for the given type.

    Args:
        trajectory_type: One of the 8 supported motion patterns.
        cx, cy, cz:      World-space center point / origin for the trajectory.
        speed:           Nominal target speed (pixels/second in world space).
        world_width/height/depth: World bounding box dimensions.

    Returns:
        Initialised BaseTrajectory subclass instance.
    """
    kwargs = dict(cx=cx, cy=cy, cz=cz, speed=speed,
                  world_width=world_width, world_height=world_height, world_depth=world_depth)

    mapping = {
        "Straight Line": StraightLineTrajectory,
        "Circular": CircularTrajectory,
        "Figure of 8": FigureOf8Trajectory,
        "Random": RandomTrajectory,
        "Spiral": SpiralTrajectory,
        "Sinusoidal": SinusoidalTrajectory,
        "Waypoint": WaypointTrajectory,
        "Custom Path": CustomPathTrajectory,
        "User-defined": UserDefinedTrajectory,
    }

    if trajectory_type == "Custom Path":
        # Custom path requires waypoints — factory returns empty path (caller must call set_waypoints)
        return CustomPathTrajectory(waypoints_xy=[], **kwargs)

    cls = mapping.get(trajectory_type, StraightLineTrajectory)
    return cls(**kwargs)
