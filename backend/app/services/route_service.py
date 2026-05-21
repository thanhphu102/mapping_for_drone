from __future__ import annotations

import re
from typing import Any
from uuid import uuid4

from fastapi import HTTPException

from ..core.config import DATA_DIR
from ..core.time import now_ts
from ..repositories.json_route_repository import JsonRouteRepository
from ..schemas.route import SaveRouteRequest
from . import geometry_service


def normalize_route_name(value: str) -> str:
    cleaned = re.sub(r"\s+", " ", value).strip()
    return cleaned or f"tracked-route-{now_ts()}"


def safe_route_filename_part(name: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9_-]+", "-", name).strip("-").lower()
    return normalized[:64] or "tracked-route"


def normalize_linestring_coordinates(geometry: dict[str, Any]) -> list[list[float]]:
    geometry_service.validate_linestring_geometry(geometry)
    normalized_coordinates: list[list[float]] = []
    for coordinate in geometry.get("coordinates", []):
        lng, lat = coordinate
        normalized_coordinates.append([float(lng), float(lat)])
    return normalized_coordinates


class RouteService:
    def __init__(self, repository: JsonRouteRepository):
        self.repository = repository

    async def create_tracking_route(self, payload: SaveRouteRequest) -> dict[str, Any]:
        route_name = normalize_route_name(payload.name)
        drone_id = str(payload.droneId).strip()
        if not drone_id:
            raise HTTPException(status_code=422, detail="droneId is required")
        coordinates = normalize_linestring_coordinates(payload.geometry)

        if payload.points and len(payload.points) < 2:
            raise HTTPException(status_code=422, detail="points must contain at least 2 items")

        if payload.points and len(payload.points) != len(coordinates):
            raise HTTPException(
                status_code=422,
                detail="points length must match geometry coordinates length",
            )

        normalized_points = []
        for index, point in enumerate(payload.points):
            lng_value = float(point.lng)
            lat_value = float(point.lat)
            if lng_value < -180 or lng_value > 180 or lat_value < -90 or lat_value > 90:
                raise HTTPException(
                    status_code=422,
                    detail=f"Point at index {index} is out of bounds",
                )
            normalized_points.append(
                {
                    "lng": lng_value,
                    "lat": lat_value,
                    "timestamp": int(point.timestamp),
                }
            )

        route_id = str(uuid4())
        saved_at = now_ts()
        filename_base = safe_route_filename_part(route_name)
        filename = f"{saved_at}-{filename_base}-{route_id[:8]}.geojson"
        route_feature = {
            "type": "Feature",
            "geometry": {
                "type": "LineString",
                "coordinates": coordinates,
            },
            "properties": {
                "id": route_id,
                "name": route_name,
                "droneId": drone_id,
                "source": payload.source,
                "createdAt": saved_at,
                "savedAt": saved_at,
                "pointCount": len(coordinates),
            },
            "points": normalized_points,
        }

        full_path = await self.repository.save_route(filename, route_feature)

        return {
            "ok": True,
            "route": {
                "id": route_id,
                "name": route_name,
                "droneId": drone_id,
                "source": payload.source,
                "path": str(full_path.relative_to(DATA_DIR.parent)),
                "savedAt": saved_at,
                "pointCount": len(coordinates),
            },
        }

