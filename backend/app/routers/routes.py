from __future__ import annotations

from fastapi import APIRouter

from ..dependencies import route_lock, route_service
from ..schemas.route import SaveRouteRequest

router = APIRouter()


@router.post("/api/routes")
async def create_tracking_route(payload: SaveRouteRequest):
    async with route_lock:
        return await route_service.create_tracking_route(payload)

