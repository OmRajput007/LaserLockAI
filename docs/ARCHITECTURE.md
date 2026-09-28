# System Architecture - FSOC Coarse Alignment Virtual Testbench

## 1. System High-Level Topology

```mermaid
graph TD
    subgraph Virtual Environment [2000 x 2000 World Space]
        Beacon[Optical Beacon Spot 10x10 px] --> Kinematics[Target Motion Generator: Straight, Circle, Fig-8, Random]
        CameraGimbal[Virtual Camera: FPA 640x480, FOV 4°x3°] --> GimbalDynamics[Pan/Tilt Slew Max 5°/s]
    end

    subgraph Channel & Disturbance Engine [Part 7]
        Atmosphere[Atmosphere: Clear, Fog, Rain, Haze, Low-light]
        Jitter[Camera Jitter & Platform Motion ±20px]
        Noise[Salt & Pepper, Gaussian, Poisson]
    end

    subgraph Sensor & Optical Pipeline
        Projection[Coordinate Projection: World -> FPA Sensor]
        FPA_Frame[640x480 Monochrome FPA Frame]
    end

    subgraph Detection & Estimation Pipeline [Part 5 & Part 6]
        Detector[Centroid / AI-CNN Detector] --> Measurement[Target Pixel Coordinates (x, y)]
        Measurement --> Kalman[Kalman Filter / Tracking Estimator]
    end

    subgraph Control Loop [Part 6]
        Kalman --> ErrorCalc[Boresight Error Calculation (dx, dy)]
        ErrorCalc --> PID[Coarse Pointing Controller: Pan/Tilt Rate Commands]
        PID --> CameraGimbal
    end

    subgraph Analytics & Telemetry Engine [Part 8 & Part 10]
        Metrics[Acquisition Time, Tracking Error <= 10px, Loss Rate < 5%]
        ReportGen[Automated Compliance Reports]
        WS[WebSocket /ws/telemetry 30 Hz]
    end

    subgraph Frontend Application Shell
        TestbenchUI[React + Vite + Tailwind + Canvas Testbench]
        Nav14[14 Engineering Navigation Tabs]
    end

    Kinematics --> Projection
    GimbalDynamics --> Projection
    Projection --> FPA_Frame
    FPA_Frame --> Detector
    ErrorCalc --> Metrics
    Metrics --> WS
    WS --> TestbenchUI
```

## 2. 10-Part Project Roadmap

- **Part 1:** Foundation, Architecture, Application Shell, Backend, Frontend, Configuration System, Basic Virtual Environment. *(Completed)*
- **Part 2:** Virtual Environment, Target Generation, 3D Kinematics, Camera Model, FOV Projection & Three.js 3D Scene. *(Completed)*
- **Part 3:** Optical Beacon Physics, Radiant Intensity, Spot Geometry, Divergence Profiles.
- **Part 4:** Pan/Tilt Gimbal Actuator Dynamics, Angular Constraints, Gear Friction & Motor Slew.
- **Part 5:** Computer Vision & AI Detection (Blob Analysis, Threshold Centroids, Convolutional Spot Localization).
- **Part 6:** State Estimation & Control (Discrete Kalman Filter, Coarse Pointing Closed-Loop PID).
- **Part 7:** Realistic Atmospheric Disturbances, Platform Vibration, Noise Synthesis.
- **Part 8:** Video Benchmark Suite (MP4 frame ingestion, synthetic optical stream evaluation).
- **Part 9:** Experimentation Engine, Automated Parameter Sweeps, Repeatability Validation.
- **Part 10:** Comprehensive Performance Analytics, Standards Compliance Verification, Automated Report Generation.

---

## 3. Orbital Scenario & Multi-Tier Space Link Architecture

### 3.1 Coordinate Frames
The simulation integrates spaceborne (LEO, MEO, GEO) and airborne (UAV) platforms across four coupled reference systems:
1. **ECI (Earth-Centered Inertial):**
   - Origin: Center of Earth.
   - Axes: $+X$ points toward the Vernal Equinox ($\Upsilon$), $+Z$ along the North rotation axis, $+Y$ completes the right-handed Cartesian triad.
   - Mechanics: Closed-form two-body Keplerian circular orbit propagation in double precision.
