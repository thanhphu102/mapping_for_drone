from __future__ import annotations

import math
from typing import Any

from fastapi import HTTPException


def same_position(left: list[float], right: list[float]) -> bool:
    return left[0] == right[0] and left[1] == right[1]


def signed_ring_area(ring: list[list[float]]) -> float:
    area = 0.0
    for index in range(len(ring) - 1):
        x1, y1 = ring[index]
        x2, y2 = ring[index + 1]
        area += x1 * y2 - x2 * y1
    return area / 2


def normalize_ring(ring: list[list[float]]) -> list[list[float]]:
    if len(ring) < 4 or not same_position(ring[0], ring[-1]):
        raise HTTPException(status_code=422, detail="OSM boundary is not a closed polygon")
    if abs(signed_ring_area(ring)) == 0:
        raise HTTPException(status_code=422, detail="OSM boundary has zero area")
    return ring


def validate_ring_closed(ring: list[list[float]]) -> None:
    normalize_ring(ring)


def normalize_to_multipolygon_geometry(geometry: dict) -> dict:
    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates")
    if geometry_type == "Polygon" and isinstance(coordinates, list):
        normalized = {"type": "MultiPolygon", "coordinates": [coordinates]}
    elif geometry_type == "MultiPolygon" and isinstance(coordinates, list):
        normalized = {"type": "MultiPolygon", "coordinates": coordinates}
    else:
        raise HTTPException(
            status_code=422,
            detail="Only Polygon or MultiPolygon boundaries are supported",
        )

    polygons = normalized["coordinates"]
    if not polygons:
        raise HTTPException(status_code=422, detail="Boundary geometry is empty")
    for polygon in polygons:
        if not isinstance(polygon, list) or not polygon:
            raise HTTPException(status_code=422, detail="Boundary polygon is invalid")
        outer_ring = polygon[0]
        if not isinstance(outer_ring, list):
            raise HTTPException(status_code=422, detail="Boundary outer ring is invalid")
        normalize_ring(outer_ring)
    return normalized


def geometry_from_geojson_payload(geojson: dict[str, Any]) -> dict[str, Any]:
    geojson_type = geojson.get("type")
    if geojson_type == "Feature":
        geometry = geojson.get("geometry")
        if not isinstance(geometry, dict):
            raise HTTPException(status_code=422, detail="GeoJSON feature has no geometry")
        return normalize_to_multipolygon_geometry(geometry)
    if geojson_type == "FeatureCollection":
        features = geojson.get("features")
        if not isinstance(features, list) or not features:
            raise HTTPException(
                status_code=422,
                detail="GeoJSON feature collection is empty",
            )
        polygons: list[Any] = []
        for feature in features:
            if not isinstance(feature, dict) or not isinstance(feature.get("geometry"), dict):
                continue
            geometry = normalize_to_multipolygon_geometry(feature["geometry"])
            polygons.extend(geometry["coordinates"])
        if not polygons:
            raise HTTPException(
                status_code=422,
                detail="GeoJSON has no Polygon or MultiPolygon features",
            )
        return {"type": "MultiPolygon", "coordinates": polygons}
    return normalize_to_multipolygon_geometry(geojson)


def ring_bbox(ring: list[list[float]]) -> list[float]:
    lngs = [point[0] for point in ring]
    lats = [point[1] for point in ring]
    return [min(lngs), min(lats), max(lngs), max(lats)]


def calculate_bbox(geometry: dict) -> list[float]:
    return geometry_bbox(geometry)


def geometry_bbox(geometry: dict) -> list[float]:
    polygons = geometry.get("coordinates", [])
    bounds: list[float] | None = None
    for polygon in polygons:
        if not polygon:
            continue
        bbox = ring_bbox(polygon[0])
        if bounds is None:
            bounds = bbox
        else:
            bounds = [
                min(bounds[0], bbox[0]),
                min(bounds[1], bbox[1]),
                max(bounds[2], bbox[2]),
                max(bounds[3], bbox[3]),
            ]
    return bounds or [0, 0, 0, 0]


def approximate_area_square_km(geometry: dict[str, Any]) -> float:
    total = 0.0
    for polygon in geometry.get("coordinates", []):
        if not polygon:
            continue
        ring = polygon[0]
        if len(ring) < 4:
            continue
        mean_lat = sum(point[1] for point in ring) / len(ring)
        meters_per_lng = 111_320 * math.cos(math.radians(mean_lat))
        meters_per_lat = 110_540
        projected = [[point[0] * meters_per_lng, point[1] * meters_per_lat] for point in ring]
        total += abs(signed_ring_area(projected)) / 1_000_000
    return total


def approximate_perimeter_meters(geometry: dict[str, Any]) -> float:
    total = 0.0
    for polygon in geometry.get("coordinates", []):
        if not polygon:
            continue
        ring = polygon[0]
        for index in range(1, len(ring)):
            left = ring[index - 1]
            right = ring[index]
            mean_lat = (left[1] + right[1]) / 2
            meters_per_lng = 111_320 * math.cos(math.radians(mean_lat))
            meters_per_lat = 110_540
            dx = (right[0] - left[0]) * meters_per_lng
            dy = (right[1] - left[1]) * meters_per_lat
            total += math.hypot(dx, dy)
    return total


def geometry_point_count(geometry: dict[str, Any]) -> int:
    total = 0
    for polygon in geometry.get("coordinates", []):
        for ring in polygon:
            total += len(ring)
    return total


def geometry_stats(geometry: dict[str, Any]) -> dict[str, Any]:
    area_square_km = approximate_area_square_km(geometry)
    return {
        "bbox": geometry_bbox(geometry),
        "areaM2": area_square_km * 1_000_000,
        "areaSquareKm": area_square_km,
        "perimeterM": approximate_perimeter_meters(geometry),
        "pointCount": geometry_point_count(geometry),
    }


