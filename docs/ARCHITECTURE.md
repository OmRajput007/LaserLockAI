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
