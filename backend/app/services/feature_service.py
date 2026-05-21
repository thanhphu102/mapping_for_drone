from __future__ import annotations

from typing import Any
from uuid import uuid4

from fastapi import HTTPException

from ..core.time import now_ts
from . import geometry_service


class FeatureService:
    def list_features(
        self,
        project: dict[str, Any],
        *,
        published: bool = False,
    ) -> list[dict[str, Any]]:
        key = "publishedFeatures" if published else "features"
        return project.setdefault(key, [])

    def validate_feature_for_project(self, project: dict[str, Any], feature: dict[str, Any]) -> None:
        base_geometry = project.get("baseGeometry")
        if not isinstance(base_geometry, dict):
            raise HTTPException(status_code=422, detail="Project base geometry is required")

        geometry_service.validate_feature_inside_boundary(feature, base_geometry)

        floor_id = feature.get("properties", {}).get("floorId")
        if floor_id:
            floors = project.get("floors", [])
            has_floor = any(
                isinstance(floor, dict) and floor.get("id") == floor_id
                for floor in floors
            )
            if not has_floor:
                raise HTTPException(status_code=422, detail="Feature floorId does not exist in project")

    def normalize_feature(self, feature: dict[str, Any]) -> dict[str, Any]:
        next_feature = dict(feature)
        next_feature["type"] = "Feature"
        next_feature.setdefault("id", str(uuid4()))
        if not isinstance(next_feature.get("properties"), dict):
            next_feature["properties"] = {}
        return next_feature

    def upsert_feature(self, project: dict[str, Any], feature: dict[str, Any]) -> dict[str, Any]:
        self.validate_feature_for_project(project, feature)
        next_feature = self.normalize_feature(feature)
        next_feature["properties"]["updatedAt"] = now_ts()
        features = self.list_features(project)
        existing_index = next(
            (
                index
                for index, current in enumerate(features)
                if current.get("id") == next_feature["id"]
            ),
            None,
        )
        if existing_index is None:
            features.append(next_feature)
        else:
            features[existing_index] = next_feature
        project["updatedAt"] = now_ts()
        return next_feature

    def add_features(self, project: dict[str, Any], features: list[dict[str, Any]]) -> list[dict[str, Any]]:
        added = []

        for feature in features:
            self.validate_feature_for_project(project, feature)
            next_feature = self.normalize_feature(feature)
            next_feature["properties"]["updatedAt"] = now_ts()
            self.list_features(project).append(next_feature)
            added.append(next_feature)

        project["updatedAt"] = now_ts()
        return added

    def replace_features(self, project: dict[str, Any], features: list[dict[str, Any]]) -> list[dict[str, Any]]:
        normalized_features = []
        for feature in features:
            self.validate_feature_for_project(project, feature)
            next_feature = self.normalize_feature(feature)
            next_feature["properties"]["updatedAt"] = now_ts()
            normalized_features.append(next_feature)

        project["features"] = normalized_features
        project["updatedAt"] = now_ts()

        return normalized_features

    def delete_feature(self, project: dict[str, Any], feature_id: str) -> bool:
        features = self.list_features(project)

        next_features = [
            feature for feature in features if feature.get("id") != feature_id
        ]

        deleted = len(next_features) != len(features)

        if deleted:
            project["features"] = next_features
            project["updatedAt"] = now_ts()

        return deleted

    def get_feature(self, project: dict[str, Any], feature_id: str) -> dict[str, Any] | None:
        return next(
            (feature for feature in self.list_features(project) if str(feature.get("id")) == feature_id),
            None,
        )

    def visible_features(
        self,
        project: dict[str, Any],
        bbox: list[float],
        zoom: float,
        floor_id: str | None = None,
    ) -> list[dict[str, Any]]:
        visible_features = []
        for feature in self.list_features(project):
            if not isinstance(feature, dict):
                continue
            properties = feature.get("properties") if isinstance(feature.get("properties"), dict) else {}
            geometry = feature.get("geometry")
            if not isinstance(geometry, dict):
                continue
            if floor_id and str(properties.get("floorId") or "") != floor_id:
                continue
            feature_min_zoom = float(properties.get("minZoom", 0))
            feature_max_zoom = float(properties.get("maxZoom", 24))
            if zoom < feature_min_zoom or zoom > feature_max_zoom:
                continue
            feature_bbox = geometry_service.geometry_bounds(geometry)
            if feature_bbox and geometry_service.bbox_intersects(feature_bbox, bbox):
                visible_features.append(feature)
        return visible_features

