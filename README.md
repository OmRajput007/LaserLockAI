# AI-Based Virtual Camera Tracking System for Coarse Alignment of Mobile FSOC Terminals

> **Part 1 Engineering Foundation & Virtual Testbench Prototype**  
> Problem Statement 4 — Pointing, Acquisition and Tracking (PAT) System

---

## Overview
This project develops a software-based virtual testbench for developing, evaluating, and stress-testing coarse camera alignment and tracking algorithms for mobile Free Space Optical Communication (FSOC) terminals.

Part 1 delivers the complete engineering foundation:
- **Aerospace Application Shell:** 14-tab technical mission control interface
- **Backend Testbench Engine:** Python FastAPI, NumPy, OpenCV, Pydantic
- **Central Configuration System:** JSON persistence, loading, and factory reset to official Problem Statement 4 parameters
- **Virtual Environment:** 2000 × 2000 pixel world space with Cartesian coordinate grid and target trajectory generators
- **Monochrome FPA Camera Model:** 640 × 480 sensor, 4.0° × 3.0° FOV, 30 Hz update rate, ±5.0°/s pan/tilt gimbal mechanics
- **Optical Beacon Target:** 10 × 10 pixel square target with Straight Line, Circular, Figure of 8, and Random trajectories
- **Real-Time Telemetry Pipeline:** 30 Hz WebSocket stream with boresight deviation readout and Recharts tracking error visualization
- **Modular Subsystems:** Fully architected foundation for detection, tracking, control, disturbances, video benchmarks, and automated reporting

---

## Problem Statement 4 Default Parameters

| Parameter | Specification | PS4 Constraint |
| :--- | :--- | :--- |
| **Virtual Screen** | 2000 × 2000 pixels minimum | 2000 × 2000 px |
| **Camera Sensor** | Monochrome Focal Plane Array (FPA) | 8-bit Grayscale FPA |
| **Resolution** | 640 × 480 pixels | 640 × 480 px |
| **Field of View (FOV)** | 4.0° × 3.0° | 160.0 px/degree |
| **Camera Update Rate** | ≥ 30.0 Hz | 30.0 Hz |
| **Initial Camera Position**| Center of Screen | Boresight at (1000, 1000) |
| **Gimbal Slew Speed** | Max 5.0°/s pan, 5.0°/s tilt | Hardware clamped to [-5, +5]°/s |
| **Target Spot** | Square Beacon Spot | 10 × 10 pixels, Count: 1 |
| **Initial Target Location**| Random | Random uniform |
| **Mandatory Motions** | Straight Line, Circular, Figure of 8, Random | All 4 patterns supported |
| **Tracking Update Interval**| ≥ 20.0 Hz | Configured to 20 Hz min |
| **Performance Limits** | Acquisition ≤ 2s, Error ≤ 10px, Loss < 5%, Re-acquisition ≤ 1s | Real-time monitored |
| **Channel Noise** | Salt & Pepper, Gaussian, Poisson | Max Std Dev: 20 px |
| **Camera Jitter / Platform**| Max ±20 pixels/frame | Linear mandatory (±20 px) |
| **Atmospheric Conditions** | Clear, Haze, Fog, Rain, Low Light | 5 transmission presets |

---

## Subsystem Architecture & Navigation

The frontend application provides 14 engineering navigation tabs:
1. **Mission Control:** Dual-viewport operational cockpit (2000x2000 world + 640x480 FPA view) with live transport and telemetry chart.
2. **Virtual Simulation:** Large 2000x2000 coordinate space view with trajectory mode switching.
3. **Camera View:** Monochrome FPA view with 10px requirement gate, 20px warning ring, and boresight telemetry.
4. **Video Benchmark:** MP4 benchmark video ingestion framework (Part 8).
5. **Detection & AI:** Computer vision centroiding and neural spot detector settings (Part 5).
6. **Tracking & Control:** Discrete Kalman filter and 2-axis PID coarse pointing loop parameters (Part 6).
7. **Disturbances:** Atmospheric attenuation, sensor noise synthesis, and platform vibration (Part 7).
8. **Analytics:** Recharts real-time tracking error time series and KPI metrics.
9. **Experiments:** Automated parameter sweeps and Monte Carlo test suites (Part 9).
10. **Performance Reports:** Standards compliance checklist and JSON/PDF report export (Part 10).
11. **Requirements:** Problem Statement 4 system traceability matrix.
12. **Architecture:** End-to-end 10-part system architectural diagram and roadmap.
13. **Documentation:** Theoretical foundations of FSOC coarse pointing and optical equations.
14. **Settings:** Central configuration editor with Save, Load, and Reset to PS4 defaults.