def validate_polygon_geometry(geometry: dict) -> None:
    if geometry.get("type") != "Polygon":
        raise HTTPException(status_code=422, detail="geometry.type must be Polygon")
    coordinates = geometry.get("coordinates")
    if not isinstance(coordinates, list) or not coordinates:
        raise HTTPException(status_code=422, detail="Polygon coordinates are invalid")
    outer_ring = coordinates[0]
    if not isinstance(outer_ring, list):
        raise HTTPException(status_code=422, detail="Polygon outer ring is invalid")
    normalize_ring(outer_ring)


def validate_linestring_geometry(geometry: dict) -> None:
    if geometry.get("type") != "LineString":
        raise HTTPException(status_code=422, detail="geometry.type must be LineString")
    coordinates = geometry.get("coordinates")
    if not isinstance(coordinates, list) or len(coordinates) < 2:
        raise HTTPException(
            status_code=422,
            detail="LineString must contain at least 2 coordinates",
        )
    for index, coordinate in enumerate(coordinates):
        if not isinstance(coordinate, list) or len(coordinate) != 2:
            raise HTTPException(
                status_code=422,
                detail=f"Coordinate at index {index} must be [lng, lat]",
            )
        lng, lat = coordinate
        if not isinstance(lng, (int, float)) or not isinstance(lat, (int, float)):
            raise HTTPException(
                status_code=422,
                detail=f"Coordinate at index {index} must contain numeric lng/lat",
            )
        lng_value = float(lng)
        lat_value = float(lat)
        if lng_value < -180 or lng_value > 180 or lat_value < -90 or lat_value > 90:
            raise HTTPException(
                status_code=422,
                detail=f"Coordinate at index {index} is out of bounds",
            )


def validate_feature_geometry(geometry: dict) -> None:
    if geometry.get("type") not in {"Point", "LineString", "Polygon"}:
        raise HTTPException(
            status_code=422,
            detail="Only Point, LineString, and Polygon features are supported",
        )
    if not geometry_positions(geometry):
        raise HTTPException(status_code=422, detail="Feature has no valid coordinates")


def point_in_ring(point: list[float], ring: list[list[float]]) -> bool:
    x, y = point
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        intersects = ((yi > y) != (yj > y)) and (
            x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi
        )
        if intersects:
            inside = not inside
        j = i
    return inside


def point_in_multipolygon(point: list[float], geometry: dict[str, Any]) -> bool:
    for polygon in geometry.get("coordinates", []):
        if not polygon or not point_in_ring(point, polygon[0]):
            continue
        if any(point_in_ring(point, hole) for hole in polygon[1:]):
            continue
        return True
    return False


def geometry_positions(geometry: dict[str, Any]) -> list[list[float]]:
    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates")
    if geometry_type == "Point" and isinstance(coordinates, list):
        return [coordinates]
    if geometry_type == "LineString" and isinstance(coordinates, list):
        return coordinates
    if geometry_type == "Polygon" and isinstance(coordinates, list):
        return [point for ring in coordinates for point in ring]
    return []


def geometry_bounds(geometry: dict[str, Any]) -> list[float] | None:
    points = geometry_positions(geometry)
    if not points:
        return None
    lngs = [float(point[0]) for point in points]
    lats = [float(point[1]) for point in points]
    return [min(lngs), min(lats), max(lngs), max(lats)]


def bbox_intersects(left: list[float], right: list[float]) -> bool:
    return not (
        left[2] < right[0]
        or left[0] > right[2]
        or left[3] < right[1]
        or left[1] > right[3]
    )


def feature_inside_boundary(feature_geometry: dict, boundary_geometry: dict) -> bool:
    positions = geometry_positions(feature_geometry)
    if not positions:
        return False
    for point in positions:
        if (
            not isinstance(point, list)
            or len(point) < 2
            or not isinstance(point[0], (int, float))
            or not isinstance(point[1], (int, float))
            or not point_in_multipolygon([float(point[0]), float(point[1])], boundary_geometry)
        ):
            return False
    return True


def validate_feature_inside_boundary(feature: dict[str, Any], boundary: dict[str, Any]) -> None:
    geometry = feature.get("geometry")
    if not isinstance(geometry, dict):
        raise HTTPException(status_code=422, detail="Feature geometry is required")
    validate_feature_geometry(geometry)
    if not feature_inside_boundary(geometry, boundary):
        raise HTTPException(
            status_code=422,
            detail="Feature must stay inside the project base boundary",
        )


def _coordinate_pair(value: object) -> list[float] | None:
    if (
        isinstance(value, list)
        and len(value) >= 2
        and isinstance(value[0], (int, float))
        and isinstance(value[1], (int, float))
    ):
        return [float(value[0]), float(value[1])]
    return None


def detect_lat_lng_reversed(coordinates: object) -> bool:
    pairs: list[list[float]] = []

    def collect(value: object) -> None:
        pair = _coordinate_pair(value)
        if pair is not None:
            pairs.append(pair)
            return
        if isinstance(value, list):
            for child in value:
                collect(child)

    collect(coordinates)
    if not pairs:
        return False
    reversed_votes = sum(
        1
        for first, second in pairs
        if abs(first) <= 90 and abs(second) > 90
    )
    return reversed_votes > len(pairs) / 2


def normalize_lng_lat_coordinates(coordinates: object) -> object:
    pair = _coordinate_pair(coordinates)
    if pair is not None:
        first, second = pair
        if abs(first) <= 90 and abs(second) > 90:
            return [second, first]
        return coordinates
    if isinstance(coordinates, list):
        return [normalize_lng_lat_coordinates(child) for child in coordinates]
    return coordinates

