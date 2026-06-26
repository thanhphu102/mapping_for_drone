from __future__ import annotations

from typing import Any
from uuid import uuid4

from fastapi import HTTPException

from ..core.time import now_ts
from ..repositories.json_project_repository import JsonProjectRepository
from ..schemas.project import ProjectSource, ProjectStatus
from . import geometry_service

large_area_threshold_m2 = 5_000_000
extremely_large_area_threshold_m2 = 50_000_000

DEFAULT_ZOOM_THRESHOLDS: dict[str, Any] = {
    "boundaryMinZoom": 13,
    "detailMinZoom": 16,
    "indoorMinZoom": None,
}


def clone_json_value(value: Any) -> Any:
    import json

    return json.loads(json.dumps(value))


def area_warnings(geometry_stats_value: dict[str, Any]) -> dict[str, Any]:
    warnings: list[str] = []
    area_m2 = float(geometry_stats_value["areaM2"])
    if area_m2 >= large_area_threshold_m2:
        warnings.append("Large area detected. Editing remains supported, but dense detail may be harder to manage.")
    if area_m2 >= extremely_large_area_threshold_m2:
        warnings.append("Extremely large boundary detected. Confirmation is required before project creation.")

    return {
        "warnings": warnings,
        "requiresConfirmation": area_m2 >= extremely_large_area_threshold_m2,
    }


def default_project_config() -> dict[str, Any]:
    thresholds = DEFAULT_ZOOM_THRESHOLDS
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
    osm_type: str | None,
    osm_id: int | None,
    osm_tags: dict[str, str],
    parent_project_id: str | None = None,
    source_feature_id: str | None = None,
    status: ProjectStatus = "draft",
    floors_enabled: bool = False,
) -> dict[str, Any]:
    now = now_ts()
    thresholds = DEFAULT_ZOOM_THRESHOLDS
    stats = geometry_service.geometry_stats(geometry)
    return {
        "id": str(uuid4()),
        "name": name,
        "source": source,
        "osmType": osm_type,
        "osmId": osm_id,
        "osmTags": osm_tags,
        "baseGeometry": geometry,
        "bbox": stats["bbox"],
        "areaSquareKm": stats["areaSquareKm"],
        "areaM2": stats["areaM2"],
        "perimeterM": stats["perimeterM"],
        "status": status,
        "boundaryMinZoom": thresholds["boundaryMinZoom"],
        "detailMinZoom": thresholds["detailMinZoom"],
        "indoorMinZoom": thresholds["indoorMinZoom"],
        "config": default_project_config(),
        "floorsEnabled": floors_enabled,
        "objects": [
            {
                "id": "object-default",
                "name": name,
                "sourceKey": source,
                "mode": "custom",
                "floors": [],
            }
        ],
        "floors": [],
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
