from __future__ import annotations

import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..services.command_service import connection_service

router = APIRouter()


@router.websocket("/ws/drone/{drone_id}")
async def ws_drone(websocket: WebSocket, drone_id: str):
    await websocket.accept()
    await connection_service.register_drone(drone_id, websocket)
    try:
        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
            except Exception:
                msg = {"raw": data}
            await connection_service.broadcast_to_frontends(
                {"type": "telemetry", "drone_id": drone_id, "payload": msg}
            )
    except WebSocketDisconnect:
        await connection_service.unregister_drone(drone_id)


@router.websocket("/ws/frontend")
async def ws_frontend(websocket: WebSocket):
    await websocket.accept()
    connection_service.register_frontend(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        connection_service.unregister_frontend(websocket)

