"""
optical_disturbance_engine.py
=============================
Part 6: Disturbance and Noise Engine for Mobile Free Space Optical Communication (FSOC).

Simulates realistic, difficult real-world optical channel disturbances, sensor degradation,
platform vibrations, and meteorological attenuation:
1. Multi-noise engine (Salt & Pepper, Gaussian, Poisson simultaneously, <= 20 px std dev).
2. Camera jitter (+/-20 pixels/frame maximum).
3. Physics-based atmospheric conditions (Clear, Haze, Fog, Rain, Low Light).
   Affects: brightness, contrast, visibility, beacon signal, and image quality.
4. Mobile platform motion (Linear, Sinusoidal, Circular, Random, Spiral, Figure of 8, <= 20 px/frame).
5. Other optical channel disturbances:
   - Dynamic motion blur
   - Optical beacon flicker modulation
   - Temporary line-of-sight occlusion (forces Kalman filter coasting)
   - Sudden camera shock / wind gust impulse
   - Ambient brightness fluctuation
   - Controllable SNR reduction
6. Predefined benchmark evaluation test scenarios:
   Normal, High Noise, High Jitter, Haze, Fog, Rain, Low Light, Fast Motion, Combined Disturbance.
"""

import math
import random
from typing import Tuple, List, Optional, Dict, Any
import numpy as np
import cv2

from backend.app.models.config_model import DisturbanceConfig, CameraConfig
from backend.app.models.telemetry_model import DisturbanceTelemetry


