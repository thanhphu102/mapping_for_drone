from __future__ import annotations

from typing import Any
from uuid import uuid4

from fastapi import HTTPException

from ..core.time import now_ts
from ..repositories.json_project_repository import JsonProjectRepository
from ..schemas.project import EditorMode, ProjectSource, ProjectStatus
from . import geometry_service

allowed_editor_modes = {
    "region",
    "campus",
    "agriculture",
    "building",
    "indoor",
    "parking",
    "custom",
}
large_area_threshold_m2 = 5_000_000
extremely_large_area_threshold_m2 = 50_000_000


def clone_json_value(value: Any) -> Any:
    import json

    return json.loads(json.dumps(value))


def validate_editor_mode(value: str | None) -> EditorMode:
    if value not in allowed_editor_modes:
        raise HTTPException(status_code=422, detail="Invalid editorMode")
    return value  # type: ignore[return-value]


def classify_enclosing_space(
    tags: dict[str, str], geometry_stats_value: dict[str, Any], source: ProjectSource
) -> dict[str, Any]:
    warnings: list[str] = []
    editor_mode: EditorMode = "custom"
    confidence = 0.45
    reason = "Fallback classification for a valid enclosing polygon."

    if source in {"manual", "imported"}:
        editor_mode = "custom"
        confidence = 0.95
        reason = f"Source is {source}, so custom mode is the default."
    elif "building" in tags:
        editor_mode = "building"
        confidence = 0.97
        reason = f"Detected building={tags.get('building')}"
    elif tags.get("amenity") in {"university", "school", "hospital", "college"} or tags.get("operator:type") == "university":
        editor_mode = "campus"
        confidence = 0.94
        reason = f"Detected amenity={tags.get('amenity') or tags.get('operator:type')}"
    elif tags.get("landuse") in {"farmland", "orchard", "meadow", "farmyard"} or "crop" in tags:
        editor_mode = "agriculture"
        confidence = 0.92
        reason = f"Detected agricultural tag {tags.get('landuse') or 'crop=*'}"
    elif tags.get("amenity") == "parking":
        editor_mode = "parking"
        confidence = 0.95
        reason = "Detected amenity=parking"
    elif tags.get("boundary") == "administrative":
        editor_mode = "region"
        confidence = 0.9
        reason = "Detected boundary=administrative"
        warnings.append("Administrative boundary may be too large for detailed editing.")
    elif any(key in tags for key in ("natural", "landuse", "leisure", "amenity")):
        editor_mode = "region"
        confidence = 0.78
        for key in ("natural", "landuse", "leisure", "amenity"):
            if tags.get(key):
                reason = f"Detected {key}={tags[key]}"
                break

    area_m2 = float(geometry_stats_value["areaM2"])
    if area_m2 >= large_area_threshold_m2:
        warnings.append("Large area detected. Editing remains supported, but dense detail may be harder to manage.")
    if area_m2 >= extremely_large_area_threshold_m2:
        warnings.append("Extremely large boundary detected. Confirmation is required before project creation.")

    return {
        "editorMode": editor_mode,
        "confidence": confidence,
        "reason": reason,
        "warnings": warnings,
        "requiresConfirmation": area_m2 >= extremely_large_area_threshold_m2,
    }


def zoom_thresholds_for_mode(editor_mode: EditorMode) -> dict[str, Any]:
    if editor_mode in {"building", "indoor"}:
        return {"boundaryMinZoom": 14, "detailMinZoom": 17, "indoorMinZoom": 18}
    if editor_mode in {"campus", "parking"}:
        return {"boundaryMinZoom": 13, "detailMinZoom": 16, "indoorMinZoom": None}
    return {"boundaryMinZoom": 12, "detailMinZoom": 15, "indoorMinZoom": None}


def default_floors(editor_mode: EditorMode) -> list[dict[str, Any]]:
    if editor_mode in {"building", "indoor"}:
        return [
            {
                "id": "floor-1",
                "label": "1",
                "code": "F1",
                "level": 1,
                "elevation": 0,
                "visible": True,
                "sortOrder": 0,
            }
        ]
    return []


