# Problem Statement 4 - Official Specifications & Default Parameters

**Project Title:** Development of an AI-Based Virtual Camera Tracking System for Coarse Alignment of Mobile Free Space Optical Communication (FSOC) Terminals

## 1. System Parameters Summary

| Category | Specification / Parameter | PS4 Requirement | Testbench Baseline |
| :--- | :--- | :--- | :--- |
| **Virtual Environment** | Screen Resolution | 2000 × 2000 pixels minimum | 2000 × 2000 Cartesian coordinate grid |
| **Optical Sensor** | Camera Type | Monochrome Focal Plane Array (FPA) | 8-bit Grayscale FPA model |
| | Sensor Resolution | 640 × 480 pixels | 640 × 480 px |
| | Field of View (FOV) | 4.0° × 3.0° | 4.0° × 3.0° (160 px/deg) |
| | Update Rate | 30 Hz minimum | 30 Hz (dt = 0.0333s) |
| | Initial Position | Center of Screen | Boresight at (1000, 1000) |
| **Gimbal Actuation** | Max Pan Slew Speed | 5.0°/sec | Clamped to [-5.0, +5.0] deg/s |
| | Max Tilt Slew Speed | 5.0°/sec | Clamped to [-5.0, +5.0] deg/s |
| **Optical Target** | Target Type | Beacon Spot | High-intensity optical emission |
| | Target Count | 1 | 1 |
| | Target Shape | Square | Square (10 × 10 px) |
| | Target Size | 10 × 10 pixels | 10 × 10 px |
| | Initial Location | Random | Random uniform in safe bounds |
| **Target Kinematics** | Mandatory Motion Patterns | Straight Line, Circular, Figure of 8, Random | All 4 generators implemented |
| **Control & Tracking** | Tracking Update Rate | ≥ 20 Hz | 20 Hz minimum loop |
| | Coarse Pointing Control | Open-Loop / Closed Loop | Baseline open-loop (PID in Part 6) |
| **Channel Disturbances**| Noise Types | Salt & Pepper, Gaussian, Poisson | Configurable (Part 7) |
| | Max Noise Std Dev | 20 pixels | 20 px upper threshold |
| | Max Camera Jitter | ±20 pixels/frame | ±20 px upper threshold |
| | Atmospheric Conditions | Clear, Haze, Fog, Rain, Low Light | 5 atmospheric presets |
| | Platform Motion | Linear mandatory (max ±20 px/frame) | Linear perturbation model |
| **KPIs & Performance** | Target Acquisition Time | ≤ 2.0 seconds | Monitored in real-time |
| | Tracking Error | ≤ 10 pixels | Real-time Euclidean error tracking |
| | Target Loss Rate | < 5.0 % | Real-time FOV occupancy |
| | Re-acquisition Time | ≤ 1.0 seconds | Monitored after occlusion |
| | Processing Frame Rate | ≥ 20 FPS | Monitored against target 30 Hz |
