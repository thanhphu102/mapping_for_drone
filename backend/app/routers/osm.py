from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..core.config import DEBUG_OSM
from ..dependencies import osm_service
from ..schemas.project import OsmType
from ..services import geometry_service
from ..services.project_service import classify_enclosing_space

router = APIRouter()


@router.post("/debug/osm-selection")
async def debug_osm_selection(payload: dict):
    if not DEBUG_OSM:
        raise HTTPException(status_code=404, detail="Not found")
    osm_service.debug_selection_summary(payload)
    return {"ok": True}


@router.get("/api/osm/enclosing")
async def get_enclosing_osm_elements(lat: float, lon: float):
    return osm_service.fetch_enclosing_elements(lat, lon)


@router.get("/api/osm/elements/{osm_type}/{osm_id}/geometry")
async def get_osm_element_geometry(osm_type: OsmType, osm_id: int):
    full = osm_service.fetch_osm_full(osm_type, osm_id)
    geometry, tags = osm_service.osm_to_geometry(full, osm_type, osm_id)
    stats = geometry_service.geometry_stats(geometry)
    classification = classify_enclosing_space(tags, stats, "openstreetmap")
    return {
        "osmType": osm_type,
        "osmId": osm_id,
        "tags": tags,
        "geometry": geometry,
        "editorMode": classification["editorMode"],
        "classification": classification,
        "bbox": stats["bbox"],
        "areaSquareKm": stats["areaSquareKm"],
        "areaM2": stats["areaM2"],
        "perimeterM": stats["perimeterM"],
        "pointCount": stats["pointCount"],
        "warnings": classification["warnings"],
    }