class OpticalDisturbanceEngine:
    """
    Comprehensive physical disturbance engine for mobile FSOC terminal tracking testbench.
    Directly affects the generated camera frames and camera projection kinematics.
    """

    def __init__(self, config: DisturbanceConfig, camera_config: Optional[CameraConfig] = None):
        self.config = config
        self.camera_config = camera_config or CameraConfig()

        # State tracking for continuous temporal effects
        self.sim_time = 0.0
        self.jitter_offset_x = 0.0
        self.jitter_offset_y = 0.0
        self.platform_offset_x = 0.0
        self.platform_offset_y = 0.0
        self.sudden_offset_x = 0.0
        self.sudden_offset_y = 0.0
        self.sudden_decay = 0.0

        # Occlusion management
        self.is_occluded = False
        self.manual_occlusion_remaining = 0.0
        self.last_occlusion_toggle_time = 0.0

        # Rain streaks persistence mask (for coherent precipitation animation)
        self._rain_streaks: Optional[np.ndarray] = None
        self._last_rain_update = 0.0

        # Random seed state for reproducibility
        self.rng = np.random.default_rng(seed=42)

    def update_config(self, config: DisturbanceConfig, camera_config: Optional[CameraConfig] = None):
        self.config = config
        if camera_config:
            self.camera_config = camera_config

    def trigger_temporary_occlusion(self, duration_s: Optional[float] = None):
        """Manually triggers an optical obstruction event for duration_s."""
        dur = duration_s or self.config.occlusion_duration_s
        self.manual_occlusion_remaining = dur
        self.is_occluded = True

    # =========================================================================
    # 1. Presets / Test Scenarios Implementation
    # =========================================================================

    def apply_preset(self, scenario_name: str):
        """Configures all parameters to match the chosen benchmark scenario."""
        cfg = self.config
        cfg.preset_scenario = scenario_name

        # Reset all disturbance flags to false baseline
        cfg.gaussian_noise_enabled = False
        cfg.salt_pepper_enabled = False
        cfg.poisson_noise_enabled = False
        cfg.camera_jitter_enabled = False
        cfg.platform_motion_enabled = False
        cfg.motion_blur_enabled = False
        cfg.beacon_flicker_enabled = False
        cfg.temporary_occlusion_enabled = False
        cfg.sudden_camera_movement_enabled = False
        cfg.brightness_fluctuation_enabled = False
        cfg.camera_jitter_max_px = 0.0
        cfg.platform_motion_max_px = 0.0
        cfg.noise_std_dev = 3.0
        cfg.atmospheric_condition = "Clear"
        cfg.atmospheric_extinction_coeff = 0.05
        cfg.fog_density = 0.0
        cfg.rain_rate_mm_hr = 0.0
        cfg.ambient_light_factor = 1.0
        cfg.snr_reduction_db = 0.0
        self.is_occluded = False
        self.manual_occlusion_remaining = 0.0

        if scenario_name == "Normal":
            cfg.atmospheric_condition = "Clear"
            cfg.noise_type = "None"

        elif scenario_name == "High Noise":
            cfg.noise_type = "Multi-Noise"
            cfg.gaussian_noise_enabled = True
            cfg.salt_pepper_enabled = True
            cfg.poisson_noise_enabled = True
            cfg.noise_std_dev = 18.0  # Max limit <= 20 px
            cfg.salt_pepper_ratio = 0.04
            cfg.snr_reduction_db = 12.0

        elif scenario_name == "High Jitter":
            cfg.camera_jitter_enabled = True
            cfg.camera_jitter_max_px = 18.0  # Max limit <= 20 px
            cfg.camera_jitter_frequency_hz = 18.0
            cfg.noise_std_dev = 5.0

        elif scenario_name == "Haze":
            cfg.atmospheric_condition = "Haze"
            cfg.atmospheric_extinction_coeff = 0.65
            cfg.gaussian_noise_enabled = True
            cfg.noise_std_dev = 6.0
            cfg.brightness_fluctuation_enabled = True

        elif scenario_name == "Fog":
            cfg.atmospheric_condition = "Fog"
            cfg.atmospheric_extinction_coeff = 1.85
            cfg.fog_density = 0.85
            cfg.gaussian_noise_enabled = True
            cfg.noise_std_dev = 8.0
            cfg.snr_reduction_db = 15.0

        elif scenario_name == "Rain":
            cfg.atmospheric_condition = "Rain"
            cfg.rain_rate_mm_hr = 45.0
            cfg.gaussian_noise_enabled = True
            cfg.noise_std_dev = 9.0
            cfg.camera_jitter_enabled = True
            cfg.camera_jitter_max_px = 4.0

        elif scenario_name == "Low Light":
            cfg.atmospheric_condition = "Low Light"
            cfg.ambient_light_factor = 0.15
            cfg.poisson_noise_enabled = True
            cfg.noise_std_dev = 12.0
            cfg.snr_reduction_db = 18.0

        elif scenario_name == "Fast Motion":
            cfg.platform_motion_enabled = True
            cfg.platform_motion_type = "Sinusoidal"
            cfg.platform_motion_max_px = 18.0  # Max limit <= 20 px
            cfg.platform_motion_frequency_hz = 1.5
            cfg.motion_blur_enabled = True
            cfg.motion_blur_kernel_size = 9

        elif scenario_name == "Combined Disturbance":
            cfg.atmospheric_condition = "Fog"
            cfg.fog_density = 0.75
            cfg.noise_type = "Multi-Noise"
            cfg.gaussian_noise_enabled = True
            cfg.salt_pepper_enabled = True
            cfg.poisson_noise_enabled = True
            cfg.noise_std_dev = 14.0
            cfg.camera_jitter_enabled = True
            cfg.camera_jitter_max_px = 12.0
            cfg.camera_jitter_frequency_hz = 14.0
            cfg.platform_motion_enabled = True
            cfg.platform_motion_type = "Circular"
            cfg.platform_motion_max_px = 12.0
            cfg.beacon_flicker_enabled = True
            cfg.beacon_flicker_depth = 0.6
            cfg.motion_blur_enabled = True
            cfg.motion_blur_kernel_size = 7
            cfg.snr_reduction_db = 16.0

    # =========================================================================
    # 2. Camera Jitter & Platform Kinematics Perturbations
    # =========================================================================

    def compute_instantaneous_jitter(self, dt: float) -> Tuple[float, float]:
        """
        Computes high-frequency mechanical camera vibration jitter (+/-20 px maximum).
        Harmonic model with randomized sub-harmonics.
        """
        if not self.config.camera_jitter_enabled or self.config.camera_jitter_max_px <= 0.0:
            self.jitter_offset_x = 0.0
            self.jitter_offset_y = 0.0
            return 0.0, 0.0

        amp = min(self.config.camera_jitter_max_px, 20.0)
        freq = self.config.camera_jitter_frequency_hz
        t = self.sim_time

        # Multi-harmonic band-limited vibration synthesis
        w1 = 2.0 * math.pi * freq
        w2 = 2.0 * math.pi * (freq * 0.618)
        w3 = 2.0 * math.pi * (freq * 1.732)

        jx = (
            math.sin(w1 * t) * 0.55
            + math.sin(w2 * t + 1.1) * 0.30
            + math.cos(w3 * t + 2.3) * 0.15
            + random.uniform(-0.08, 0.08)
        )
        jy = (
            math.cos(w1 * t + 0.5) * 0.55
            + math.cos(w2 * t + 2.2) * 0.30
            + math.sin(w3 * t + 0.7) * 0.15
            + random.uniform(-0.08, 0.08)
        )

        self.jitter_offset_x = float(np.clip(jx * amp, -amp, amp))
        self.jitter_offset_y = float(np.clip(jy * amp, -amp, amp))
        return self.jitter_offset_x, self.jitter_offset_y

    def compute_platform_motion(self, dt: float) -> Tuple[float, float]:
        """
        Computes mobile FSOC terminal base displacement (+/-20 px maximum).
        Supports: Linear, Sinusoidal, Circular, Random, Spiral, Figure of 8.
        """
        if not self.config.platform_motion_enabled or self.config.platform_motion_max_px <= 0.0:
            self.platform_offset_x = 0.0
            self.platform_offset_y = 0.0
            return 0.0, 0.0

        amp = min(self.config.platform_motion_max_px, 20.0)
        freq = self.config.platform_motion_frequency_hz
        t = self.sim_time
        omega = 2.0 * math.pi * freq
        m_type = self.config.platform_motion_type

        if m_type == "Linear":
            # Linear periodic triangular sweep
            phase = (t * freq) % 1.0
            sweep = 4.0 * abs(phase - 0.5) - 1.0  # -1 to +1
            px = sweep * amp
            py = (sweep * 0.5) * amp

        elif m_type == "Sinusoidal":
            px = math.sin(omega * t) * amp
            py = math.cos(omega * t * 0.7) * (amp * 0.6)

        elif m_type == "Circular":
            px = math.cos(omega * t) * amp
            py = math.sin(omega * t) * amp

        elif m_type == "Figure of 8":
            px = math.sin(omega * t) * amp
            py = math.sin(2.0 * omega * t) * (amp * 0.5)

        elif m_type == "Spiral":
            r_scale = 0.5 + 0.5 * math.sin(0.2 * omega * t)
            px = math.cos(omega * t) * (amp * r_scale)
            py = math.sin(omega * t) * (amp * r_scale)

        elif m_type == "Random":
            # Filtered random walk
            step_x = random.uniform(-1.5, 1.5)
            step_y = random.uniform(-1.5, 1.5)
            px = float(np.clip(self.platform_offset_x + step_x, -amp, amp))
            py = float(np.clip(self.platform_offset_y + step_y, -amp, amp))

        else:
            px, py = 0.0, 0.0

        self.platform_offset_x = float(np.clip(px, -amp, amp))
        self.platform_offset_y = float(np.clip(py, -amp, amp))
        return self.platform_offset_x, self.platform_offset_y

    def compute_sudden_shock(self, dt: float) -> Tuple[float, float]:
        """Simulates sudden step impulse shock / wind gust on gimbal."""
        if not self.config.sudden_camera_movement_enabled:
            self.sudden_offset_x = 0.0
            self.sudden_offset_y = 0.0
            return 0.0, 0.0

        # Trigger periodic sudden impulse every ~4 seconds
        if (self.sim_time % 4.0) < dt:
            amp = min(self.config.sudden_movement_max_px, 20.0)
            angle = random.uniform(0, 2 * math.pi)
            self.sudden_offset_x = math.cos(angle) * amp
            self.sudden_offset_y = math.sin(angle) * amp
            self.sudden_decay = 1.0

        # Exponential decay of shock displacement
        if self.sudden_decay > 0.01:
            self.sudden_decay *= math.exp(-8.0 * dt)
            sx = self.sudden_offset_x * self.sudden_decay
            sy = self.sudden_offset_y * self.sudden_decay
            return sx, sy
        return 0.0, 0.0

    def step_temporal_kinematics(self, dt: float) -> Tuple[float, float]:
        """
        Advances disturbance simulation clock and computes cumulative (dx, dy)
        pixel displacement perturbation on camera image / projection.
        Total combined displacement is clamped to +/-20.0 pixels.
        """
        self.sim_time += dt

        # Update occlusion timers
        if self.manual_occlusion_remaining > 0:
            self.manual_occlusion_remaining -= dt
            self.is_occluded = True
        elif self.config.temporary_occlusion_enabled:
            # Periodic occlusion cycling (e.g. cloud obstruction every occlusion_period_s)
            cycle = self.sim_time % max(2.0, self.config.occlusion_period_s)
            self.is_occluded = cycle < self.config.occlusion_duration_s
        else:
            self.is_occluded = False

        jx, jy = self.compute_instantaneous_jitter(dt)
        px, py = self.compute_platform_motion(dt)
        sx, sy = self.compute_sudden_shock(dt)

        total_dx = np.clip(jx + px + sx, -20.0, 20.0)
        total_dy = np.clip(jy + py + sy, -20.0, 20.0)
        return float(total_dx), float(total_dy)

    # =========================================================================
    # 3. Atmospheric Radiative Transfer & Signal Transmission
    # =========================================================================

    def compute_atmospheric_effects(
        self, beacon_intensity: float, depth_m: float = 1000.0, atmosphere_path_frac: float = 1.0
    ) -> Tuple[float, float, float, float]:
        """
        Calculates physical Beer-Lambert atmospheric transmittance, contrast factor,
        path radiance wash, and modified beacon peak radiant intensity.
        Per Part 3: Scales in proportion to atmosphere_path_frac (fraction 0 means none/vacuum).
        Returns:
            (transmittance, contrast_scale, path_radiance, effective_intensity)
        """
        # Vacuum case: If no atmosphere on path, zero atmospheric degradation
        if atmosphere_path_frac <= 1e-6:
            snr_att = 1.0
            if self.config.snr_reduction_db > 0.0:
                snr_att = 10.0 ** (-self.config.snr_reduction_db / 20.0)
            transmittance = snr_att if not self.is_occluded else 0.0
            contrast_scale = 1.0
            path_radiance = 0.0
            amb_factor = 1.0
            self.last_transmittance = transmittance
            self.last_amb_factor = amb_factor
            self.last_vis_km = 999.0
            eff_intensity = float(np.clip(beacon_intensity * transmittance * amb_factor, 0.0, 255.0))
            return transmittance, contrast_scale, path_radiance, eff_intensity

        cond = self.config.atmospheric_condition
        range_km = max(0.1, depth_m / 1000.0)

        if cond == "Clear":
            beta = 0.05
            contrast_scale = 1.0
            path_radiance = 0.0
            amb_factor = self.config.ambient_light_factor

        elif cond == "Haze":
            beta = 0.45 * (self.config.atmospheric_extinction_coeff / 0.05)
            contrast_scale = 0.68
            path_radiance = 25.0
            amb_factor = 0.95 * self.config.ambient_light_factor

        elif cond == "Fog":
            beta = 1.85 * (self.config.fog_density / 0.5)
            contrast_scale = 0.38
            path_radiance = 60.0  # Intense diffuse path radiance wash
            amb_factor = 0.80

        elif cond == "Rain":
            # Marshall-Palmer empirical extinction: beta = 0.25 * (R_mm_hr ** 0.63)
            r_rate = self.config.rain_rate_mm_hr
            beta = 0.25 * (r_rate ** 0.63)
            contrast_scale = 0.60
            path_radiance = 35.0
            amb_factor = 0.70

        elif cond == "Low Light":
            beta = 0.08
            contrast_scale = 0.50
            path_radiance = -10.0  # Very dark ambient background
            amb_factor = max(0.05, self.config.ambient_light_factor * 0.18)

        else:
            beta = 0.05
            contrast_scale = 1.0
            path_radiance = 0.0
            amb_factor = 1.0

        # Scale effects linearly with atmosphere path fraction
        frac = min(1.0, max(0.0, atmosphere_path_frac))
        beta = beta * frac
        contrast_scale = 1.0 - (1.0 - contrast_scale) * frac
        path_radiance = path_radiance * frac
        amb_factor = 1.0 - (1.0 - amb_factor) * frac

        # Beer-Lambert transmission: T = exp(-beta * R)
        transmittance = float(np.clip(math.exp(-beta * range_km), 0.02, 1.0))

        # Forced SNR reduction attenuation if set
        if self.config.snr_reduction_db > 0.0:
            snr_att = 10.0 ** (-self.config.snr_reduction_db / 20.0)
            transmittance *= snr_att

        # If occlusion is active, beacon is completely blocked (T = 0)
        if self.is_occluded:
            transmittance = 0.0

        # Meteorological optical range (Koschmieder formula): V = 3.912 / beta (km)
        vis_km = float(np.clip(3.912 / max(0.001, beta), 0.5, 999.0))
        self.last_transmittance = transmittance
        self.last_amb_factor = amb_factor
        self.last_vis_km = vis_km

        # Effective radiant intensity arriving at aperture
        eff_intensity = float(np.clip(beacon_intensity * transmittance * amb_factor, 0.0, 255.0))
        return transmittance, contrast_scale, path_radiance, eff_intensity

    # =========================================================================
    # 4. Multi-Noise Engine (Gaussian, Salt & Pepper, Poisson)
    # =========================================================================

    def apply_sensor_noise(self, frame: np.ndarray) -> np.ndarray:
        """
        Applies multiple noise types simultaneously:
        - Gaussian Readout Noise (<= 20 px std dev)
        - Salt & Pepper Impulsive Noise
        - Poisson (Photon Shot) Noise
        """
        noisy = frame.astype(np.float32)
        applied_noises = []

        cfg = self.config
        noise_mode = cfg.noise_type
        is_multi = (noise_mode == "Multi-Noise")

        # 4.1 Additive Gaussian Noise
        apply_gauss = cfg.gaussian_noise_enabled or is_multi or (noise_mode == "Gaussian")
        sigma = min(cfg.noise_std_dev, 20.0)
        if apply_gauss and sigma > 0.1:
            gauss = self.rng.normal(loc=0.0, scale=sigma, size=frame.shape)
            noisy += gauss
            applied_noises.append("Gaussian")

        # 4.2 Poisson (Photon Shot) Noise
        apply_poisson = cfg.poisson_noise_enabled or is_multi or (noise_mode == "Poisson")
        if apply_poisson:
            # Normalize to photon scale, sample Poisson, scale back
            norm = np.maximum(noisy, 0.0) / 255.0
            scale = 40.0  # Photon flux count scaling
            poisson_sample = self.rng.poisson(norm * scale) / scale * 255.0
            # Blend 50/50 to preserve mean while injecting Poisson variance
            noisy = 0.5 * noisy + 0.5 * poisson_sample
            applied_noises.append("Poisson")

        # Clip back to 0-255 uint8 before Salt & Pepper
        noisy = np.clip(noisy, 0.0, 255.0).astype(np.uint8)

        # 4.3 Salt & Pepper Impulsive Noise
        apply_sp = cfg.salt_pepper_enabled or is_multi or (noise_mode == "Salt & Pepper")
        if apply_sp and cfg.salt_pepper_ratio > 0.001:
            ratio = min(cfg.salt_pepper_ratio, 0.20)
            rand_mask = self.rng.random(size=frame.shape[:2])

            # Pepper (black = 0)
            pepper_mask = rand_mask < (ratio / 2.0)
            noisy[pepper_mask] = 0

            # Salt (white = 255)
            salt_mask = (rand_mask >= (ratio / 2.0)) & (rand_mask < ratio)
            noisy[salt_mask] = 255
            applied_noises.append("Salt & Pepper")

        return noisy

    # =========================================================================
    # 5. Image Quality & Optical Degradations (Atmosphere, Blur, Rain, Occlusion)
    # =========================================================================

    def apply_atmospheric_image_degradation(
        self, frame: np.ndarray, contrast_scale: float, path_radiance: float, atmosphere_path_frac: float = 1.0
    ) -> np.ndarray:
        """
        Physically modifies contrast, atmospheric path radiance, and meteorological effects.
        Per Part 3: If atmosphere_path_frac == 0, returns frame untouched.
        """
        if atmosphere_path_frac <= 1e-6:
            return frame

        cond = self.config.atmospheric_condition
        h, w = frame.shape[:2]

        # 1. Contrast reduction & path radiance wash
        if abs(contrast_scale - 1.0) > 0.01 or abs(path_radiance) > 0.5:
            f_float = frame.astype(np.float32)
            # Contrast: scale around midpoint (128)
            f_float = (f_float - 128.0) * contrast_scale + 128.0 + path_radiance
            frame = np.clip(f_float, 0, 255).astype(np.uint8)

        # 2. Fog Mie Scattering Blur (scaled by atmosphere_path_frac)
        eff_fog = self.config.fog_density * atmosphere_path_frac
        if cond == "Fog" and eff_fog > 0.2:
            ksize = int(round(eff_fog * 6)) * 2 + 1
            frame = cv2.GaussianBlur(frame, (ksize, ksize), sigmaX=ksize / 2.5)

        # 3. Falling Rain Streaks Simulation
        if cond == "Rain" and self.config.rain_rate_mm_hr * atmosphere_path_frac > 5.0:
            frame = self._render_rain_streaks(frame)

        # 4. Brightness Fluctuation Drift
        if self.config.brightness_fluctuation_enabled:
            drift = math.sin(0.4 * self.sim_time) * min(self.config.brightness_fluctuation_amplitude, 50.0)
            frame = np.clip(frame.astype(np.float32) + drift, 0, 255).astype(np.uint8)

        return frame

    def _render_rain_streaks(self, frame: np.ndarray) -> np.ndarray:
        """Renders falling slanted precipitation streaks onto the frame."""
        h, w = frame.shape[:2]
        num_streaks = int(self.config.rain_rate_mm_hr * 4.0)

        # Generate sparse rain layer
        rain_layer = np.zeros((h, w), dtype=np.uint8)
        xs = self.rng.integers(0, w, size=num_streaks)
        ys = self.rng.integers(0, h - 20, size=num_streaks)
        lens = self.rng.integers(6, 18, size=num_streaks)

        for x, y, l in zip(xs, ys, lens):
            cv2.line(rain_layer, (x, y), (x + 3, y + l), 180, 1)

        # Motion blur rain lines slightly
        rain_layer = cv2.GaussianBlur(rain_layer, (3, 5), sigmaX=0.8)
        frame = cv2.add(frame, rain_layer)
        return frame

    def apply_motion_blur(self, frame: np.ndarray, pan_rate: float, tilt_rate: float) -> np.ndarray:
        """
        Applies dynamic directional motion blur convolved with the relative velocity vector.
        """
        if not self.config.motion_blur_enabled:
            return frame

        ksize = self.config.motion_blur_kernel_size
        if ksize % 2 == 0:
            ksize += 1
        ksize = max(3, min(ksize, 31))

        # Determine motion blur orientation angle
        angle_rad = math.atan2(-tilt_rate, pan_rate) if (abs(pan_rate) > 0.01 or abs(tilt_rate) > 0.01) else 0.0
        kernel = np.zeros((ksize, ksize), dtype=np.float32)

        # Line through kernel center oriented by angle
        mid = ksize // 2
        dx = math.cos(angle_rad) * (mid)
        dy = math.sin(angle_rad) * (mid)
        pt1 = (int(round(mid - dx)), int(round(mid - dy)))
        pt2 = (int(round(mid + dx)), int(round(mid + dy)))
        cv2.line(kernel, pt1, pt2, 1.0, 1)
        k_sum = np.sum(kernel)
        if k_sum > 0:
            kernel /= k_sum
        else:
            kernel[mid, mid] = 1.0

        blurred = cv2.filter2D(frame, -1, kernel)
        return blurred

    def render_occlusion_mask(self, frame: np.ndarray, beacon_u: Optional[float], beacon_v: Optional[float]) -> np.ndarray:
        """
        If occlusion is active, draws an opaque cloud / obstacle mask over the optical beacon
        to prevent centroid moments and neural feature detection.
        """
        if not self.is_occluded:
            return frame

        h, w = frame.shape[:2]
        # Target location or center screen
        bx = int(round(beacon_u)) if beacon_u is not None else w // 2
        by = int(round(beacon_v)) if beacon_v is not None else h // 2

        # Draw realistic irregular cloud obstacle patch
        mask_w, mask_h = 60, 45
        top_left = (max(0, bx - mask_w // 2), max(0, by - mask_h // 2))
        bottom_right = (min(w, bx + mask_w // 2), min(h, by + mask_h // 2))

        # Occluding obstacle color matches background level with diffuse edges
        bg_col = int(np.mean(frame[:10, :10])) if frame.size > 0 else 20
        cv2.ellipse(
            frame,
            (bx, by),
            (mask_w // 2, mask_h // 2),
            angle=15,
            startAngle=0,
            endAngle=360,
            color=bg_col,
            thickness=-1,
        )
        return frame

    # =========================================================================
    # 6. Master Disturbance Processing Pipeline
    # =========================================================================

    def process_frame(
        self,
        raw_frame: np.ndarray,
        beacon_u: Optional[float],
        beacon_v: Optional[float],
        beacon_intensity: float,
        depth_m: float = 1000.0,
        pan_rate: float = 0.0,
        tilt_rate: float = 0.0,
        dt: float = 0.033,
        atmosphere_path_frac: float = 1.0,
    ) -> Tuple[np.ndarray, float, DisturbanceTelemetry]:
        """
        Executes complete physical disturbance chain on frame and optical beacon:
        1. Temporal kinematics (Jitter, Platform motion, Shock) - ALWAYS applies.
        2. Atmospheric radiative transfer - scales with atmosphere_path_frac (0 in vacuum).
        3. Temporary occlusion mask.
        4. Motion blur convolution.
        5. Sensor noise injection (Gaussian, Salt & Pepper, Poisson).
        6. Telemetry aggregation.

        Returns:
            (disturbed_frame, effective_beacon_intensity, disturbance_telemetry)
        """
        # 1. Update temporal kinematics (Platform vibration ALWAYS applies)
        self.step_temporal_kinematics(dt)

        # 2. Compute atmospheric attenuation and radiant intensity
        transmittance, contrast_scale, path_radiance, eff_intensity = (
            self.compute_atmospheric_effects(beacon_intensity, depth_m, atmosphere_path_frac=atmosphere_path_frac)
        )

        frame = raw_frame.copy()

        # 3. Apply atmospheric image degradation (contrast, fog diffusion, rain streaks)
        frame = self.apply_atmospheric_image_degradation(frame, contrast_scale, path_radiance, atmosphere_path_frac=atmosphere_path_frac)

        # 4. Apply temporary occlusion masking if active
        if self.is_occluded:
            frame = self.render_occlusion_mask(frame, beacon_u, beacon_v)

        # 5. Apply motion blur
        if self.config.motion_blur_enabled:
            frame = self.apply_motion_blur(frame, pan_rate, tilt_rate)

        # 6. Apply multi-noise models (Gaussian, Poisson, Salt & Pepper)
        frame = self.apply_sensor_noise(frame)

        # 7. Collect active noise types for telemetry
        active_noises = []
        if self.config.gaussian_noise_enabled or self.config.noise_type in ["Gaussian", "Multi-Noise"]:
            active_noises.append("Gaussian")
        if self.config.salt_pepper_enabled or self.config.noise_type in ["Salt & Pepper", "Multi-Noise"]:
            active_noises.append("Salt & Pepper")
        if self.config.poisson_noise_enabled or self.config.noise_type in ["Poisson", "Multi-Noise"]:
            active_noises.append("Poisson")

        # Effective SNR estimation
        eff_snr = 20.0 * math.log10(max(1.0, eff_intensity / max(1.0, self.config.noise_std_dev)))

        gauss_active = bool(self.config.gaussian_noise_enabled or self.config.noise_type in ["Gaussian", "Multi-Noise"])
        sp_active = bool(self.config.salt_pepper_enabled or self.config.noise_type in ["Salt & Pepper", "Multi-Noise"])
        poisson_active = bool(self.config.poisson_noise_enabled or self.config.noise_type in ["Poisson", "Multi-Noise"])

        telemetry = DisturbanceTelemetry(
            preset_scenario=self.config.preset_scenario,
            active_preset=self.config.preset_scenario,
            jitter_offset_x_px=round(self.jitter_offset_x, 2),
            jitter_offset_y_px=round(self.jitter_offset_y, 2),
            jitter_dx_px=round(self.jitter_offset_x, 2),
            jitter_dy_px=round(self.jitter_offset_y, 2),
            platform_offset_x_px=round(self.platform_offset_x, 2),
            platform_offset_y_px=round(self.platform_offset_y, 2),
            platform_dx_px=round(self.platform_offset_x, 2),
            platform_dy_px=round(self.platform_offset_y, 2),
            atmospheric_condition=self.config.atmospheric_condition,
            atmospheric_transmittance=round(transmittance, 3),
            transmission_factor=round(transmittance, 3),
            ambient_light_factor=round(getattr(self, "last_amb_factor", 1.0), 2),
            effective_visibility_km=round(getattr(self, "last_vis_km", 20.0), 2),
            is_occluded=self.is_occluded,
            occlusion_active=self.is_occluded,
            occlusion_remaining_s=round(max(0.0, self.manual_occlusion_remaining), 2),
            applied_noise_types=active_noises,
            gaussian_active=gauss_active,
            salt_pepper_active=sp_active,
            poisson_active=poisson_active,
            noise_level_sigma=round(self.config.noise_std_dev if gauss_active else 0.0, 2),
            effective_snr_db=round(eff_snr, 1),
            motion_blur_applied=self.config.motion_blur_enabled,
        )

        self.last_telemetry = telemetry
        return frame, eff_intensity, telemetry

    def get_telemetry(self) -> DisturbanceTelemetry:
        """Returns the most recent disturbance telemetry."""
        if hasattr(self, "last_telemetry") and self.last_telemetry is not None:
            return self.last_telemetry
        return DisturbanceTelemetry(
            preset_scenario=self.config.preset_scenario,
            active_preset=self.config.preset_scenario,
            atmospheric_condition=self.config.atmospheric_condition,
        )
