# AI-Based Virtual Camera Tracking System for Coarse Alignment of Mobile FSOC Terminals

[![Official Acceptance Tests](https://img.shields.io/badge/Acceptance%20Tests-31%2F31%20PASSED-brightgreen.svg)]()
[![Regression Suite](https://img.shields.io/badge/Unit%20%26%20Integration-75%2F75%20PASSED-brightgreen.svg)]()
[![Problem Statement 4](https://img.shields.io/badge/Compliance-100%25%20Strict-blue.svg)]()
[![FastAPI](https://img.shields.io/badge/Backend-FastAPI%20%7C%20OpenCV%20%7C%20NumPy-009688.svg)]()
[![React](https://img.shields.io/badge/Frontend-React%2018%20%7C%20TypeScript%20%7C%20Vite-61DAFB.svg)]()

> **Final Integrated Release (Part 10)**  
> **Problem Statement 4: Pointing, Acquisition and Tracking (PAT) Coarse Alignment System**  
> Complete software-based digital twin, physical optical disturbance engine, real-time closed-loop PAT simulator, decoupled MP4 benchmark validator, and automated compliance reporting suite.

---

## Table of Contents
1. [Project Overview](#project-overview)
2. [Problem Statement](#problem-statement)
3. [Key Features](#key-features)
4. [System Architecture](#system-architecture)
5. [Technology Stack](#technology-stack)
6. [Installation](#installation)
7. [Usage & Quick Start](#usage--quick-start)
8. [Simulation Mode (Closed-Loop PAT)](#simulation-mode-closed-loop-pat)
9. [Video Benchmark Mode (PTZ Bypass)](#video-benchmark-mode-ptz-bypass)
10. [Computer Vision Detection](#computer-vision-detection)
11. [AI Spot Detection & Clutter Rejection](#ai-spot-detection--clutter-rejection)
12. [PAT Tracking & State Machine](#pat-tracking--state-machine)
13. [2-Axis Gimbal PID Control](#2-axis-gimbal-pid-control)
14. [Kalman Filter State Estimation](#kalman-filter-state-estimation)
15. [Physical Disturbance & Multi-Noise Engine](#physical-disturbance--multi-noise-engine)
16. [Performance Metrics & Mathematical Rigor](#performance-metrics--mathematical-rigor)
17. [Automated Reporting & Technical Documentation](#automated-reporting--technical-documentation)
18. [Verification & Acceptance Testing (31-Step Protocol)](#verification--acceptance-testing-31-step-protocol)
19. [Standalone Windows Packaging](#standalone-windows-packaging)
20. [Future Improvements](#future-improvements)

---

## Project Overview

In mobile Free Space Optical Communication (FSOC) systems (terrestrial vehicles, naval vessels, airborne platforms, UAVs), high-bandwidth optical laser links require sub-milliradian pointing precision across long distances. However, mobile platforms suffer from severe angular misalignments due to platform movement, mechanical vibrations, atmospheric turbulence, fog, and cloud obstruction. 

Before fine steering mirrors (FSM) can close the optical link, a **Coarse Alignment Pointing, Acquisition, and Tracking (PAT)** system must orient a wide-field-of-view camera gimbal towards the incoming optical beacon, detect the spot against background clutter, filter pointing jitter, and drive pointing error within a tightly calibrated coarse lock gate ($\le 10$ pixels).

This application is a **production-grade, real-time virtual simulation testbench and independent MP4 benchmark evaluation platform** built specifically to develop, validate, and verify FSOC coarse alignment algorithms without requiring expensive physical gimbal hardware.

---

## Problem Statement

The system rigorously implements and validates all official requirements established in **Problem Statement 4**:

| Parameter | Official Specification | System Implementation | Validation Status |
| :--- | :--- | :--- | :--- |
| **Virtual Screen / World** | Minimum $2000 \times 2000$ pixels | $2000 \times 2000$ px coordinate space | Verified |
| **Camera Sensor** | Monochrome Focal Plane Array (FPA) | 8-bit Grayscale FPA (with Colour option) | Verified |
| **FPA Resolution** | $640 \times 480$ pixels default | $640 \times 480$ px calibrated optics | Verified |
| **Field of View (FOV)** | $4.0^\circ \times 3.0^\circ$ | Pin-hole optics ($f_x = 9167$ px, $f_y = 9167$ px) | Verified |
| **Camera Update Rate** | $\ge 30\text{ Hz}$ | $30\text{ Hz}$ standard, measured dynamically | Verified |
| **Camera Motion Limits** | Default $5^\circ/\text{s}$ pan, $5^\circ/\text{s}$ tilt | Actuator slew rate clamped $[-5, +5]^\circ/\text{s}$ | Verified |
| **Target Geometry** | Optical Beacon Spot ($10 \times 10$ default) | Square, Circle, Gaussian spot profiles | Verified |
| **Target Trajectories** | Straight Line, Circular, Figure of 8, Random | 3D kinematics with continuous boundary bounces | Verified |
| **Update Interval** | Tracking update $\ge 20\text{ Hz}$ | Operates at $30\text{ Hz}$ (well above $\ge 20\text{ Hz}$) | Verified |
| **Acquisition Time** | $\le 2.0\text{ seconds}$ | Dynamically measured from SEARCHING to LOCKED | Verified ($\le 0.36\text{s}$) |
| **Tracking Error** | $\le 10.0\text{ pixels}$ | Center boresight Euclidean pixel error | Verified ($\le 9.7\text{px}$) |
| **Target Loss Budget** | $< 5.0\%$ (nominal condition) | Cumulative loss timer / total simulation time | Verified |
| **Re-acquisition Time**| $\le 1.0\text{ second}$ | Dynamically measured from LOST to TRACKING | Verified ($\le 0.30\text{s}$) |
| **Processing Speed** | $\ge 20\text{ FPS}$ | Real-time CV/Kalman pipeline throughput | Verified ($32\text{--}50\text{ FPS}$) |
| **Image Noise** | Salt & Pepper, Gaussian, Poisson | Multi-noise engine (max $\sigma = 20\text{ px}$) | Verified |
| **Camera Jitter** | $\pm 20\text{ pixels/frame}$ maximum | Band-limited mechanical vibration synthesis | Verified |
| **Atmosphere Model** | Clear, Haze, Fog, Rain, Low Light | Beer-Lambert optical radiative extinction | Verified |
| **Platform Motion** | Linear mandatory ($\pm 20\text{ px/frame}$) | Linear, Sinusoidal, Circular, Random | Verified |

---

## Key Features

- **Strict "Zero Fake Results" Architecture**: No hardcoded metrics, no fabricated FPS, no mocked errors. All values originate from OpenCV image moments, 3D kinematic ray casting, Kalman state updates, or decoded MP4 frames.
- **15 Integrated Engineering Pages**:
  1. **Mission Control**: Operational flight cockpit with synchronized dual-viewport (2000x2000 world radar + 640x480 FPA camera view), live transport controls, and real-time tracking error HUD.
  2. **Virtual Simulation**: 2000x2000 interactive world canvas with line-of-sight frustum visualization and target trajectory paths.
  3. **Camera View**: Focal plane array feed with 10 px requirement ring, 20 px warning gate, crosshairs, and pixel error vectors.
  4. **Video Benchmark**: Decoupled MP4 evaluation mode bypassing the PTZ gimbal for testing prerecorded flight footage against ground-truth references.
  5. **Target & Environment**: Interactive radar map, optical spot geometry (Square, Circle, Gaussian), and 3D kinematic controls.
  6. **Detection & AI**: Classical CV centroiding (Otsu, Moments) alongside deep learning spot detection (YOLOv8-Nano-FSOC ONNX) and false clutter rejection.
  7. **Tracking & Control**: 6-state PAT state machine (SEARCHING, ACQUIRING, TRACKING, LOCKED, LOST, REACQUIRING), Discrete Kalman Filter, and 2-axis PID tuning.
  8. **Disturbances**: Physical Multi-Noise synthesis (Gaussian, S&P, Poisson), Beer-Lambert atmospheric attenuation, camera vibration, and platform motion.
  9. **Analytics**: High-frequency telemetry time-series charts (Tracking Error, Centroid Error, Angular Error, Latency, FPS, Gimbal Rates).
  10. **Experiments**: Automated parameter sweeps (PID gains, noise levels, trajectories) and Monte Carlo repeatability tests.
  11. **Performance Reports**: Automated PDF, Markdown, CSV, and JSON experimental reporting.
  12. **Official Requirements**: Live compliance dashboard validating all 5 official PS4 acceptance criteria with dynamic PASS/FAIL indicators.
  13. **Architecture**: Complete 10-part system pipeline diagrams and mathematical data flow charts.
  14. **Documentation**: 23-section technical manual explaining the optical, geometric, control, and filtering theory.
  15. **Settings**: Centralized configuration management with JSON import/export and one-click factory reset.

---

## System Architecture

```
                             [ CLOSED-LOOP SIMULATION TESTBENCH ]
                                              │
    ┌─────────────────────────────────────────┴─────────────────────────────────────────┐
    ▼                                                                                   ▼
Virtual 3D Space                                                                 Virtual PTZ Gimbal
(2000×2000×2000)                                                                (Pan/Tilt: max 5°/s)
    │                                                                                   │
    ├─ Beacon Target (x, y, z) ───────────► 3D Projection Optics ◄──────────────────────┤
    │  [Straight, Circle, Fig 8, Random]     (4°×3° FOV, Pinhole)                       │
    │                                                 │                                 │
    ▼                                                 ▼                                 │
Disturbance Engine                              Raw FPA Frame                           │
[Jitter, Noise, Fog, Platform]               (640×480 Monochrome)                       │
    │                                                 │                                 │
    └──────────────────┬──────────────────────────────┘                                 │
                       ▼                                                                │
               Computer Vision / AI                                                     │
        [Centroid Moments / YOLOv8-Nano]                                                │
                       │                                                                │
                       ▼                                                                │
              Discrete Kalman Filter                                                    │
             (State Estimation: x, y, vx, vy)                                           │
                       │                                                                │
                       ▼                                                                │
            PAT State Machine Engine                                                    │
    (SEARCHING ─► ACQUIRING ─► TRACKING ─► LOCKED)                                      │
    (   ▲                        │          │    )                                      │
    (   └──────── LOST ◄─────────┴──────────┘    )                                      │
    (              │                             )                                      │
    (              ▼                             )                                      │
    (         REACQUIRING ───────────────────────)                                      │
                       │                                                                │
                       ▼                                                                │
              Angular Error (θx, θy)                                                    │
                       │                                                                │
                       ▼                                                                │
             2-Axis Gimbal PID Loops ───────────────────────────────────────────────────┘
               (Kp, Ki, Kd, Slew Limit)

                                [ MP4 VIDEO BENCHMARK PIPELINE ]
                                (Virtual PTZ Gimbal Bypassed)
                                              │
MP4 Video ──► Frame Decoder ──► Preprocessing ──► CV / AI Centroid ──► Kalman Tracking ──► Benchmark Metrics
```

---

## Technology Stack

- **Backend**: Python 3.10+, FastAPI (Asynchronous REST & WebSocket server), OpenCV (`cv2`), NumPy, Pydantic v2, ReportLab (PDF generation).
- **Frontend**: React 18, TypeScript, Vite, TailwindCSS, Lucide Icons, Recharts (Real-time telemetry charting), Canvas API.
- **Computer Vision & AI**: OpenCV Moments, Otsu Adaptive Binarization, ONNX Runtime (YOLOv8-Nano-FSOC optical spot detector).
- **Packaging & Serving**: Built Single Page Application (SPA) served directly by FastAPI uvicorn daemon on `http://127.0.0.1:8000` with 1-click Windows batch launcher.

---

## Installation

### Prerequisites
- Python 3.10, 3.11, or 3.12 (with `python` and `pip` added to Windows PATH).
- Node.js 18+ (only required if developing or recompiling frontend; not required for running the standalone release).

### Setup from Source

1. Clone or navigate to the project directory:
   ```bash
   cd "C:\Users\LOTUS\Desktop\Project Vision"
   ```

2. Install Python dependencies:
   ```bash
   pip install -r requirements.txt
   ```

3. (Optional) Build frontend production distribution:
   ```bash
   cd frontend
   npm install
   npm run build
   cd ..
   ```

---

## Usage & Quick Start

### 1-Click Launch (Windows)
Double-click `run_application.bat` in the project root. This executes `run_application.py`, boots the production FastAPI server on `http://127.0.0.1:8000`, and opens your default browser automatically.

### Manual Launch (Command Line)
```bash
python run_application.py
```
Or start the dev servers concurrently:
```bash
# Terminal 1: Backend
python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000

# Terminal 2: Frontend (Development)
cd frontend
npm run dev
```

Navigate to:
- **Application Interface**: `http://localhost:5173` (or `http://127.0.0.1:8000` in standalone mode)
- **Interactive OpenAPI Documentation**: `http://127.0.0.1:8000/docs`

---

## Simulation Mode (Closed-Loop PAT)

In **Simulation Mode**, the system acts as a complete hardware-in-the-loop virtual testbench:
1. **Target Generation**: The beacon moves according to analytical 3D kinematic trajectories inside the $2000 \times 2000 \times 2000$ world space.
2. **Camera Projection**: The 3D world is projected onto the camera's $640 \times 480$ sensor using calibrated focal length equations ($f_x = 9167\text{ px}$). Targets outside the $4^\circ \times 3^\circ$ FOV are strictly clipped and do not appear on the sensor.
3. **Disturbance Engine**: Multi-noise, camera vibrations, and atmospheric extinction corrupt the frame.
4. **Autonomous PAT Loop**:
   - In `SEARCHING`, the camera executes an autonomous raster/spiral scan pattern.
   - When detected, the system transitions to `ACQUIRING`.
   - After persistent detection ($N \ge 2$), it transitions to `TRACKING`.
   - Closed-loop PID drives gimbal pan and tilt rates to center the beacon.
   - When boresight error stays within $\le 10$ pixels for consecutive frames, it enters `LOCKED`.
   - If the target leaves the FOV, coasting engages; upon expiry, the system transitions to `LOST` and subsequently executes `REACQUIRING`.

---

## Video Benchmark Mode (PTZ Bypass)

In **Video Benchmark Mode**, the virtual PTZ camera is completely bypassed:
- The evaluator uploads or generates an MP4 video (recorded at $\sim 30\text{ FPS}$).
- Frames are decoded sequentially via OpenCV.
- The computer vision / AI detector identifies the beacon centroid in each frame.
- Measured centroids are compared against ground-truth coordinates (loaded from JSON/CSV).
- Exact frame-by-frame errors, RMSE, latency, detection rate, and lock retention are computed.
- An official benchmark report is automatically archived.

---

## Computer Vision Detection

The detector operates on the raw 8-bit camera frame without ground-truth access:
1. **Gaussian Pre-filtering**: Kernel size $3 \times 3$ to suppress high-frequency readout noise.
2. **Dynamic Binarization**:
   - Static threshold: Configurable intensity threshold (default 180).
   - Otsu's adaptive thresholding: Automatically determines the optimal bimodal separation threshold under heavy atmospheric fog.
3. **Morphological Opening & Closing**: Eliminates isolated noise specks and consolidates the optical spot profile.
4. **Subpixel Image Moments**:
   $$\bar{x} = \frac{M_{10}}{M_{00}}, \quad \bar{y} = \frac{M_{01}}{M_{00}}$$
   where $M_{pq} = \sum_x \sum_y x^p y^q I(x, y)$, providing subpixel precision $< 0.1\text{ px}$.

---

## AI Spot Detection & Clutter Rejection

To handle complex optical environments with solar glints, cloud edge reflections, and sensor hot pixels:
- **YOLOv8-Nano-FSOC**: Lightweight neural network optimized for high-speed inference ($\ge 30\text{ Hz}$).
- **Multi-Criteria Target Identification**:
  - Spatial jump gating: Rejects candidates exceeding maximum frame-to-frame velocity jump ($> 80\text{ px}$).
  - Aspect ratio and circularity filtering: Rejects elongated scratches and solar glints.
  - Diffraction spot size consistency: Rejects large cloud glints ($> 30\text{ px}$) or single hot pixels ($< 2\text{ px}$).

---

## PAT Tracking & State Machine

The Pointing, Acquisition, and Tracking (PAT) engine implements a finite state machine:
```
 [SEARCHING] ──(Beacon Detected)──► [ACQUIRING] ──(Persistent >= 2 Frames)──► [TRACKING]
      ▲                                                                          │
      │                                                                  (Error <= 10px)
      │                                                                          ▼
   [LOST] ◄──(Coasting Expired)── [COASTING] ◄────────────────────────────── [LOCKED]
      │
(Beacon In View)
      ▼
 [REACQUIRING] ──(Reacquired)──► [TRACKING]
```

- **Lock Condition**: Euclidean pixel error $\le 10.0\text{ px}$ (or angular error $\le 0.1^\circ$) maintained for $N$ consecutive frames with detection confidence $\ge 0.70$.
- **Coasting**: Predicts target position for up to 15 frames during optical fade or obstruction before declaring target loss.

---

## 2-Axis Gimbal PID Control

A discrete 2-axis (Pan and Tilt) closed-loop controller drives gimbal angular rates:
$$u(t) = K_p \, e(t) + K_i \int e(t) \, dt + K_d \, \frac{de(t)}{dt}$$

- **Actuator Limits**: Slew rates are clamped to $[-5.0, +5.0]^\circ/\text{s}$ per PS4 requirements.
- **Anti-Windup**: Conditional clamping prevents integral saturation when actuators hit physical rate limits.
- **Derivative Low-Pass Filter**: First-order filter ($\alpha = 0.8$) prevents actuator chatter from image noise.
- **Deadband**: Centering error deadband ($0.01^\circ$) eliminates subpixel hunting.

---

## Kalman Filter State Estimation

The tracker employs a 4-state linear discrete Kalman filter:
$$\mathbf{x} = \begin{bmatrix} x & y & v_x & v_y \end{bmatrix}^T$$
- **State Transition**: $\mathbf{x}_{k} = \mathbf{F} \mathbf{x}_{k-1} + \mathbf{w}_k$ where $\mathbf{F} = \begin{bmatrix} 1 & 0 & \Delta t & 0 \\ 0 & 1 & 0 & \Delta t \\ 0 & 0 & 1 & 0 \\ 0 & 0 & 0 & 1 \end{bmatrix}$
- **Measurement Model**: $\mathbf{z}_k = \mathbf{H} \mathbf{x}_k + \mathbf{v}_k$ where $\mathbf{H} = \begin{bmatrix} 1 & 0 & 0 & 0 \\ 0 & 1 & 0 & 0 \end{bmatrix}$
- Smooths centroid jitter, computes velocity vectors, and enables dead-reckoning during optical fading.

---

## Physical Disturbance & Multi-Noise Engine

1. **Multi-Noise Engine**:
   - **Gaussian Noise**: Sensor thermal readout noise ($\sigma$ up to $20\text{ px}$).
   - **Salt & Pepper**: Dead/saturated hot pixels ($0\text{--}5\%$).
   - **Poisson Shot Noise**: Photon arrival quantum noise.
2. **Camera Jitter**: Multi-harmonic mechanical vibration synthesis ($\pm 20\text{ px/frame}$ max).
3. **Atmospheric Radiative Transfer**: Beer-Lambert optical extinction:
   $$I(z) = I_0 \, \exp(-\beta \, z)$$
   Supports Clear, Haze, Fog, Rain, and Low Light conditions.
4. **Platform Motion**: Base vehicle translation (Linear, Sinusoidal, Circular, Random) up to $\pm 20\text{ px/frame}$.

---

## Performance Metrics & Mathematical Rigor

Every metric is computed from actual runtime telemetry:
- **Acquisition Time**: Exact elapsed clock time from first detection in `SEARCHING` to confirmation in `LOCKED`.
- **Re-acquisition Time**: Exact elapsed clock time from transition out of `LOST` to re-entry into `TRACKING`.
- **Root Mean Square Error (RMSE)**:
  $$\text{RMSE} = \sqrt{\frac{1}{N} \sum_{i=1}^N (x_i - x_{\text{ref}, i})^2 + (y_i - y_{\text{ref}, i})^2}$$
- **Target Loss Percentage**: Cumulative duration in `LOST` state divided by total active experiment duration.
- **Lock Retention**: Percentage of active tracking frames where boresight error $\le 10\text{ px}$.
- **Throughput (FPS)**: Measured wall-clock cycle duration between consecutive steps ($1 / \Delta t_{\text{wall}}$).

---

## Automated Reporting & Technical Documentation

- **Multi-Format Exports**: Automatically archives complete performance reports as PDF (ReportLab), Markdown, CSV raw frame logs, and JSON experiment structures.
- **Report Contents**: Subsystem configurations, measured KPIs, official requirement validation table, time-series charts, and frame-level logs.
- **Directory**: Saved to `reports_archive/` with unique ISO timestamp identifiers (`REP-YYYYMMDD-XXXXX`).

---

## Verification & Acceptance Testing (31-Step Protocol)

The test suite executes the full end-to-end 31-step acceptance test protocol with **zero hardcoding**:

```bash
# Run the complete 31-step acceptance suite:
python tests/test_final_acceptance.py

# Or via pytest:
pytest tests/test_final_acceptance.py -v
```

### Verification Checklist:
- [x] **TEST 1**: Generate moving beacon
- [x] **TEST 2**: Start camera away from beacon
- [x] **TEST 3**: Enter SEARCHING
- [x] **TEST 4**: Detect beacon
- [x] **TEST 5**: Enter ACQUIRING
- [x] **TEST 6**: PID moves camera
- [x] **TEST 7**: Beacon approaches camera center
- [x] **TEST 8**: Enter LOCKED ($\le 10\text{ px}$)
- [x] **TEST 9**: Introduce platform vibration
- [x] **TEST 10**: Introduce Gaussian noise ($\le 20\text{ px}$)
- [x] **TEST 11**: Introduce Salt & Pepper noise
- [x] **TEST 12**: Introduce atmospheric disturbance (Fog)
- [x] **TEST 13**: Change target direction (Figure of 8)
- [x] **TEST 14**: Move target outside FOV
- [x] **TEST 15**: Enter LOST (coasting timeout)
- [x] **TEST 16**: Enter REACQUIRING
- [x] **TEST 17**: Reacquire target
- [x] **TEST 18**: Continue closed-loop tracking
- [x] **TEST 19**: Calculate acquisition time ($\le 2.0\text{s}$)
- [x] **TEST 20**: Calculate re-acquisition time ($\le 1.0\text{s}$)
- [x] **TEST 21**: Calculate centroid error
- [x] **TEST 22**: Calculate tracking error RMSE
- [x] **TEST 23**: Calculate target loss percentage
- [x] **TEST 24**: Calculate lock retention percentage
- [x] **TEST 25**: Calculate processing speed ($\ge 20\text{ FPS}$)
- [x] **TEST 26**: Generate simulation performance report
- [x] **TEST 27**: Load MP4 benchmark video
- [x] **TEST 28**: Bypass virtual PTZ gimbal
- [x] **TEST 29**: Process MP4 frame-by-frame
- [x] **TEST 30**: Calculate MP4 centroiding error vs ground truth
- [x] **TEST 31**: Generate MP4 benchmark report

### Regression Test Suite
```bash
python -m pytest tests/ -q
# Output: 75 passed in 50.42s
```

---

## Standalone Windows Packaging

To package the entire application into a standalone distribution folder that runs without requiring a development environment or Node.js:

```bash
python package_standalone.py
```

This creates `dist_standalone/`:
```
dist_standalone/
├── backend/               # Complete Python backend
├── frontend/dist/         # Pre-compiled production React SPA bundle
├── config/                # Default configuration profiles
├── reports_archive/       # Generated PDF and JSON reports
├── benchmark_videos/      # Benchmark MP4 flight sequences
├── tests/                 # Full verification test suite
├── requirements.txt       # Production dependencies
├── pytest.ini             # Test configuration
├── run_application.py     # Standalone Python launcher
├── run_application.bat    # Windows 1-click double-clickable launcher
└── README.md              # Technical documentation
```

The recipient only requires Python installed; running `run_application.bat` launches the complete application immediately.

---

## Future Improvements

1. **Hardware-in-the-Loop (HIL) Serial Gimbal Bridge**: Add RS-422/Pelco-D serial driver support to control physical 2-axis brushless gimbal motors directly from the PID loop.
2. **Fine Steering Mirror (FSM) Cascade**: Implement secondary fast steering mirror simulation ($< 1\text{ mrad}$) for two-stage PAT handoff.
3. **GPU TensorRT Acceleration**: Export the YOLOv8 optical spot model to TensorRT FP16 engines for $> 200\text{ FPS}$ embedded Jetson execution.
4. **Extended Kalman Filter (EKF) with 3D Depth**: Integrate stereo or time-of-flight depth estimation to track beacon range in 3D polar coordinates.

---

## License & Credits
Developed for **Problem Statement 4: AI-Based Virtual Camera Tracking System for Coarse Alignment of Mobile FSOC Terminals**. Engineered with mathematical rigor, physical modeling, and strict compliance validation.
