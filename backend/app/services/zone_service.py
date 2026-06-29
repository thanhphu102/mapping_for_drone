"""Geofence zone helpers: shared logic for no-fly and allowed (inclusion) zones.

A "zone" is a standalone published drawing project that carries a single polygon
feature whose ``properties.featureType`` is one of :data:`ZONE_FEATURE_TYPES`.
``kind`` on the project mirrors that feature type.

The headline behaviour here is the **newest-wins collapse**: whenever a new zone
is drawn, it subtracts its area from every overlapping older zone (of either
type). The older zone is reduced -- it may shrink, gain a hole (donut), or split
into a MultiPolygon -- and is deleted only when nothing remains. shapely does the
boolean polygon work; everything else stays in plain GeoJSON dicts so it round
-trips through the JSON project store unchanged.
"""

from __future__ import annotations

from typing import Any
from uuid import uuid4

from shapely.geometry import MultiPolygon, mapping, shape
from shapely.geometry.base import BaseGeometry

from ..core.time import now_ts
from . import geometry_service

NO_FLY_ZONE_FEATURE_TYPE = "no_fly_zone"
ALLOWED_ZONE_FEATURE_TYPE = "allowed_zone"
ZONE_FEATURE_TYPES = frozenset({NO_FLY_ZONE_FEATURE_TYPE, ALLOWED_ZONE_FEATURE_TYPE})

DEFAULT_OBJECT_ID = "object-default"

# The project boundary must strictly contain its zone feature. We inflate the
# zone outward by a small buffer so the boundary keeps roughly the same shape but
# every feature vertex sits inside it (the boundary check is bypassed for zones,
# yet a sane boundary keeps bbox/overlay math correct).
_BOUNDARY_INFLATE_FRACTION = 0.02
_MIN_BOUNDARY_INFLATE_DEG = 1e-6


# --------------------------------------------------------------------------- #
# Zone project introspection
# --------------------------------------------------------------------------- #
def is_zone_project(project: dict[str, Any]) -> bool:
    """True when the project is a standalone no-fly or allowed zone."""
    return isinstance(project, dict) and project.get("kind") in ZONE_FEATURE_TYPES


def zone_feature_of(project: dict[str, Any]) -> dict[str, Any] | None:
    """Return the project's single zone feature (from ``features``), if any."""
    for feature in project.get("features", []) or []:
        if not isinstance(feature, dict):
            continue
        props = feature.get("properties")
        if isinstance(props, dict) and props.get("featureType") in ZONE_FEATURE_TYPES:
            return feature
    return None


# --------------------------------------------------------------------------- #
# GeoJSON <-> shapely
# --------------------------------------------------------------------------- #
def geojson_to_shape(geometry: dict[str, Any]) -> BaseGeometry:
    """Build a shapely geometry from a GeoJSON Polygon/MultiPolygon dict."""
    return shape(geometry)


def clean(geom: BaseGeometry) -> BaseGeometry:
    """Repair invalid geometry (self-touching hand-drawn rings) via ``buffer(0)``."""
    if geom.is_empty or geom.is_valid:
        return geom
    return geom.buffer(0)


def _coords_to_lists(value: Any) -> Any:
    """Recursively turn shapely's coordinate tuples into JSON-friendly lists."""
    if isinstance(value, (list, tuple)):
        return [_coords_to_lists(item) for item in value]
    return value


def _polygonal_parts(geom: BaseGeometry) -> list[BaseGeometry]:
    """Flatten a geometry to its non-degenerate Polygon parts (drop slivers)."""
    if geom.is_empty:
        return []
    geom_type = geom.geom_type
    if geom_type == "Polygon":
        return [geom] if geom.area > 0 else []
    if geom_type in ("MultiPolygon", "GeometryCollection"):
        parts: list[BaseGeometry] = []
        for sub in geom.geoms:
            parts.extend(_polygonal_parts(sub))
        return parts
    # LineString / Point slivers from a difference are discarded.
    return []


def shape_to_geojson(geom: BaseGeometry) -> dict[str, Any] | None:
    """GeoJSON dict for a shapely geometry: single->Polygon, many->MultiPolygon.

    Returns ``None`` when there is no polygonal area left (fully consumed).
    """
    parts = _polygonal_parts(geom)
    if not parts:
        return None
    normalized = parts[0] if len(parts) == 1 else MultiPolygon(parts)
    geo = mapping(normalized)
    return {"type": geo["type"], "coordinates": _coords_to_lists(geo["coordinates"])}


