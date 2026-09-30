from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from backend.app.api.routes import router as api_router
from backend.app.api.websocket import ws_router
from backend.app.config.manager import config_manager
from backend.app.simulation.engine import sim_engine

app = FastAPI(
    title="FSOC Mobile Terminal Coarse Alignment Tracking Testbench",
    description=(
        "Engineering virtual testbench for AI-based camera tracking and coarse Pointing, "
        "Acquisition and Tracking (PAT) of mobile Free Space Optical Communication terminals."
    ),
    version="1.0.0-part1",
    docs_url="/docs",
    redoc_url="/redoc",
)

# Enable CORS for frontend Vite development server and production builds
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include HTTP API routes and WebSocket endpoints
app.include_router(api_router)
app.include_router(ws_router)


@app.on_event("startup")
async def startup_event():
    # Ensure configuration is verified and simulation engine is ready
    cfg = config_manager.get_config()
    sim_engine.update_config(cfg)
    print(f"[*] FSOC Testbench Backend initialized successfully with {cfg.project_title}")
    print(f"[*] Camera FPA: {cfg.camera.sensor_type} ({cfg.camera.resolution_width}x{cfg.camera.resolution_height})")
    print(f"[*] Virtual Screen: {cfg.motion.screen_width}x{cfg.motion.screen_height}")


import os
from fastapi import HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

dist_dir = os.environ.get(
    'VISION_FRONTEND_DIST',
    os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist"))
)
assets_dir = os.path.join(dist_dir, "assets")

if os.path.exists(assets_dir):
    app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

@app.get("/")
def serve_index_or_root():
    index_file = os.path.join(dist_dir, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file)
    return {
        "message": "FSOC Terminal Coarse Alignment Virtual Tracking Testbench API",
        "documentation": "/docs",
        "status_endpoint": "/api/status",
        "config_endpoint": "/api/config",
        "ws_telemetry": "/ws/telemetry",
    }

@app.get("/{full_path:path}")
def serve_spa(full_path: str):
    if full_path.startswith("api") or full_path.startswith("ws") or full_path.startswith("docs") or full_path.startswith("openapi.json"):
        raise HTTPException(status_code=404, detail="Not Found")
    file_path = os.path.join(dist_dir, full_path)
    if os.path.exists(file_path) and os.path.isfile(file_path):
        return FileResponse(file_path)
    index_file = os.path.join(dist_dir, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file)
    raise HTTPException(status_code=404, detail="Not Found")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.app.main:app", host="127.0.0.1", port=8000, reload=True)
