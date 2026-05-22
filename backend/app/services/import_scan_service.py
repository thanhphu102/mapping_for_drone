from __future__ import annotations

import hashlib
import json
from typing import Any

from fastapi import HTTPException

from ..services import geometry_service

DEFAULT_OBJECT_ID = "object-default"


class ImportScanService:
    def _normalize_scope_key(
        self,
        *,
        object_id: str,
        floor_id: str | None,
        external_id: str | None,
        geometry_hash: str,
    ) -> tuple[str, str, str | None, str]:
        return (
            object_id,
            str(floor_id or ""),
            external_id.strip() if isinstance(external_id, str) and external_id.strip() else None,
            geometry_hash,
        )

    def _existing_scope_keys(
        self,
        *,
        project: dict[str, Any],
        object_id: str,
        floor_id: str | None,
    ) -> set[tuple[str, str, str | None, str]]:
        keys: set[tuple[str, str, str | None, str]] = set()
        features = project.get("features")
        if not isinstance(features, list):
            return keys

        for feature in features:
            if not isinstance(feature, dict):
                continue
            if str(feature.get("objectId") or DEFAULT_OBJECT_ID) != object_id:
                continue

            existing_floor_id = feature.get("floorId")
            properties = feature.get("properties") if isinstance(feature.get("properties"), dict) else {}
            if existing_floor_id is None:
                existing_floor_id = properties.get("floorId")
            if str(existing_floor_id or "") != str(floor_id or ""):
                continue

            geometry_hash = str(properties.get("geometryHash") or "")
            external_id = properties.get("externalId")
            keys.add(
                self._normalize_scope_key(
                    object_id=object_id,
                    floor_id=floor_id,
                    external_id=str(external_id) if external_id is not None else None,
                    geometry_hash=geometry_hash,
                )
            )

        return keys

    def _extract_polygons(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        polygons = payload.get("polygons")
        if not isinstance(polygons, list):
            raise HTTPException(status_code=422, detail="payload.polygons must be an array")
        normalized: list[dict[str, Any]] = []
        for item in polygons:
            if isinstance(item, dict):
                normalized.append(item)
        return normalized

    def _normalize_ring(self, coordinates: Any) -> list[list[float]]:
        if not isinstance(coordinates, list) or len(coordinates) < 3:
            raise HTTPException(status_code=422, detail="Polygon coordinates must contain at least 3 points")
        ring: list[list[float]] = []
        for index, point in enumerate(coordinates):
            if (
                not isinstance(point, list)
                or len(point) != 2
                or not isinstance(point[0], (int, float))
                or not isinstance(point[1], (int, float))
            ):
                raise HTTPException(status_code=422, detail=f"Coordinate at index {index} must be [lng, lat]")
            ring.append([float(point[0]), float(point[1])])
        if ring[0] != ring[-1]:
            ring.append([ring[0][0], ring[0][1]])
        geometry_service.validate_polygon_geometry({"type": "Polygon", "coordinates": [ring]})
        return ring

    def _geometry_hash(self, ring: list[list[float]]) -> str:
        payload = json.dumps(ring, ensure_ascii=True, separators=(",", ":"))
        return hashlib.sha1(payload.encode("utf-8")).hexdigest()

    def ensure_target_object(self, project: dict[str, Any], object_id: str) -> dict[str, Any]:
        objects = project.setdefault("objects", [])
        for item in objects:
            if isinstance(item, dict) and str(item.get("id") or "") == object_id:
                if not isinstance(item.get("floors"), list):
                    item["floors"] = []
                return item
        next_object = {
            "id": object_id,
            "name": object_id,
            "sourceKey": "import",
            "mode": project.get("editorMode") or "custom",
            "floors": [],
        }
        objects.append(next_object)
        return next_object

    def find_existing_feature_id(
        self,
        project: dict[str, Any],
        *,
        object_id: str,
        floor_id: str | None,
        external_id: str | None,
        geometry_hash: str,
    ) -> str | None:
        features = project.get("features")
        if not isinstance(features, list):
            return None
        for feature in features:
            if not isinstance(feature, dict):
                continue
            if str(feature.get("objectId") or DEFAULT_OBJECT_ID) != object_id:
                continue
            existing_floor_id = feature.get("floorId")
            if existing_floor_id is None and isinstance(feature.get("properties"), dict):
                existing_floor_id = feature["properties"].get("floorId")
            if str(existing_floor_id or "") != str(floor_id or ""):
                continue
            properties = feature.get("properties") if isinstance(feature.get("properties"), dict) else {}
            if external_id and str(properties.get("externalId") or "") == external_id:
                return str(feature.get("id")) if feature.get("id") else None
            if str(properties.get("geometryHash") or "") == geometry_hash:
                return str(feature.get("id")) if feature.get("id") else None
        return None

    def _build_feature(
        self,
        *,
        project_id: str,
        object_id: str,
        floor_id: str | None,
        polygon: dict[str, Any],
    ) -> dict[str, Any]:
        ring = self._normalize_ring(polygon.get("coordinates"))
        geometry_hash = self._geometry_hash(ring)
        properties: dict[str, Any] = {
            "featureType": "room",
            "name": polygon.get("name") or "Imported room",
            "externalId": polygon.get("externalId"),
            "tag": polygon.get("tag") or "",
            "noteText": polygon.get("note") or "",
            "floorId": floor_id,
            "geometryHash": geometry_hash,
            "imported": True,
        }
        feature = {
            "type": "Feature",
            "projectId": project_id,
            "objectId": object_id,
            "floorId": floor_id,
            "geometry": {
                "type": "Polygon",
                "coordinates": [ring],
            },
            "properties": properties,
        }
        return feature

    def build_preview(
        self,
        *,
        project: dict[str, Any],
        object_id: str,
        floor_id: str | None,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        polygons = self._extract_polygons(payload)
        preview_features: list[dict[str, Any]] = []
        invalid = 0
        warnings: list[str] = []
        existing_keys = self._existing_scope_keys(
            project=project,
            object_id=object_id,
            floor_id=floor_id,
        )
        import_keys: set[tuple[str, str, str | None, str]] = set()
        for item in polygons:
            try:
                feature = self._build_feature(
                    project_id=str(project.get("id") or ""),
                    object_id=object_id,
                    floor_id=floor_id,
                    polygon=item,
                )
                properties = feature.get("properties") if isinstance(feature.get("properties"), dict) else {}
                geometry_hash = str(properties.get("geometryHash") or "")
                external_id = (
                    str(properties.get("externalId"))
                    if properties.get("externalId") not in (None, "")
                    else None
                )
                scope_key = self._normalize_scope_key(
                    object_id=object_id,
                    floor_id=floor_id,
                    external_id=external_id,
                    geometry_hash=geometry_hash,
                )

                if scope_key in existing_keys:
                    invalid += 1
                    warnings.append("Duplicate polygon on this floor was skipped")
                    continue
                if scope_key in import_keys:
                    invalid += 1
                    warnings.append("Duplicate polygon inside import file was skipped")
                    continue

                import_keys.add(scope_key)
                preview_features.append(feature)
            except HTTPException as exc:
                invalid += 1
                warnings.append(str(exc.detail))

        return {
            "objectId": object_id,
            "floorId": floor_id,
            "detectedRooms": len(polygons),
            "validRooms": len(preview_features),
            "invalidRooms": invalid,
            "warnings": warnings,
            "previewFeatures": preview_features,
        }