# --------------------------------------------------------------------------- #
# Building / rewriting a zone project's geometry
# --------------------------------------------------------------------------- #
def _inflated_base_geometry(feature_shape: BaseGeometry) -> dict[str, Any]:
    """A MultiPolygon boundary that strictly contains ``feature_shape``."""
    minx, miny, maxx, maxy = feature_shape.bounds
    diagonal = ((maxx - minx) ** 2 + (maxy - miny) ** 2) ** 0.5
    eps = max(diagonal * _BOUNDARY_INFLATE_FRACTION, _MIN_BOUNDARY_INFLATE_DEG)
    inflated = feature_shape.buffer(eps)
    geojson = shape_to_geojson(inflated)
    if geojson is None:  # pragma: no cover - buffer of a real area is non-empty
        geojson = shape_to_geojson(feature_shape)
    return geometry_service.normalize_to_multipolygon_geometry(geojson)


def _build_zone_feature(
    project_id: str,
    feature_type: str,
    name: str,
    geometry: dict[str, Any],
    feature_id: str | None,
) -> dict[str, Any]:
    return {
        "type": "Feature",
        "id": feature_id or str(uuid4()),
        "projectId": project_id,
        "objectId": DEFAULT_OBJECT_ID,
        "floorId": None,
        "geometry": geometry,
        "properties": {
            "featureType": feature_type,
            "name": name,
            "floorId": None,
            "updatedAt": now_ts(),
        },
    }


def _set_zone(
    project: dict[str, Any],
    *,
    name: str,
    feature_type: str,
    feature_geometry: dict[str, Any],
    feature_shape: BaseGeometry,
    feature_id: str | None,
) -> None:
    """Write the zone feature directly onto ``project`` and refresh its stats.

    Bypasses ``feature_service.upsert_feature`` on purpose: collapsed zones can be
    MultiPolygons or have holes, which the generic per-vertex/Polygon-only feature
    validation rejects.
    """
    project["kind"] = feature_type
    project["name"] = name
    project["baseGeometry"] = _inflated_base_geometry(feature_shape)
    stats = geometry_service.geometry_stats(project["baseGeometry"])
    project["bbox"] = stats["bbox"]
    project["areaSquareKm"] = stats["areaSquareKm"]
    project["areaM2"] = stats["areaM2"]
    project["perimeterM"] = stats["perimeterM"]
    # Render/enforce the zone at every overlay zoom, not just close-up.
    project["boundaryMinZoom"] = 1
    project["detailMinZoom"] = 1
    project["features"] = [
        _build_zone_feature(project.get("id", ""), feature_type, name, feature_geometry, feature_id)
    ]


def apply_zone_geometry(
    project: dict[str, Any],
    name: str,
    geometry: dict[str, Any],
    feature_type: str,
) -> None:
    """Apply a freshly drawn zone polygon (the create/update path).

    ``geometry`` is the simple Polygon sent by the UI. The drawn zone is never
    clipped -- it is the newest and wins -- so it is stored as-is (after a cleanup
    pass for robustness).
    """
    feature_shape = clean(geojson_to_shape(geometry))
    feature_geometry = shape_to_geojson(feature_shape) or geometry
    existing = zone_feature_of(project)
    feature_id = existing.get("id") if existing else None
    _set_zone(
        project,
        name=name,
        feature_type=feature_type,
        feature_geometry=feature_geometry,
        feature_shape=feature_shape,
        feature_id=feature_id,
    )


# --------------------------------------------------------------------------- #
# Newest-wins collapse
# --------------------------------------------------------------------------- #
def collapse_overlapping_zones(
    new_geometry: dict[str, Any],
    new_project_id: str,
    projects: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[str]]:
    """Subtract the new zone from every other overlapping zone project.

    Mutates the affected project dicts in place. Returns ``(modified, deleted_ids)``
    where ``modified`` projects need to be saved + republished and ``deleted_ids``
    were fully covered and should be deleted.
    """
    new_shape = clean(geojson_to_shape(new_geometry))
    if new_shape.is_empty:
        return [], []
    new_bounds = list(new_shape.bounds)

    modified: list[dict[str, Any]] = []
    deleted_ids: list[str] = []

    for project in projects:
        if not is_zone_project(project) or str(project.get("id")) == str(new_project_id):
            continue
        feature = zone_feature_of(project)
        if feature is None or not isinstance(feature.get("geometry"), dict):
            continue

        project_bbox = project.get("bbox") or geometry_service.geometry_bbox(
            project.get("baseGeometry", {})
        )
        if not geometry_service.bbox_intersects(project_bbox, new_bounds):
            continue

        old_shape = clean(geojson_to_shape(feature["geometry"]))
        if not old_shape.intersects(new_shape):
            continue

        remainder = clean(old_shape.difference(new_shape))
        remainder_geojson = shape_to_geojson(remainder)
        if remainder_geojson is None:
            # Fully covered by the newer zone -> nothing left to keep.
            deleted_ids.append(str(project.get("id")))
            continue

        feature_type = feature["properties"].get("featureType", project.get("kind"))
        _set_zone(
            project,
            name=project.get("name") or feature["properties"].get("name") or "Zone",
            feature_type=feature_type,
            feature_geometry=remainder_geojson,
            feature_shape=remainder,
            feature_id=feature.get("id"),
        )
        modified.append(project)

    return modified, deleted_ids
