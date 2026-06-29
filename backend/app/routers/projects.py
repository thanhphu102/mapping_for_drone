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
    CreateZoneRequest,
    ImportGeoJsonProjectRequest,
    OsmType,
    SetFloorsEnabledRequest,
)
from ..services import geometry_service, zone_service
from ..services.project_service import area_warnings, build_project_payload

router = APIRouter()


@router.post("/api/drawing-projects/from-osm")
async def create_drawing_project_from_osm(payload: CreateProjectFromOsmRequest):
    full = osm_service.fetch_osm_full(payload.osmType, payload.osmId)
    geometry, tags = osm_service.osm_to_geometry(full, payload.osmType, payload.osmId)
    stats = geometry_service.geometry_stats(geometry)
    warnings = area_warnings(stats)
    if warnings["requiresConfirmation"] and not payload.confirmedLargeArea:
        raise HTTPException(
            status_code=409,
            detail=json.dumps(
                {
                    "message": "Extremely large boundary requires confirmation before project creation.",
                    "requiresConfirmation": True,
                    "warnings": warnings["warnings"],
                }
            ),
        )
    project = build_project_payload(
        name=tags.get("name") or tags.get("operator") or f"OSM {payload.osmType} {payload.osmId}",
        source="openstreetmap",
        geometry=geometry,
        osm_type=payload.osmType,
        osm_id=payload.osmId,
        osm_tags=tags,
    )
    async with project_lock:
        stored_project = await project_service.save_project(project, touch=False)
    return {
        "projectId": stored_project["id"],
        "project": stored_project,
        "warnings": warnings["warnings"],
    }


@router.post("/api/spatial-projects/from-geometry")
async def create_spatial_project_from_geometry(payload: CreateProjectFromGeometryRequest):
    geometry = geometry_service.normalize_to_multipolygon_geometry(payload.geometry)
    project = build_project_payload(
        name=payload.name,
        source="manual",
        geometry=geometry,
        osm_type=None,
        osm_id=None,
        osm_tags={},
    )
    async with project_lock:
        stored_project = await project_service.save_project(project, touch=False)
    return {"projectId": stored_project["id"], "project": stored_project}


def _validate_zone_polygon(geometry: dict) -> None:
    """Validate the simple Polygon the UI draws for a zone (>= 3 distinct points)."""
    if not isinstance(geometry, dict) or geometry.get("type") != "Polygon":
        raise HTTPException(status_code=422, detail="geometry must be a GeoJSON Polygon")
    rings = geometry.get("coordinates") or []
    outer = rings[0] if rings else []
    points = [
        [float(p[0]), float(p[1])]
        for p in outer
        if isinstance(p, (list, tuple)) and len(p) >= 2
    ]
    if len(points) >= 2 and points[0] == points[-1]:
        points = points[:-1]
    if len(points) < 3:
        raise HTTPException(status_code=422, detail="Polygon needs at least 3 points")


async def _collapse_other_zones(new_project: dict) -> None:
    """Clip every other overlapping zone with the just-saved newest zone."""
    feature = zone_service.zone_feature_of(new_project)
    if feature is None or not isinstance(feature.get("geometry"), dict):
        return
    all_projects = await project_service.list_projects()
    modified, deleted_ids = zone_service.collapse_overlapping_zones(
        feature["geometry"], new_project["id"], all_projects
    )
    for project in modified:
        await project_service.save_project(project, touch=False)
        await project_service.publish_project(project["id"])
    for project_id in deleted_ids:
        await project_service.delete_project(project_id)


async def _create_zone(
    name: str | None, geometry: dict, feature_type: str, default_name: str
) -> dict:
    _validate_zone_polygon(geometry)
    resolved_name = (name or default_name).strip() or default_name
    project = build_project_payload(
        name=resolved_name,
        source="manual",
        geometry=geometry_service.normalize_to_multipolygon_geometry(geometry),
        osm_type=None,
        osm_id=None,
        osm_tags={},
    )
    async with project_lock:
        zone_service.apply_zone_geometry(project, resolved_name, geometry, feature_type)
        await project_service.save_project(project, touch=False)
        # Save the new zone first so it owns an id and is skipped while it clips
        # every overlapping older zone (newest wins).
        await _collapse_other_zones(project)
        published = await project_service.publish_project(project["id"])
    return {"projectId": published["id"], "project": published}


async def _update_zone(
    project_id: str, name: str | None, geometry: dict, feature_type: str, default_name: str
) -> dict:
    _validate_zone_polygon(geometry)
    async with project_lock:
        project = await project_service.get_project_or_404(project_id)
        resolved_name = (name or project.get("name") or default_name).strip() or default_name
        zone_service.apply_zone_geometry(project, resolved_name, geometry, feature_type)
        await project_service.save_project(project, touch=False)
        await _collapse_other_zones(project)
        published = await project_service.publish_project(project["id"])
    return {"projectId": published["id"], "project": published}


@router.post("/api/no-fly-zones")
async def create_no_fly_zone(payload: CreateZoneRequest):
    return await _create_zone(
        payload.name, payload.geometry, zone_service.NO_FLY_ZONE_FEATURE_TYPE, "No-Fly Zone"
    )


@router.put("/api/no-fly-zones/{project_id}")
async def update_no_fly_zone(project_id: str, payload: CreateZoneRequest):
    return await _update_zone(
        project_id, payload.name, payload.geometry, zone_service.NO_FLY_ZONE_FEATURE_TYPE, "No-Fly Zone"
    )


@router.post("/api/allowed-zones")
async def create_allowed_zone(payload: CreateZoneRequest):
    return await _create_zone(
        payload.name, payload.geometry, zone_service.ALLOWED_ZONE_FEATURE_TYPE, "Allowed Zone"
    )


@router.put("/api/allowed-zones/{project_id}")
async def update_allowed_zone(project_id: str, payload: CreateZoneRequest):
    return await _update_zone(
        project_id, payload.name, payload.geometry, zone_service.ALLOWED_ZONE_FEATURE_TYPE, "Allowed Zone"
    )


@router.post("/api/spatial-projects/import-geojson")
async def import_spatial_project_geojson(payload: ImportGeoJsonProjectRequest):
    geometry = geometry_service.geometry_from_geojson_payload(payload.geojson)
    stats = geometry_service.geometry_stats(geometry)
    warnings = area_warnings(stats)
    project = build_project_payload(
        name=payload.name,
        source="imported",
        geometry=geometry,
        osm_type=None,
        osm_id=None,
        osm_tags={},
    )
    async with project_lock:
        stored_project = await project_service.save_project(project, touch=False)
    return {
        "projectId": stored_project["id"],
        "project": stored_project,
        "warnings": warnings["warnings"],
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


@router.put("/api/drawing-projects/{project_id}/floors-enabled")
async def set_drawing_project_floors_enabled(project_id: str, payload: SetFloorsEnabledRequest):
    async with project_lock:
        project = await project_service.get_project_or_404(project_id)
        project["floorsEnabled"] = payload.floorsEnabled
        stored_project = await project_service.save_project(project)
    return {"project": stored_project}


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
    feature_properties = feature.get("properties") if isinstance(feature.get("properties"), dict) else {}
    child_project = build_project_payload(
        name=payload.name or str(feature_properties.get("name") or "Child Building Project"),
        source="manual",
        geometry=base_geometry,
        osm_type=None,
        osm_id=None,
        osm_tags={},
        parent_project_id=project_id,
        source_feature_id=feature_id,
    )
    async with project_lock:
        stored_project = await project_service.save_project(child_project, touch=False)
    return {"childProjectId": stored_project["id"], "project": stored_project}
