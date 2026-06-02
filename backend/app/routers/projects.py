from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException

from ..dependencies import (
    feature_service,
    osm_service,
    project_lock,
    project_service,
)
from ..schemas.project import (
    CreateChildProjectRequest,
    CreateProjectFromGeometryRequest,
    CreateProjectFromOsmRequest,
    ImportGeoJsonProjectRequest,
    OsmType,
)
from ..services import geometry_service
from ..services.project_service import (
    build_project_payload,
    classify_enclosing_space,
    derive_city_calibration,
    rotate_multipolygon_geometry,
    translate_multipolygon_geometry,
    validate_editor_mode,
)

router = APIRouter()


@router.post("/api/drawing-projects/from-osm")
async def create_drawing_project_from_osm(payload: CreateProjectFromOsmRequest):
    full = osm_service.fetch_osm_full(payload.osmType, payload.osmId)
    geometry, tags = osm_service.osm_to_geometry(full, payload.osmType, payload.osmId)
    city_key, _city_label = derive_city_calibration(tags)
    calibration_offset_lon = float(payload.calibrationOffsetLon)
    calibration_offset_lat = float(payload.calibrationOffsetLat)
    calibration_rotation_deg = float(payload.calibrationRotationDeg)
    if payload.calibrationCityKey and payload.calibrationCityKey.strip():
        city_key = payload.calibrationCityKey.strip()
    if calibration_offset_lon == 0 and calibration_offset_lat == 0 and city_key:
        saved = await project_service.get_osm_city_calibration(city_key)
        if isinstance(saved, dict):
            calibration_offset_lon = float(saved.get("offsetLon", 0.0))
            calibration_offset_lat = float(saved.get("offsetLat", 0.0))
            calibration_rotation_deg = float(saved.get("rotationDeg", 0.0))
    geometry = translate_multipolygon_geometry(
        geometry,
        calibration_offset_lon,
        calibration_offset_lat,
    )
    geometry = rotate_multipolygon_geometry(geometry, calibration_rotation_deg)
    stats = geometry_service.geometry_stats(geometry)
    classification = classify_enclosing_space(tags, stats, "openstreetmap")
    if classification["requiresConfirmation"] and not payload.confirmedLargeArea:
        raise HTTPException(
            status_code=409,
            detail=json.dumps(
                {
                    "message": "Extremely large boundary requires confirmation before project creation.",
                    "requiresConfirmation": True,
                    "warnings": classification["warnings"],
                    "classification": classification,
                }
            ),
        )
    editor_mode = (
        validate_editor_mode(payload.editorModeOverride)
        if payload.editorModeOverride
        else classification["editorMode"]
    )
    project = build_project_payload(
        name=tags.get("name") or tags.get("operator") or f"OSM {payload.osmType} {payload.osmId}",
        source="openstreetmap",
        geometry=geometry,
        editor_mode=editor_mode,
        osm_type=payload.osmType,
        osm_id=payload.osmId,
        osm_tags=tags,
    )
    async with project_lock:
        stored_project = await project_service.save_project(project, touch=False)
    return {
        "projectId": stored_project["id"],
        "project": stored_project,
        "editorMode": editor_mode,
        "warnings": classification["warnings"],
        "classification": classification,
    }


@router.post("/api/spatial-projects/from-geometry")
async def create_spatial_project_from_geometry(payload: CreateProjectFromGeometryRequest):
    geometry = geometry_service.normalize_to_multipolygon_geometry(payload.geometry)
    editor_mode = validate_editor_mode(payload.editorMode)
    project = build_project_payload(
        name=payload.name,
        source="manual",
        geometry=geometry,
        editor_mode=editor_mode,
        osm_type=None,
        osm_id=None,
        osm_tags={},
    )
    async with project_lock:
        stored_project = await project_service.save_project(project, touch=False)
    return {"projectId": stored_project["id"], "project": stored_project}


@router.post("/api/spatial-projects/import-geojson")
async def import_spatial_project_geojson(payload: ImportGeoJsonProjectRequest):
    geometry = geometry_service.geometry_from_geojson_payload(payload.geojson)
    stats = geometry_service.geometry_stats(geometry)
    classification = classify_enclosing_space({}, stats, "imported")
    editor_mode = (
        validate_editor_mode(payload.editorMode)
        if payload.editorMode
        else classification["editorMode"]
    )
    project = build_project_payload(
        name=payload.name,
        source="imported",
        geometry=geometry,
        editor_mode=editor_mode,
        osm_type=None,
        osm_id=None,
        osm_tags={},
    )
    async with project_lock:
        stored_project = await project_service.save_project(project, touch=False)
    return {
        "projectId": stored_project["id"],
        "project": stored_project,
        "classification": classification,
    }


@router.get("/api/drawing-projects")
async def list_drawing_projects(
    parentProjectId: str | None = None,
    osmType: OsmType | None = None,
    osmId: int | None = None,
):
    projects = await project_service.list_projects(
        parent_project_id=parentProjectId,
        osm_type=osmType,
        osm_id=osmId,
    )
    return {"projects": projects}


@router.get("/api/drawing-projects/{project_id}")
async def get_drawing_project(project_id: str):
    return await project_service.get_project_or_404(project_id)


@router.get("/api/drawing-projects/{project_id}/layers")
async def get_drawing_project_layers(project_id: str):
    await project_service.get_project_or_404(project_id)
    return {"layers": []}


@router.post("/api/drawing-projects/{project_id}/publish")
async def publish_drawing_project(project_id: str):
    async with project_lock:
        project = await project_service.publish_project(project_id)
    return {"ok": True, "project": project}


@router.delete("/api/drawing-projects/{project_id}")
async def delete_drawing_project(project_id: str):
    async with project_lock:
        deleted = await project_service.delete_project(project_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Drawing project not found")
    return {"ok": True}


@router.post("/api/drawing-projects/{project_id}/features/{feature_id}/create-child-project")
async def create_child_project_from_feature(
    project_id: str, feature_id: str, payload: CreateChildProjectRequest
):
    parent_project = await project_service.get_project_or_404(project_id, detail="Parent project not found")
    feature = feature_service.get_feature(parent_project, feature_id)
    if feature is None:
        raise HTTPException(status_code=404, detail="Feature not found")
    geometry = feature.get("geometry")
    if not isinstance(geometry, dict):
        raise HTTPException(status_code=422, detail="Feature geometry is missing")
    base_geometry = geometry_service.normalize_to_multipolygon_geometry(geometry)
    editor_mode = validate_editor_mode(payload.editorMode)
    if editor_mode not in {"building", "indoor"}:
        raise HTTPException(status_code=422, detail="Child project must use building or indoor mode")
    feature_properties = feature.get("properties") if isinstance(feature.get("properties"), dict) else {}
    child_project = build_project_payload(
        name=payload.name or str(feature_properties.get("name") or "Child Building Project"),
        source="manual",
        geometry=base_geometry,
        editor_mode=editor_mode,
        osm_type=None,
        osm_id=None,
        osm_tags={},
        parent_project_id=project_id,
        source_feature_id=feature_id,
    )
    async with project_lock:
        stored_project = await project_service.save_project(child_project, touch=False)
    return {"childProjectId": stored_project["id"], "project": stored_project}
