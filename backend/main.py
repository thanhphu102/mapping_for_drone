from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
import asyncio
import json
import os
from typing import Dict, List

app = FastAPI()

drone_connections: Dict[str, WebSocket] = {}
frontend_connections: List[WebSocket] = []
lock = asyncio.Lock()

async def broadcast_to_frontends(message: dict) -> None:
    dead = []
    for ws in list(frontend_connections):
        try:
            await ws.send_json(message)
        except Exception:
            dead.append(ws)
    for ws in dead:
        try:
            frontend_connections.remove(ws)
        except ValueError:
            pass


@app.websocket("/ws/drone/{drone_id}")
async def ws_drone(websocket: WebSocket, drone_id: str):
    await websocket.accept()
    async with lock:
        drone_connections[drone_id] = websocket
    await broadcast_to_frontends({"type": "connect", "drone_id": drone_id})
    try:
        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
            except Exception:
                msg = {"raw": data}
            await broadcast_to_frontends({"type": "telemetry", "drone_id": drone_id, "payload": msg})
    except WebSocketDisconnect:
        async with lock:
            drone_connections.pop(drone_id, None)
        await broadcast_to_frontends({"type": "disconnect", "drone_id": drone_id})


@app.websocket("/ws/frontend")
async def ws_frontend(websocket: WebSocket):
    await websocket.accept()
    frontend_connections.append(websocket)
    try:
        while True:
            # Keep connection alive; frontend can send pings if desired
            await websocket.receive_text()
    except WebSocketDisconnect:
        try:
            frontend_connections.remove(websocket)
        except ValueError:
            pass


@app.post("/command")
async def post_command(cmd: dict):
    """Dispatch a command to one or more drones.

    Expected JSON shape:
      {"target": {"lat": number, "lon": number, "alt": number (optional)}, "drones": ["id1",...] | "all"}
    """
    target = cmd.get("target")
    drones = cmd.get("drones", "all")
    message = {"type": "command", "target": target}
    sent = []
    async with lock:
        if drones == "all":
            targets = list(drone_connections.keys())
        else:
            targets = drones
        for d in targets:
            ws = drone_connections.get(d)
            if ws:
                try:
                    await ws.send_json(message)
                    sent.append(d)
                except Exception:
                    pass
    await broadcast_to_frontends({"type": "command_sent", "target": target, "to": sent})
    return {"ok": True, "sent": sent}

# Mount static files AFTER all routes are defined
frontend_dist_path = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")

# Verify dist directory exists
if not os.path.exists(frontend_dist_path):
    raise RuntimeError(
        f"Frontend dist directory not found at {frontend_dist_path}.\n"
        "Please run: cd frontend && npm run build"
    )

app.mount("/", StaticFiles(directory=frontend_dist_path, html=True), name="static")