2. **Satellite LVLH (Local Vertical Local Horizontal):**
   - Origin: Camera satellite center of mass.
   - Axes: $+Z_{\text{LVLH}}$ nadir (toward Earth center), $+X_{\text{LVLH}}$ in direction of orbital motion (in-track), $+Y_{\text{LVLH}}$ orbit normal (cross-track).
3. **Topocentric ENU (East-North-Up):**
   - Origin: Tangent plane at UAV/ground station geodetic coordinates.
   - Axes: $+X$ East, $+Y$ North, $+Z$ Up (zenith).
4. **Sensor / Focal Plane Array (FPA) Body Frame:**
   - 2-axis gimbal with Azimuth (Pan $\psi$) and Elevation (Tilt $\theta$).
   - Sensor Projection: The physics engine delivers relative azimuth error $\Delta\text{az} = \text{az}_{\text{body}} - \psi$ and elevation error $\Delta\text{el} = \text{el}_{\text{body}} - \theta$.
   - Pixel Mapping: Standardized linear scaling of $160\text{ px/deg}$ across the $640 \times 480$ sensor ($4.0^\circ \times 3.0^\circ$ FOV):
     $$u = 320 + \Delta\text{az} \times 160, \quad v = 240 - \Delta\text{el} \times 160$$

### 3.2 Physics Assumptions & Simplifications
- **Inertial Earth (No Diurnal Rotation):** Earth rotation ($\omega_E = 0$) is omitted to decouple ephemeris calculations from orbital cross-track validation.
- **Circular Keplerian Orbits:** Eccentricity $e = 0$, gravitational parameter $\mu = 398600.4418\text{ km}^3/\text{s}^2$, and mean Earth radius $R_E = 6378.137\text{ km}$.
- **No Live Impulsive Transfers:** Orbit switches dynamically re-initialize analytical circular orbital states.

### 3.3 Gimbal Dynamics & Actuator Constraints
- **Pan Limits:** Clamped to $[-180.0^\circ, +180.0^\circ]$.
- **Tilt Limits:** Configurable limits (default $\pm 85.0^\circ$) preventing gimbal lock / keyhole singularities at zenith and nadir.
- **Max Slew Rate:** Clamped to a configurable slew speed (default $5.0^\circ/\text{s}$, adjustable up to $30.0^\circ/\text{s}$).
- **Telemetry & Logging Flags:** Commanded velocities hitting maximum slew trigger `SLEW_SATURATED`; angle limits trigger `GIMBAL_LIMIT`. Both flags stream through WebSocket and are archived in performance logs.

### 3.4 Line-of-Sight Blocking & Atmospheric Turbulence Eligibility
- **Geometric Ray-Sphere Occlusion (`LINK_BLOCKED`):**
  - Line-of-sight vector $\mathbf{r}_{\text{LOS}} = \mathbf{r}_{\text{bcn}} - \mathbf{r}_{\text{cam}}$.
  - The closest approach $d_{\text{min}}$ between the Earth center and the LOS ray is calculated. If $d_{\text{min}} \le R_E$ (or $R_E + 100\text{ km}$ for satellite-to-satellite links), the Earth body physically occults the transmission.
  - State transitions to `LINK_BLOCKED`. The gimbal holds position, the Kalman filter resets covariances, and zero tracker failures are charged.
  - **Lock Retention Formula:**
    $$\text{Lock Retention Rate} = \frac{\text{Frames Locked}}{\text{Total Frames} - \text{Frames LINK\_BLOCKED}} \times 100\%$$
- **Atmospheric Path Fraction:**
  - Computes the proportion of the optical path residing below the $100\text{ km}$ atmosphere boundary.
  - Vacuum links ($\text{fraction} \le 10^{-6}$) bypass atmospheric extinction, contrast degradation, and fog/rain diffusion.
  - Platform mechanical vibrations continue to apply unconditionally. Manual turbulence injection displays an informational note when the fraction is zero.

