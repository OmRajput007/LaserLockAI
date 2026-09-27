# FSOC Terminal Coarse Alignment Testbench - Setup & Quickstart Guide

## 1. Prerequisites
- **Python**: 3.10+ (Tested on Python 3.11)
- **Node.js**: 18+ (Tested on Node v24)
- **FastAPI / OpenCV / NumPy / Uvicorn / Pytest**

## 2. Running the Backend Server
From the workspace root directory:

```bash
# Run FastAPI server on port 8000
python -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --reload
```

Endpoints available:
- **API Status:** `http://localhost:8000/api/status`
- **Active Configuration:** `http://localhost:8000/api/config`
- **Reset Defaults:** `POST http://localhost:8000/api/config/reset`
- **Simulation Control:** `POST http://localhost:8000/api/simulation/start`, `/pause`, `/step`, `/reset`
- **Gimbal Actuation:** `POST http://localhost:8000/api/simulation/gimbal`
- **Interactive Swagger Docs:** `http://localhost:8000/docs`
- **Real-Time Telemetry Stream:** `ws://localhost:8000/ws/telemetry`

## 3. Running the Frontend Application
From the `frontend/` directory:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173` in your browser. The Vite development proxy forwards all `/api` and `/ws` calls directly to the FastAPI backend.

## 4. Running Backend Tests
From the workspace root:

```bash
python -m pytest tests -v
```

This verifies:
1. `test_default_parameters_match_problem_statement_4`: Validates all Problem Statement 4 parameter constraints.
2. `test_config_save_load_reset`: Verifies central JSON configuration loading, serialization, and factory reset.
3. `test_api_status_endpoint`: Verifies backend operational readiness.
4. `test_api_config_get_and_post`: Verifies configuration lifecycle API.
5. `test_api_simulation_endpoints`: Verifies discrete step updates and gimbal clamping.
6. `test_fpa_camera_projection_and_boresight`: Verifies focal plane array projection equations.
7. `test_simulation_engine_discrete_step`: Verifies full simulation discrete update.
