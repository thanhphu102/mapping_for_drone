from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..dependencies import overlay_service, project_service

router = APIRouter()


@router.get("/api/map-overlays")
async def get_map_overlays(bbox: str):
    try:
        min_lng, min_lat, max_lng, max_lat = [float(value) for value in bbox.split(",")]
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="bbox must be minLng,minLat,maxLng,maxLat") from exc

    projects = await project_service.list_projects()
    overlays = overlay_service.map_overlays(
        projects,
        min_lng=min_lng,
        min_lat=min_lat,
        max_lng=max_lng,
        max_lat=max_lat,
    )
    return {"projects": overlays}

