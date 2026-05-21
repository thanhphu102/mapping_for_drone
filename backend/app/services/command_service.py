from __future__ import annotations

import asyncio
from typing import Any

from fastapi import WebSocket


class DroneConnectionService:
    def __init__(self) -> None:
        self.drone_connections: dict[str, WebSocket] = {}
        self.frontend_connections: list[WebSocket] = []
        self.lock = asyncio.Lock()

    async def broadcast_to_frontends(self, message: dict[str, Any]) -> None:
        dead = []
        for ws in list(self.frontend_connections):
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            try:
                self.frontend_connections.remove(ws)
            except ValueError:
                pass

    async def register_drone(self, drone_id: str, websocket: WebSocket) -> None:
        async with self.lock:
            self.drone_connections[drone_id] = websocket
        await self.broadcast_to_frontends({"type": "connect", "drone_id": drone_id})

    async def unregister_drone(self, drone_id: str) -> None:
        async with self.lock:
            self.drone_connections.pop(drone_id, None)
        await self.broadcast_to_frontends({"type": "disconnect", "drone_id": drone_id})

    def register_frontend(self, websocket: WebSocket) -> None:
        self.frontend_connections.append(websocket)

    def unregister_frontend(self, websocket: WebSocket) -> None:
        try:
            self.frontend_connections.remove(websocket)
        except ValueError:
            pass

    async def dispatch_command(self, cmd: dict[str, Any]) -> dict[str, Any]:
        target = cmd.get("target")
        drones = cmd.get("drones", "all")
        message = {"type": "command", "target": target}
        sent = []
        async with self.lock:
            if drones == "all" or drones is None:
                targets = list(self.drone_connections.keys())
            else:
                targets = drones
            for drone_id in targets:
                ws = self.drone_connections.get(drone_id)
                if ws:
                    try:
                        await ws.send_json(message)
                        sent.append(drone_id)
                    except Exception:
                        pass
        await self.broadcast_to_frontends({"type": "command_sent", "target": target, "to": sent})
        return {"ok": True, "sent": sent}


connection_service = DroneConnectionService()

