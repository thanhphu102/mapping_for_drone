from __future__ import annotations

import time

from fastapi import APIRouter, HTTPException

from ..core.config import DEBUG_OSM
from ..dependencies import osm_service, project_lock, project_service
from ..schemas.project import OsmType, SaveOsmCityCalibrationRequest
from ..services import geometry_service
from ..services.project_service import (
    classify_enclosing_space,
    derive_city_calibration,
    rotate_multipolygon_geometry,
    translate_multipolygon_geometry,
)

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
async def get_osm_element_geometry(
    osm_type: OsmType,
    osm_id: int,
    calibrationCityKey: str | None = None,
):
    full = osm_service.fetch_osm_full(osm_type, osm_id)
    geometry, tags = osm_service.osm_to_geometry(full, osm_type, osm_id)
    raw_geometry = geometry
    city_key, city_label = derive_city_calibration(tags)
    if calibrationCityKey and calibrationCityKey.strip():
        city_key = calibrationCityKey.strip()
    calibration = await project_service.get_osm_city_calibration(city_key) if city_key else None
    applied_offset_lon = float(calibration.get("offsetLon", 0.0)) if calibration else 0.0
    applied_offset_lat = float(calibration.get("offsetLat", 0.0)) if calibration else 0.0
    applied_rotation_deg = float(calibration.get("rotationDeg", 0.0)) if calibration else 0.0
    calibrated_geometry = translate_multipolygon_geometry(geometry, applied_offset_lon, applied_offset_lat)
    calibrated_geometry = rotate_multipolygon_geometry(calibrated_geometry, applied_rotation_deg)
    stats = geometry_service.geometry_stats(calibrated_geometry)
    classification = classify_enclosing_space(tags, stats, "openstreetmap")
    return {
        "osmType": osm_type,
        "osmId": osm_id,
        "tags": tags,
        "geometry": calibrated_geometry,
        "rawGeometry": raw_geometry,
        "editorMode": classification["editorMode"],
        "classification": classification,
        "bbox": stats["bbox"],
        "areaSquareKm": stats["areaSquareKm"],
        "areaM2": stats["areaM2"],
        "perimeterM": stats["perimeterM"],
        "pointCount": stats["pointCount"],
        "warnings": classification["warnings"],
        "cityCalibrationKey": city_key,
        "cityLabel": city_label,
        "appliedCalibration": {
            "offsetLon": applied_offset_lon,
            "offsetLat": applied_offset_lat,
            "rotationDeg": applied_rotation_deg,
            "updatedAt": calibration.get("updatedAt") if isinstance(calibration, dict) else None,
        },
    }


@router.get("/api/osm/calibrations/by-city")
async def get_osm_city_calibration(cityKey: str):
    calibration = await project_service.get_osm_city_calibration(cityKey)
    return {"cityKey": cityKey, "calibration": calibration}


@router.put("/api/osm/calibrations/by-city")
async def save_osm_city_calibration(payload: SaveOsmCityCalibrationRequest):
    city_key = payload.cityKey.strip()
    if not city_key:
        raise HTTPException(status_code=422, detail="cityKey is required")
    calibration = {
        "cityKey": city_key,
        "cityLabel": payload.cityLabel,
        "offsetLon": float(payload.offsetLon),
        "offsetLat": float(payload.offsetLat),
        "rotationDeg": float(payload.rotationDeg),
        "sourceOsmType": payload.sourceOsmType,
        "sourceOsmId": payload.sourceOsmId,
        "updatedAt": int(time.time()),
    }
    async with project_lock:
        stored = await project_service.upsert_osm_city_calibration(city_key, calibration)
    return {"ok": True, "cityKey": city_key, "calibration": stored}