def default_project_config(editor_mode: EditorMode) -> dict[str, Any]:
    thresholds = zoom_thresholds_for_mode(editor_mode)
    return {
        "canvasMode": "dimOutside",
        "defaultZoom": thresholds["boundaryMinZoom"] + 2,
        "detailZoom": thresholds["detailMinZoom"],
        "precisionZoom": max((thresholds["indoorMinZoom"] or thresholds["detailMinZoom"] + 2), thresholds["detailMinZoom"] + 2),
        "minFeaturePixelSize": 8,
        "snapping": {
            "enabled": True,
            "vertex": True,
            "edge": True,
            "midpoint": True,
            "grid": False,
            "distancePx": 12,
        },
        "measurement": {
            "distanceUnit": "m",
            "areaUnit": "m2",
            "precision": 2,
        },
    }


def build_project_payload(
    *,
    name: str,
    source: ProjectSource,
    geometry: dict[str, Any],
    editor_mode: EditorMode,
    osm_type: str | None,
    osm_id: int | None,
    osm_tags: dict[str, str],
    parent_project_id: str | None = None,
    source_feature_id: str | None = None,
    status: ProjectStatus = "draft",
) -> dict[str, Any]:
    now = now_ts()
    thresholds = zoom_thresholds_for_mode(editor_mode)
    stats = geometry_service.geometry_stats(geometry)
    return {
        "id": str(uuid4()),
        "name": name,
        "source": source,
        "osmType": osm_type,
        "osmId": osm_id,
        "osmTags": osm_tags,
        "editorMode": editor_mode,
        "baseGeometry": geometry,
        "bbox": stats["bbox"],
        "areaSquareKm": stats["areaSquareKm"],
        "areaM2": stats["areaM2"],
        "perimeterM": stats["perimeterM"],
        "status": status,
        "boundaryMinZoom": thresholds["boundaryMinZoom"],
        "detailMinZoom": thresholds["detailMinZoom"],
        "indoorMinZoom": thresholds["indoorMinZoom"],
        "config": default_project_config(editor_mode),
        "floors": default_floors(editor_mode),
        "features": [],
        "publishedFeatures": [],
        "parentProjectId": parent_project_id,
        "sourceFeatureId": source_feature_id,
        "createdAt": now,
        "updatedAt": now,
        "publishedAt": None,
    }


class ProjectService:
    def __init__(self, repository: JsonProjectRepository):
        self.repository = repository

    async def list_projects(
        self,
        *,
        parent_project_id: str | None = None,
        osm_type: str | None = None,
        osm_id: int | None = None,
    ) -> list[dict[str, Any]]:
        projects = await self.repository.list_projects()
        filtered_projects: list[dict[str, Any]] = []
        for project in projects:
            if parent_project_id is not None and str(project.get("parentProjectId") or "") != parent_project_id:
                continue
            if osm_type is not None and str(project.get("osmType") or "") != osm_type:
                continue
            if osm_id is not None and int(project.get("osmId") or -1) != osm_id:
                continue
            filtered_projects.append(project)
        return filtered_projects

    async def get_project_or_404(self, project_id: str, detail: str = "Drawing project not found") -> dict[str, Any]:
        project = await self.repository.get_project(project_id)

        if project is None:
            raise HTTPException(status_code=404, detail=detail)

        return project

    async def find_project_by_osm(
        self,
        osm_type: str,
        osm_id: int | str,
    ) -> dict[str, Any] | None:
        return await self.repository.find_project_by_osm(osm_type, osm_id)

    async def save_project(self, project: dict[str, Any], *, touch: bool = True) -> dict[str, Any]:
        if touch:
            project["updatedAt"] = now_ts()
        return await self.repository.replace_project(project)

    async def publish_project(self, project_id: str) -> dict[str, Any]:
        project = await self.get_project_or_404(project_id)

        project["publishedFeatures"] = clone_json_value(project.get("features", []))
        project["status"] = "published"
        project["publishedAt"] = now_ts()
        project["updatedAt"] = now_ts()

        return await self.repository.replace_project(project)

    async def delete_project(self, project_id: str) -> bool:
        return await self.repository.delete_project(project_id)

