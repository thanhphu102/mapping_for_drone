from __future__ import annotations

from typing import Any

from . import geometry_service


class OverlayService:
    def map_overlays(
        self,
        projects: list[dict[str, Any]],
        *,
        min_lng: float,
        min_lat: float,
        max_lng: float,
        max_lat: float,
    ) -> list[dict[str, Any]]:
        overlays = []
        for project in projects:
            if project.get("status") != "published":
                continue
            project_bbox = project.get("bbox") or geometry_service.geometry_bbox(project.get("baseGeometry", {}))
            intersects = not (
                project_bbox[2] < min_lng
                or project_bbox[0] > max_lng
                or project_bbox[3] < min_lat
                or project_bbox[1] > max_lat
            )
            if intersects:
                overlays.append(project)
        return overlays

