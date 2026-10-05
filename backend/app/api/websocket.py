import asyncio
import time
import json
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import Set, Optional

from backend.app.simulation.engine import sim_engine

logger = logging.getLogger("WebSocketTelemetry")
ws_router = APIRouter(tags=["WebSocket Telemetry"])


class ConnectionManager:
    """
    Manages active telemetry WebSocket clients using a Single Producer / Multi-Consumer
    broadcast architecture.
    
    A single background task steps sim_engine at a steady 30 Hz (sim_engine.dt),
    serializes the telemetry packet to JSON once, and broadcasts it concurrently to
    all connected clients.
    
    This eliminates race conditions, guarantees deterministic physics timing, and prevents
    multiple connected tabs or viewports from speeding up or desynchronizing the simulation.
    """

    def __init__(self):
        self.active_connections: Set[WebSocket] = set()
        self._producer_task: Optional[asyncio.Task] = None
        self._step_lock: Optional[asyncio.Lock] = None
        self._latest_telemetry_json: Optional[str] = None
        self._is_running = True

    def _get_lock(self) -> asyncio.Lock:
        if self._step_lock is None:
            self._step_lock = asyncio.Lock()
        return self._step_lock

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.add(websocket)

        # Immediately deliver current state to newly connected client
        if self._latest_telemetry_json is None:
            initial_telem = sim_engine.step(dt=0.0)
            self._latest_telemetry_json = initial_telem.model_dump_json()

        try:
            await websocket.send_text(self._latest_telemetry_json)
        except Exception:
            pass

        self._ensure_producer_running()

    def disconnect(self, websocket: WebSocket):
        self.active_connections.discard(websocket)

    async def broadcast(self, message: str):
        if not self.active_connections:
            return
        conns = list(self.active_connections)
        results = await asyncio.gather(*[c.send_text(message) for c in conns], return_exceptions=True)
        for conn, res in zip(conns, results):
            if isinstance(res, Exception):
                self.disconnect(conn)

    def start_producer(self):
        self._ensure_producer_running()

    def _ensure_producer_running(self):
        if self._producer_task is None or self._producer_task.done():
            try:
                loop = asyncio.get_running_loop()
                self._producer_task = loop.create_task(self._simulation_producer_loop())
                logger.info("Simulation producer broadcast task started.")
            except RuntimeError:
                pass

    async def _simulation_producer_loop(self):
        """
        Single Producer Loop:
        Steps the simulation engine at a steady 30 Hz (sim_engine.dt) and broadcasts
        telemetry to all connected clients.
        """
        while self._is_running:
            try:
                if not self.active_connections:
                    # When no clients are connected, idle briefly
                    await asyncio.sleep(0.05)
                    continue

                t_loop_start = time.time()

                # When isolated, completely suspend 30 Hz simulation stepping and CV detection
                if getattr(sim_engine, "is_isolated", False):
                    if getattr(sim_engine, "_cached_isolated_telem", None) is not None:
                        msg = sim_engine._cached_isolated_telem.model_dump_json()
                        self._latest_telemetry_json = msg
                        await self.broadcast(msg)
                    await asyncio.sleep(0.033)
                    continue

                # Step simulation ONCE for all connected clients
                async with self._get_lock():
                    if sim_engine.is_running:
                        telemetry = sim_engine.step()
                    else:
                        telemetry = sim_engine.step(dt=0.0)

                msg = telemetry.model_dump_json()
                self._latest_telemetry_json = msg
                await self.broadcast(msg)

                target_interval = max(0.010, sim_engine.dt)
                elapsed = time.time() - t_loop_start
                wait_time = max(0.001, target_interval - elapsed)
                await asyncio.sleep(wait_time)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in simulation producer loop: {e}")
                await asyncio.sleep(0.033)

    def stop(self):
        self._is_running = False
        if self._producer_task and not self._producer_task.done():
            self._producer_task.cancel()


manager = ConnectionManager()


@ws_router.websocket("/ws/telemetry")
async def websocket_telemetry_endpoint(websocket: WebSocket):
    """
    Real-time telemetry stream operating with Single Producer / Multi-Consumer broadcast.
    Pushes continuous 3D target, camera, and tracking telemetry packets to connected frontends at 30 Hz.
    Accepts bidirectional commands for:
    - Manual pan/tilt rates
    - Target pan/tilt angles (sliders)
    - Transport controls (run/pause/reset)
    """
    await manager.connect(websocket)
    try:
        while True:
            # Await client command messages (non-blocking for other clients)
            data = await websocket.receive_text()
            try:
                cmd = json.loads(data)
            except Exception:
                continue

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

    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)

