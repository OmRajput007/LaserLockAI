import asyncio
import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import Set

from backend.app.simulation.engine import sim_engine

ws_router = APIRouter(tags=["WebSocket Telemetry"])


class ConnectionManager:
    """Manages active telemetry WebSocket clients."""

    def __init__(self):
        self.active_connections: Set[WebSocket] = set()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.add(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.discard(websocket)

    async def broadcast(self, message: str):
        for connection in list(self.active_connections):
            try:
                await connection.send_text(message)
            except Exception:
                self.disconnect(connection)


manager = ConnectionManager()


@ws_router.websocket("/ws/telemetry")
async def websocket_telemetry_endpoint(websocket: WebSocket):
    """
    Real-time telemetry stream operating at the 30 Hz camera update rate.
    Pushes continuous 3D target, camera, and tracking telemetry packets to connected testbench frontends.
    Accepts bidirectional commands for:
    - Manual pan/tilt rates
    - Target pan/tilt angles (sliders)
    - Transport controls (run/pause/reset)
    """
    await manager.connect(websocket)
    try:
        while True:
            # If simulation is marked running, advance step; else sample current state
            if sim_engine.is_running:
                telemetry = sim_engine.step()
            else:
                telemetry = sim_engine.step(dt=0.0)

            await websocket.send_text(telemetry.model_dump_json())

            # Check if any incoming command arrived over WebSocket
            try:
                data = await asyncio.wait_for(websocket.receive_text(), timeout=0.033)
                cmd = json.loads(data)

                # Slider target angle commands
                if "target_pan" in cmd or "target_tilt" in cmd:
                    p = cmd.get("target_pan", sim_engine.camera.target_pan_deg)
                    t = cmd.get("target_tilt", sim_engine.camera.target_tilt_deg)
                    sim_engine.set_gimbal_target_angles(float(p), float(t))

                # Rate commands (nudges)
                elif "pan_rate" in cmd or "tilt_rate" in cmd:
                    pr = cmd.get("pan_rate", sim_engine.camera.pan_rate)
                    tr = cmd.get("tilt_rate", sim_engine.camera.tilt_rate)
                    sim_engine.set_manual_gimbal_rates(float(pr), float(tr))

                # Transport controls
                elif "is_running" in cmd:
                    sim_engine.is_running = bool(cmd["is_running"])
                elif cmd.get("action") == "reset":
                    sim_engine.reset()

            except asyncio.TimeoutError:
                pass
            except Exception:
                pass

    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)
