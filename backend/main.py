from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
import asyncio
import json
import os
import math
import time
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Literal
from uuid import uuid4

from pydantic import BaseModel

app = FastAPI()

drone_connections: Dict[str, WebSocket] = {}
frontend_connections: List[WebSocket] = []
lock = asyncio.Lock()

OsmType = Literal["way", "relation"]
EditorMode = Literal[
    "region",
    "campus",
    "agriculture",
    "building",
    "indoor",
    "parking",
    "custom",
]
ProjectSource = Literal["openstreetmap", "manual", "imported"]
ProjectStatus = Literal["draft", "published", "archived"]
allowed_editor_modes = {"region", "campus", "agriculture", "building", "indoor", "parking", "custom"}
allowed_project_statuses = {"draft", "published", "archived"}
large_area_threshold_m2 = 5_000_000
extremely_large_area_threshold_m2 = 50_000_000

data_dir = Path(__file__).resolve().parent / "data"
projects_path = data_dir / "drawing_projects.json"
project_lock = asyncio.Lock()


def use_postgis_storage() -> bool:
    return bool(os.getenv("DATABASE_URL"))


def get_database_url() -> str:
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL is not configured")
    return database_url


def import_psycopg():
    try:
        import psycopg
        from psycopg.rows import dict_row
        from psycopg.types.json import Jsonb
    except ModuleNotFoundError as exc:
        raise RuntimeError(
            "PostGIS storage requires psycopg. Install requirements.txt or unset DATABASE_URL."
        ) from exc
    return psycopg, dict_row, Jsonb


class CreateProjectFromOsmRequest(BaseModel):
    osmType: OsmType
    osmId: int
    editorModeOverride: EditorMode | None = None
    confirmedLargeArea: bool = False


class CreateProjectFromGeometryRequest(BaseModel):
    name: str
    geometry: Dict[str, Any]
    editorMode: EditorMode


class ImportGeoJsonProjectRequest(BaseModel):
    name: str
    geojson: Dict[str, Any]
    editorMode: EditorMode | None = None


class CreateChildProjectRequest(BaseModel):
    name: str | None = None
    editorMode: Literal["building", "indoor"] = "building"


class SaveFeatureRequest(BaseModel):
    feature: Dict[str, Any]


def load_projects() -> Dict[str, Any]:
    if not projects_path.exists():
        return {"projects": []}
    try:
        with projects_path.open("r", encoding="utf-8") as file:
            data = json.load(file)
    except (OSError, json.JSONDecodeError):
        return {"projects": []}
    if not isinstance(data, dict) or not isinstance(data.get("projects"), list):
        return {"projects": []}
    return data


def save_projects(data: Dict[str, Any]) -> None:
    data_dir.mkdir(parents=True, exist_ok=True)
    temp_path = projects_path.with_suffix(".tmp")
    with temp_path.open("w", encoding="utf-8") as file:
        json.dump(data, file, ensure_ascii=False, indent=2)
    temp_path.replace(projects_path)


def fetch_osm_full(osm_type: OsmType, osm_id: int) -> Dict[str, Any]:
    url = f"https://api.openstreetmap.org/api/0.6/{osm_type}/{osm_id}/full.json"
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "mapping-for-drone-spatial-editor/0.1"},
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"OSM API request failed: {exc}") from exc


def get_elements(full: Dict[str, Any]) -> List[Dict[str, Any]]:
    elements = full.get("elements")
    if not isinstance(elements, list):
        raise HTTPException(status_code=422, detail="OSM payload has no elements array")
    return [element for element in elements if isinstance(element, dict)]


def find_osm_element(
    elements: List[Dict[str, Any]], osm_type: OsmType, osm_id: int
) -> Dict[str, Any]:
    for element in elements:
        if element.get("type") == osm_type and element.get("id") == osm_id:
            return element
    raise HTTPException(status_code=404, detail="Selected OSM element not found")


def same_position(left: List[float], right: List[float]) -> bool:
    return left[0] == right[0] and left[1] == right[1]


def signed_ring_area(ring: List[List[float]]) -> float:
    area = 0.0
    for index in range(len(ring) - 1):
        x1, y1 = ring[index]
        x2, y2 = ring[index + 1]
        area += x1 * y2 - x2 * y1
    return area / 2


def normalize_ring(ring: List[List[float]]) -> List[List[float]]:
    if len(ring) < 4 or not same_position(ring[0], ring[-1]):
        raise HTTPException(status_code=422, detail="OSM boundary is not a closed polygon")
    if abs(signed_ring_area(ring)) == 0:
        raise HTTPException(status_code=422, detail="OSM boundary has zero area")
    return ring


def way_ring(way: Dict[str, Any], node_map: Dict[int, List[float]]) -> List[List[float]]:
    node_ids = way.get("nodes")
    if not isinstance(node_ids, list) or len(node_ids) < 4:
        raise HTTPException(status_code=422, detail="OSM way is not polygon-capable")
    ring: List[List[float]] = []
    for node_id in node_ids:
        if not isinstance(node_id, int) or node_id not in node_map:
            raise HTTPException(status_code=422, detail="OSM way references missing nodes")
        ring.append(node_map[node_id])
    return normalize_ring(ring)


def way_positions(way: Dict[str, Any], node_map: Dict[int, List[float]]) -> List[List[float]]:
    node_ids = way.get("nodes")
    if not isinstance(node_ids, list) or len(node_ids) < 2:
        return []
    positions: List[List[float]] = []
    for node_id in node_ids:
        if isinstance(node_id, int) and node_id in node_map:
            positions.append(node_map[node_id])
    return positions


def stitch_way_segments(segments: List[List[List[float]]]) -> List[List[List[float]]]:
    unused = [segment[:] for segment in segments if len(segment) >= 2]
    rings: List[List[List[float]]] = []

    while unused:
        ring = unused.pop(0)
        changed = True
        while changed and not same_position(ring[0], ring[-1]):
            changed = False
            for index, segment in enumerate(unused):
                if same_position(ring[-1], segment[0]):
                    ring.extend(segment[1:])
                elif same_position(ring[-1], segment[-1]):
                    ring.extend(reversed(segment[:-1]))
                elif same_position(ring[0], segment[-1]):
                    ring = segment[:-1] + ring
                elif same_position(ring[0], segment[0]):
                    ring = list(reversed(segment[1:])) + ring
                else:
                    continue
                unused.pop(index)
                changed = True
                break
        if len(ring) >= 4 and same_position(ring[0], ring[-1]):
            rings.append(normalize_ring(ring))

    return rings


def osm_to_geometry(
    full: Dict[str, Any], osm_type: OsmType, osm_id: int
) -> tuple[Dict[str, Any], Dict[str, str]]:
    elements = get_elements(full)
    selected = find_osm_element(elements, osm_type, osm_id)
    tags = selected.get("tags") if isinstance(selected.get("tags"), dict) else {}
    clean_tags = {str(key): str(value) for key, value in tags.items()}
    node_map: Dict[int, List[float]] = {}
    way_map: Dict[int, Dict[str, Any]] = {}

    for element in elements:
        if element.get("type") == "node" and isinstance(element.get("id"), int):
            lat = element.get("lat")
            lon = element.get("lon")
            if isinstance(lat, (int, float)) and isinstance(lon, (int, float)):
                node_map[element["id"]] = [float(lon), float(lat)]
        elif element.get("type") == "way" and isinstance(element.get("id"), int):
            way_map[element["id"]] = element

    if osm_type == "way":
        ring = way_ring(selected, node_map)
        return {"type": "MultiPolygon", "coordinates": [[[ring]]][0]}, clean_tags

    members = selected.get("members")
    if not isinstance(members, list):
        raise HTTPException(status_code=422, detail="OSM relation has no members")

    outer_segments: List[List[List[float]]] = []
    inner_segments: List[List[List[float]]] = []
    for member in members:
        if not isinstance(member, dict) or member.get("type") != "way":
            continue
        ref = member.get("ref")
        way = way_map.get(ref) if isinstance(ref, int) else None
        if way is None:
            continue
        positions = way_positions(way, node_map)
        if len(positions) < 2:
            continue
        if member.get("role") == "inner":
            inner_segments.append(positions)
        else:
            outer_segments.append(positions)

    outer_rings = stitch_way_segments(outer_segments)
    if not outer_rings:
        raise HTTPException(status_code=422, detail="OSM relation has no closed outer polygon")

    inner_rings = stitch_way_segments(inner_segments)
    polygons = [[outer] for outer in outer_rings]
    if len(polygons) == 1:
        polygons[0].extend(inner_rings)

    return {"type": "MultiPolygon", "coordinates": polygons}, clean_tags


def approximate_perimeter_meters(geometry: Dict[str, Any]) -> float:
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


def geometry_point_count(geometry: Dict[str, Any]) -> int:
    total = 0
    for polygon in geometry.get("coordinates", []):
        for ring in polygon:
            total += len(ring)
    return total


def geometry_stats(geometry: Dict[str, Any]) -> Dict[str, Any]:
    area_square_km = approximate_area_square_km(geometry)
    return {
        "bbox": geometry_bbox(geometry),
        "areaM2": area_square_km * 1_000_000,
        "areaSquareKm": area_square_km,
        "perimeterM": approximate_perimeter_meters(geometry),
        "pointCount": geometry_point_count(geometry),
    }


def classify_enclosing_space(
    tags: Dict[str, str], geometry_stats_value: Dict[str, Any], source: ProjectSource
) -> Dict[str, Any]:
    warnings: List[str] = []
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


def zoom_thresholds_for_mode(editor_mode: EditorMode) -> Dict[str, Any]:
    if editor_mode in {"building", "indoor"}:
        return {"boundaryMinZoom": 14, "detailMinZoom": 17, "indoorMinZoom": 18}
    if editor_mode in {"campus", "parking"}:
        return {"boundaryMinZoom": 13, "detailMinZoom": 16, "indoorMinZoom": None}
    return {"boundaryMinZoom": 12, "detailMinZoom": 15, "indoorMinZoom": None}


def default_layers(editor_mode: EditorMode) -> List[Dict[str, Any]]:
    layer_defs = {
        "region": [
            ("Base Boundary", True, 0, 24, []),
            ("Zones", False, 10, 24, ["flight_zone", "no_fly_zone", "custom_area"]),
            ("Routes", False, 10, 20, ["route", "road", "path"]),
            ("Waypoints", False, 14, 24, ["waypoint", "checkpoint", "takeoff_point", "landing_pad"]),
            ("Obstacles", False, 15, 24, ["obstacle"]),
            ("POI", False, 16, 24, ["custom_point"]),
            ("Measurements", False, 19, 24, []),
        ],
        "agriculture": [
            ("Base Boundary", True, 0, 24, []),
            ("Crop Areas", False, 12, 24, ["crop_area"]),
            ("Survey Areas", False, 12, 24, ["survey_area"]),
            ("Flight Zones", False, 10, 24, ["flight_zone"]),
            ("No-Fly Zones", False, 10, 24, ["no_fly_zone"]),
            ("Routes", False, 12, 20, ["route", "irrigation_line"]),
            ("Waypoints", False, 15, 24, ["waypoint", "checkpoint"]),
            ("Obstacles", False, 15, 24, ["obstacle"]),
            ("Landing / Takeoff", False, 15, 24, ["landing_pad", "takeoff_point"]),
            ("Sensors", False, 19, 24, ["sensor", "camera", "charging_station"]),
            ("Measurements", False, 19, 24, []),
        ],
        "campus": [
            ("Base Boundary", True, 0, 24, []),
            ("Buildings", False, 12, 24, ["building_footprint"]),
            ("Internal Roads", False, 12, 20, ["internal_road", "route", "path"]),
            ("Gates", False, 15, 24, ["gate"]),
            ("Parking", False, 14, 24, ["parking_zone"]),
            ("Flight Zones", False, 11, 24, ["flight_zone"]),
            ("No-Fly Zones", False, 11, 24, ["no_fly_zone"]),
            ("Routes", False, 12, 20, ["route", "waypoint"]),
            ("Waypoints", False, 15, 24, ["waypoint", "checkpoint"]),
            ("Obstacles", False, 16, 24, ["obstacle"]),
            ("POI", False, 16, 24, ["outdoor_poi"]),
            ("Measurements", False, 19, 24, []),
        ],
        "parking": [
            ("Base Boundary", True, 0, 24, []),
            ("Parking Slots", False, 16, 24, ["parking_slot"]),
            ("Entrances", False, 15, 24, ["entrance"]),
            ("Exits", False, 15, 24, ["exit"]),
            ("Routes", False, 13, 20, ["route"]),
            ("Checkpoints", False, 16, 24, ["checkpoint"]),
            ("Sensors", False, 19, 24, ["sensor"]),
            ("Cameras", False, 19, 24, ["camera"]),
            ("Obstacles", False, 16, 24, ["obstacle"]),
            ("Measurements", False, 19, 24, []),
        ],
        "building": [
            ("Base Boundary", True, 0, 24, []),
            ("Floors", False, 17, 24, []),
            ("Rooms", False, 18, 24, ["room"]),
            ("Walls", False, 19, 24, ["wall"]),
            ("Doors", False, 19, 24, ["door"]),
            ("Corridors", False, 18, 24, ["corridor"]),
            ("Stairs", False, 18, 24, ["stairs"]),
            ("Elevators", False, 18, 24, ["elevator"]),
            ("Indoor Routes", False, 18, 24, ["indoor_route", "indoor_waypoint"]),
            ("POI", False, 19, 24, ["poi", "entrance", "exit"]),
            ("Sensors", False, 19, 24, ["sensor", "camera"]),
            ("Measurements", False, 19, 24, []),
        ],
        "indoor": [
            ("Base Boundary", True, 0, 24, []),
            ("Floors", False, 17, 24, []),
            ("Rooms", False, 18, 24, ["room"]),
            ("Walls", False, 19, 24, ["wall"]),
            ("Doors", False, 19, 24, ["door"]),
            ("Corridors", False, 18, 24, ["corridor"]),
            ("Stairs", False, 18, 24, ["stairs"]),
            ("Elevators", False, 18, 24, ["elevator"]),
            ("Indoor Routes", False, 18, 24, ["indoor_route", "indoor_waypoint"]),
            ("POI", False, 19, 24, ["poi", "entrance", "exit"]),
            ("Sensors", False, 19, 24, ["sensor", "camera"]),
            ("Measurements", False, 19, 24, []),
        ],
        "custom": [
            ("Base Boundary", True, 0, 24, []),
            ("Areas", False, 12, 24, ["custom_area"]),
            ("Lines", False, 14, 24, ["custom_line"]),
            ("Points", False, 17, 24, ["custom_point"]),
            ("Routes", False, 13, 20, ["route"]),
            ("POI", False, 17, 24, ["poi"]),
            ("Measurements", False, 19, 24, []),
        ],
    }[editor_mode]
    return [
        {
            "id": f"layer-{index}",
            "name": name,
            "locked": locked,
            "visible": True,
            "minZoom": min_zoom,
            "maxZoom": max_zoom,
            "featureTypes": feature_types,
        }
        for index, (name, locked, min_zoom, max_zoom, feature_types) in enumerate(layer_defs)
    ]


def default_floors(editor_mode: EditorMode) -> List[Dict[str, Any]]:
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


def default_project_config(editor_mode: EditorMode) -> Dict[str, Any]:
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


def validate_editor_mode(value: str | None) -> EditorMode:
    if value not in allowed_editor_modes:
        raise HTTPException(status_code=422, detail="Invalid editorMode")
    return value  # type: ignore[return-value]


def normalize_to_multipolygon_geometry(geometry: Dict[str, Any]) -> Dict[str, Any]:
    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates")
    if geometry_type == "Polygon" and isinstance(coordinates, list):
        normalized = {"type": "MultiPolygon", "coordinates": [coordinates]}
    elif geometry_type == "MultiPolygon" and isinstance(coordinates, list):
        normalized = {"type": "MultiPolygon", "coordinates": coordinates}
    else:
        raise HTTPException(status_code=422, detail="Only Polygon or MultiPolygon boundaries are supported")

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


def geometry_from_geojson_payload(geojson: Dict[str, Any]) -> Dict[str, Any]:
    geojson_type = geojson.get("type")
    if geojson_type == "Feature":
        geometry = geojson.get("geometry")
        if not isinstance(geometry, dict):
            raise HTTPException(status_code=422, detail="GeoJSON feature has no geometry")
        return normalize_to_multipolygon_geometry(geometry)
    if geojson_type == "FeatureCollection":
        features = geojson.get("features")
        if not isinstance(features, list) or not features:
            raise HTTPException(status_code=422, detail="GeoJSON feature collection is empty")
        polygons: List[Any] = []
        for feature in features:
            if not isinstance(feature, dict) or not isinstance(feature.get("geometry"), dict):
                continue
            geometry = normalize_to_multipolygon_geometry(feature["geometry"])
            polygons.extend(geometry["coordinates"])
        if not polygons:
            raise HTTPException(status_code=422, detail="GeoJSON has no Polygon or MultiPolygon features")
        return {"type": "MultiPolygon", "coordinates": polygons}
    return normalize_to_multipolygon_geometry(geojson)


def ring_bbox(ring: List[List[float]]) -> List[float]:
    lngs = [point[0] for point in ring]
    lats = [point[1] for point in ring]
    return [min(lngs), min(lats), max(lngs), max(lats)]


def geometry_bbox(geometry: Dict[str, Any]) -> List[float]:
    polygons = geometry.get("coordinates", [])
    bounds: List[float] | None = None
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


def approximate_area_square_km(geometry: Dict[str, Any]) -> float:
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


def point_in_ring(point: List[float], ring: List[List[float]]) -> bool:
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


def point_in_multipolygon(point: List[float], geometry: Dict[str, Any]) -> bool:
    for polygon in geometry.get("coordinates", []):
        if not polygon or not point_in_ring(point, polygon[0]):
            continue
        if any(point_in_ring(point, hole) for hole in polygon[1:]):
            continue
        return True
    return False


def geometry_positions(geometry: Dict[str, Any]) -> List[List[float]]:
    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates")
    if geometry_type == "Point" and isinstance(coordinates, list):
        return [coordinates]
    if geometry_type == "LineString" and isinstance(coordinates, list):
        return coordinates
    if geometry_type == "Polygon" and isinstance(coordinates, list):
        return [point for ring in coordinates for point in ring]
    return []


def geometry_bounds(geometry: Dict[str, Any]) -> List[float] | None:
    points = geometry_positions(geometry)
    if geometry.get("type") == "Polygon":
        points = geometry_positions(geometry)
    elif geometry.get("type") == "Point" and isinstance(geometry.get("coordinates"), list):
        points = [geometry["coordinates"]]
    elif geometry.get("type") == "LineString" and isinstance(geometry.get("coordinates"), list):
        points = geometry["coordinates"]
    if not points:
        return None
    lngs = [float(point[0]) for point in points]
    lats = [float(point[1]) for point in points]
    return [min(lngs), min(lats), max(lngs), max(lats)]


def bbox_intersects(left: List[float], right: List[float]) -> bool:
    return not (
        left[2] < right[0]
        or left[0] > right[2]
        or left[3] < right[1]
        or left[1] > right[3]
    )


def validate_feature_inside_boundary(feature: Dict[str, Any], boundary: Dict[str, Any]) -> None:
    geometry = feature.get("geometry")
    if not isinstance(geometry, dict):
        raise HTTPException(status_code=422, detail="Feature geometry is required")
    if geometry.get("type") not in {"Point", "LineString", "Polygon"}:
        raise HTTPException(status_code=422, detail="Only Point, LineString, and Polygon features are supported")
    positions = geometry_positions(geometry)
    if not positions:
        raise HTTPException(status_code=422, detail="Feature has no valid coordinates")
    for point in positions:
        if (
            not isinstance(point, list)
            or len(point) < 2
            or not isinstance(point[0], (int, float))
            or not isinstance(point[1], (int, float))
            or not point_in_multipolygon([float(point[0]), float(point[1])], boundary)
        ):
            raise HTTPException(status_code=422, detail="Feature must stay inside the project base boundary")


def timestamp_value(value: Any) -> int | None:
    if hasattr(value, "timestamp"):
        return int(value.timestamp())
    if isinstance(value, (int, float)):
        return int(value)
    return None


def postgis_geometry_arg(geometry: Dict[str, Any]) -> str:
    return json.dumps(geometry, ensure_ascii=False)


def normalize_feature(feature: Dict[str, Any]) -> Dict[str, Any]:
    next_feature = dict(feature)
    next_feature["type"] = "Feature"
    next_feature.setdefault("id", str(uuid4()))
    if not isinstance(next_feature.get("properties"), dict):
        next_feature["properties"] = {}
    return next_feature


def feature_to_project_geojson(row: Dict[str, Any]) -> Dict[str, Any]:
    geometry = row.get("geometry")
    if isinstance(geometry, str):
        geometry = json.loads(geometry)
    properties = row.get("properties")
    if not isinstance(properties, dict):
        properties = {}
    return {
        "type": "Feature",
        "id": str(row["id"]),
        "geometry": geometry,
        "properties": properties,
    }


def project_row_to_dict(
    row: Dict[str, Any],
    features: List[Dict[str, Any]] | None = None,
) -> Dict[str, Any]:
    base_geometry = row.get("base_geometry")
    if isinstance(base_geometry, str):
        base_geometry = json.loads(base_geometry)
    return {
        "id": str(row["id"]),
        "name": row["name"],
        "source": row.get("source") or "openstreetmap",
        "osmType": row.get("osm_type"),
        "osmId": row.get("osm_id"),
        "osmTags": row.get("osm_tags") or {},
        "editorMode": row["editor_mode"],
        "baseGeometry": base_geometry,
        "bbox": [
            float(row["min_lng"]),
            float(row["min_lat"]),
            float(row["max_lng"]),
            float(row["max_lat"]),
        ],
        "areaSquareKm": float(row["area_square_km"] or 0),
        "areaM2": float((row["area_square_km"] or 0) * 1_000_000),
        "perimeterM": float(row.get("perimeter_m") or 0),
        "status": row["status"],
        "boundaryMinZoom": row.get("boundary_min_zoom") or 12,
        "detailMinZoom": row.get("detail_min_zoom") or 15,
        "indoorMinZoom": row.get("indoor_min_zoom"),
        "layers": row.get("layers") or [],
        "floors": row.get("floors") or [],
        "features": features or [],
        "parentProjectId": str(row["parent_project_id"]) if row.get("parent_project_id") else None,
        "sourceFeatureId": row.get("source_feature_id"),
        "createdAt": timestamp_value(row.get("created_at")),
        "updatedAt": timestamp_value(row.get("updated_at")),
        "publishedAt": timestamp_value(row.get("published_at")),
        "config": row.get("config") or default_project_config(row["editor_mode"]),
    }


def postgis_project_select_sql(where_clause: str) -> str:
    return f"""
        SELECT
            id,
            name,
            osm_type,
            osm_id,
            osm_tags,
            source,
            editor_mode,
            ST_AsGeoJSON(base_geometry)::jsonb AS base_geometry,
            ST_XMin(Box2D(base_geometry)) AS min_lng,
            ST_YMin(Box2D(base_geometry)) AS min_lat,
            ST_XMax(Box2D(base_geometry)) AS max_lng,
            ST_YMax(Box2D(base_geometry)) AS max_lat,
            ST_Area(base_geometry::geography) / 1000000 AS area_square_km,
            ST_Perimeter(base_geometry::geography) AS perimeter_m,
            status,
            boundary_min_zoom,
            detail_min_zoom,
            indoor_min_zoom,
            config,
            layers,
            floors,
            parent_project_id,
            source_feature_id,
            created_at,
            updated_at,
            published_at
        FROM drawing_projects
        {where_clause}
    """


def ensure_postgis_schema() -> None:
    if not use_postgis_storage():
        return

    psycopg, _, _ = import_psycopg()
    with psycopg.connect(get_database_url(), autocommit=True) as connection:
        connection.execute("CREATE EXTENSION IF NOT EXISTS postgis")
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS drawing_projects (
                id uuid PRIMARY KEY,
                name text NOT NULL,
                source text NOT NULL DEFAULT 'openstreetmap',
                osm_type text,
                osm_id bigint,
                osm_tags jsonb NOT NULL DEFAULT '{}'::jsonb,
                editor_mode text NOT NULL,
                base_geometry geometry(MultiPolygon, 4326) NOT NULL,
                status text NOT NULL DEFAULT 'draft',
                boundary_min_zoom integer NOT NULL DEFAULT 12,
                detail_min_zoom integer NOT NULL DEFAULT 15,
                indoor_min_zoom integer,
                config jsonb NOT NULL DEFAULT '{}'::jsonb,
                layers jsonb NOT NULL DEFAULT '[]'::jsonb,
                floors jsonb NOT NULL DEFAULT '[]'::jsonb,
                parent_project_id uuid REFERENCES drawing_projects(id) ON DELETE SET NULL,
                source_feature_id text,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                published_at timestamptz,
                CONSTRAINT drawing_projects_editor_mode_check CHECK (
                    editor_mode IN ('region', 'campus', 'agriculture', 'building', 'indoor', 'parking', 'custom')
                ),
                CONSTRAINT drawing_projects_status_check CHECK (status IN ('draft', 'published', 'archived')),
                CONSTRAINT drawing_projects_source_check CHECK (source IN ('openstreetmap', 'manual', 'imported')),
                CONSTRAINT drawing_projects_valid_base_geometry CHECK (ST_IsValid(base_geometry))
            )
            """
        )
        connection.execute("ALTER TABLE drawing_projects ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'openstreetmap'")
        connection.execute("ALTER TABLE drawing_projects ADD COLUMN IF NOT EXISTS boundary_min_zoom integer NOT NULL DEFAULT 12")
        connection.execute("ALTER TABLE drawing_projects ADD COLUMN IF NOT EXISTS detail_min_zoom integer NOT NULL DEFAULT 15")
        connection.execute("ALTER TABLE drawing_projects ADD COLUMN IF NOT EXISTS indoor_min_zoom integer")
        connection.execute("ALTER TABLE drawing_projects ADD COLUMN IF NOT EXISTS config jsonb NOT NULL DEFAULT '{}'::jsonb")
        connection.execute("ALTER TABLE drawing_projects ADD COLUMN IF NOT EXISTS published_at timestamptz")
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS custom_features (
                id text PRIMARY KEY,
                project_id uuid NOT NULL REFERENCES drawing_projects(id) ON DELETE CASCADE,
                feature_type text NOT NULL DEFAULT 'custom',
                properties jsonb NOT NULL DEFAULT '{}'::jsonb,
                floor_scope text NOT NULL DEFAULT 'all',
                floors jsonb NOT NULL DEFAULT '[]'::jsonb,
                geometry geometry(Geometry, 4326) NOT NULL,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT custom_features_geometry_type_check CHECK (
                    GeometryType(geometry) IN ('POINT', 'LINESTRING', 'POLYGON')
                ),
                CONSTRAINT custom_features_valid_geometry CHECK (ST_IsValid(geometry))
            )
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS drawing_projects_base_geometry_gix ON drawing_projects USING gist (base_geometry)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS drawing_projects_status_idx ON drawing_projects (status)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS drawing_projects_editor_mode_idx ON drawing_projects (editor_mode)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS drawing_projects_parent_project_idx ON drawing_projects (parent_project_id)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS custom_features_project_idx ON custom_features (project_id)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS custom_features_geometry_gix ON custom_features USING gist (geometry)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS custom_features_feature_type_idx ON custom_features (feature_type)"
        )
        connection.execute(
            "ALTER TABLE custom_features ADD COLUMN IF NOT EXISTS floor_id text"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS custom_features_floor_idx ON custom_features (floor_id)"
        )


@app.on_event("startup")
async def startup_spatial_storage() -> None:
    if use_postgis_storage():
        await asyncio.to_thread(ensure_postgis_schema)


def create_project_json(project: Dict[str, Any]) -> Dict[str, Any]:
    data = load_projects()
    data["projects"].append(project)
    save_projects(data)
    return project


def get_project_json(project_id: str) -> Dict[str, Any] | None:
    data = load_projects()
    for project in data["projects"]:
        if project.get("id") == project_id:
            return project
    return None


def save_feature_json(project_id: str, feature: Dict[str, Any]) -> Dict[str, Any] | None:
    data = load_projects()
    for project in data["projects"]:
        if project.get("id") != project_id:
            continue
        validate_feature_inside_boundary(feature, project["baseGeometry"])
        next_feature = normalize_feature(feature)
        next_feature["properties"]["updatedAt"] = int(time.time())
        existing_index = next(
            (
                index
                for index, current in enumerate(project.get("features", []))
                if current.get("id") == next_feature["id"]
            ),
            None,
        )
        if existing_index is None:
            project.setdefault("features", []).append(next_feature)
        else:
            project["features"][existing_index] = next_feature
        project["updatedAt"] = int(time.time())
        save_projects(data)
        return next_feature
    return None


def publish_project_json(project_id: str) -> Dict[str, Any] | None:
    data = load_projects()
    for project in data["projects"]:
        if project.get("id") == project_id:
            project["status"] = "published"
            project["updatedAt"] = int(time.time())
            project["publishedAt"] = int(time.time())
            save_projects(data)
            return project
    return None


def map_overlays_json(min_lng: float, min_lat: float, max_lng: float, max_lat: float) -> List[Dict[str, Any]]:
    overlays = []
    for project in load_projects()["projects"]:
        if project.get("status") != "published":
            continue
        project_bbox = project.get("bbox") or geometry_bbox(project.get("baseGeometry", {}))
        intersects = not (
            project_bbox[2] < min_lng
            or project_bbox[0] > max_lng
            or project_bbox[3] < min_lat
            or project_bbox[1] > max_lat
        )
        if intersects:
            overlays.append(project)
    return overlays


def create_project_postgis(project: Dict[str, Any]) -> Dict[str, Any]:
    psycopg, dict_row, Jsonb = import_psycopg()
    with psycopg.connect(get_database_url(), row_factory=dict_row) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO drawing_projects (
                    id,
                    name,
                    source,
                    osm_type,
                    osm_id,
                    osm_tags,
                    editor_mode,
                    base_geometry,
                    status,
                    boundary_min_zoom,
                    detail_min_zoom,
                    indoor_min_zoom,
                    config,
                    layers,
                    floors,
                    parent_project_id,
                    source_feature_id,
                    created_at,
                    updated_at,
                    published_at
                )
                VALUES (
                    %(id)s,
                    %(name)s,
                    %(source)s,
                    %(osm_type)s,
                    %(osm_id)s,
                    %(osm_tags)s,
                    %(editor_mode)s,
                    ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(%(base_geometry)s), 4326)),
                    %(status)s,
                    %(boundary_min_zoom)s,
                    %(detail_min_zoom)s,
                    %(indoor_min_zoom)s,
                    %(config)s,
                    %(layers)s,
                    %(floors)s,
                    %(parent_project_id)s,
                    %(source_feature_id)s,
                    to_timestamp(%(created_at)s),
                    to_timestamp(%(updated_at)s),
                    CASE WHEN %(published_at)s IS NULL THEN NULL ELSE to_timestamp(%(published_at)s) END
                )
                """,
                {
                    "id": project["id"],
                    "name": project["name"],
                    "source": project["source"],
                    "osm_type": project["osmType"],
                    "osm_id": project["osmId"],
                    "osm_tags": Jsonb(project["osmTags"]),
                    "editor_mode": project["editorMode"],
                    "base_geometry": postgis_geometry_arg(project["baseGeometry"]),
                    "status": project["status"],
                    "boundary_min_zoom": project["boundaryMinZoom"],
                    "detail_min_zoom": project["detailMinZoom"],
                    "indoor_min_zoom": project["indoorMinZoom"],
                    "config": Jsonb(project["config"]),
                    "layers": Jsonb(project["layers"]),
                    "floors": Jsonb(project["floors"]),
                    "parent_project_id": project.get("parentProjectId"),
                    "source_feature_id": project.get("sourceFeatureId"),
                    "created_at": project["createdAt"],
                    "updated_at": project["updatedAt"],
                    "published_at": project.get("publishedAt"),
                },
            )
        connection.commit()
    stored = get_project_postgis(project["id"])
    if stored is None:
        raise HTTPException(status_code=500, detail="Drawing project was not persisted")
    return stored


def get_project_features_postgis(project_id: str) -> List[Dict[str, Any]]:
    psycopg, dict_row, _ = import_psycopg()
    with psycopg.connect(get_database_url(), row_factory=dict_row) as connection:
        rows = connection.execute(
            """
            SELECT
                id,
                properties,
                ST_AsGeoJSON(geometry)::jsonb AS geometry
            FROM custom_features
            WHERE project_id = %s
            ORDER BY created_at ASC
            """,
            (project_id,),
        ).fetchall()
    return [feature_to_project_geojson(row) for row in rows]


def get_project_visible_features_postgis(
    project_id: str,
    bbox: List[float],
    zoom: float,
    active_layer_id: str | None = None,
) -> List[Dict[str, Any]] | None:
    project = get_project_postgis(project_id)
    if project is None:
        return None
    layers = project.get("layers") if isinstance(project.get("layers"), list) else []
    visible_feature_types = set()
    for layer in layers:
        if not isinstance(layer, dict) or not layer.get("visible", True):
            continue
        min_zoom = float(layer.get("minZoom", 0))
        max_zoom = float(layer.get("maxZoom", 24))
        if zoom < min_zoom or zoom > max_zoom:
            continue
        if active_layer_id and str(layer.get("id")) != active_layer_id:
            continue
        for feature_type in layer.get("featureTypes") or []:
            visible_feature_types.add(str(feature_type))

    psycopg, dict_row, _ = import_psycopg()
    with psycopg.connect(get_database_url(), row_factory=dict_row) as connection:
        rows = connection.execute(
            """
            SELECT
                id,
                properties,
                ST_AsGeoJSON(geometry)::jsonb AS geometry
            FROM custom_features
            WHERE project_id = %(project_id)s
              AND ST_Intersects(geometry, ST_MakeEnvelope(%(min_lng)s, %(min_lat)s, %(max_lng)s, %(max_lat)s, 4326))
            ORDER BY created_at ASC
            """,
            {
                "project_id": project_id,
                "min_lng": bbox[0],
                "min_lat": bbox[1],
                "max_lng": bbox[2],
                "max_lat": bbox[3],
            },
        ).fetchall()
    features = [feature_to_project_geojson(row) for row in rows]
    visible_features = []
    for feature in features:
        properties = feature.get("properties") if isinstance(feature.get("properties"), dict) else {}
        feature_type = str(properties.get("featureType") or "custom")
        feature_min_zoom = float(properties.get("minZoom", 0))
        feature_max_zoom = float(properties.get("maxZoom", 24))
        if zoom < feature_min_zoom or zoom > feature_max_zoom:
            continue
        if visible_feature_types and feature_type not in visible_feature_types:
            continue
        visible_features.append(feature)
    return visible_features


def delete_feature_postgis(project_id: str, feature_id: str) -> bool:
    psycopg, dict_row, _ = import_psycopg()
    with psycopg.connect(get_database_url(), row_factory=dict_row) as connection:
        result = connection.execute(
            "DELETE FROM custom_features WHERE id = %s AND project_id = %s RETURNING id",
            (feature_id, project_id),
        ).fetchone()
        if result:
            connection.execute(
                "UPDATE drawing_projects SET updated_at = now() WHERE id = %s",
                (project_id,),
            )
        connection.commit()
    return result is not None


def update_project_floors_postgis(project_id: str, floors: List[Dict[str, Any]]) -> Dict[str, Any] | None:
    psycopg, dict_row, Jsonb = import_psycopg()
    with psycopg.connect(get_database_url(), row_factory=dict_row) as connection:
        result = connection.execute(
            "UPDATE drawing_projects SET floors = %s, updated_at = now() WHERE id = %s RETURNING id",
            (Jsonb(floors), project_id),
        ).fetchone()
        connection.commit()
    if result is None:
        return None
    return get_project_postgis(project_id)


def get_project_postgis(project_id: str) -> Dict[str, Any] | None:
    psycopg, dict_row, _ = import_psycopg()
    with psycopg.connect(get_database_url(), row_factory=dict_row) as connection:
        row = connection.execute(
            postgis_project_select_sql("WHERE id = %s"),
            (project_id,),
        ).fetchone()
    if row is None:
        return None
    return project_row_to_dict(row, get_project_features_postgis(project_id))


def save_feature_postgis(project_id: str, feature: Dict[str, Any]) -> Dict[str, Any] | None:
    psycopg, dict_row, Jsonb = import_psycopg()
    next_feature = normalize_feature(feature)
    geometry = next_feature.get("geometry")
    if not isinstance(geometry, dict):
        raise HTTPException(status_code=422, detail="Feature geometry is required")
    if geometry.get("type") not in {"Point", "LineString", "Polygon"}:
        raise HTTPException(status_code=422, detail="Only Point, LineString, and Polygon features are supported")

    feature_geometry = postgis_geometry_arg(geometry)
    properties = next_feature["properties"]
    properties["updatedAt"] = int(time.time())
    feature_type = str(properties.get("featureType") or "custom")
    floor_scope = str(properties.get("floorScope") or "all")
    floors = properties.get("floors") if isinstance(properties.get("floors"), list) else []

    with psycopg.connect(get_database_url(), row_factory=dict_row) as connection:
        with connection.cursor() as cursor:
            validation = cursor.execute(
                """
                WITH input_feature AS (
                    SELECT ST_SetSRID(ST_GeomFromGeoJSON(%(feature_geometry)s), 4326) AS geometry
                )
                SELECT
                    ST_IsValid(input_feature.geometry) AS is_valid,
                    ST_Covers(drawing_projects.base_geometry, input_feature.geometry) AS is_inside
                FROM drawing_projects, input_feature
                WHERE drawing_projects.id = %(project_id)s
                """,
                {
                    "project_id": project_id,
                    "feature_geometry": feature_geometry,
                },
            ).fetchone()
            if validation is None:
                return None
            if not validation["is_valid"]:
                raise HTTPException(status_code=422, detail="Feature geometry is invalid")
            if not validation["is_inside"]:
                raise HTTPException(status_code=422, detail="Feature must stay inside the project base boundary")

            cursor.execute(
                """
                INSERT INTO custom_features (
                    id,
                    project_id,
                    feature_type,
                    properties,
                    floor_scope,
                    floors,
                    geometry,
                    updated_at
                )
                VALUES (
                    %(id)s,
                    %(project_id)s,
                    %(feature_type)s,
                    %(properties)s,
                    %(floor_scope)s,
                    %(floors)s,
                    ST_SetSRID(ST_GeomFromGeoJSON(%(feature_geometry)s), 4326),
                    now()
                )
                ON CONFLICT (id) DO UPDATE SET
                    feature_type = EXCLUDED.feature_type,
                    properties = EXCLUDED.properties,
                    floor_scope = EXCLUDED.floor_scope,
                    floors = EXCLUDED.floors,
                    geometry = EXCLUDED.geometry,
                    updated_at = now()
                RETURNING
                    id,
                    properties,
                    ST_AsGeoJSON(geometry)::jsonb AS geometry
                """,
                {
                    "id": str(next_feature["id"]),
                    "project_id": project_id,
                    "feature_type": feature_type,
                    "properties": Jsonb(properties),
                    "floor_scope": floor_scope,
                    "floors": Jsonb(floors),
                    "feature_geometry": feature_geometry,
                },
            )
            row = cursor.fetchone()
            cursor.execute(
                "UPDATE drawing_projects SET updated_at = now() WHERE id = %s",
                (project_id,),
            )
        connection.commit()
    return feature_to_project_geojson(row)


def publish_project_postgis(project_id: str) -> Dict[str, Any] | None:
    psycopg, dict_row, _ = import_psycopg()
    with psycopg.connect(get_database_url(), row_factory=dict_row) as connection:
        row = connection.execute(
            """
            UPDATE drawing_projects
            SET status = 'published', updated_at = now(), published_at = now()
            WHERE id = %s
            RETURNING id
            """,
            (project_id,),
        ).fetchone()
        connection.commit()
    if row is None:
        return None
    return get_project_postgis(project_id)


def map_overlays_postgis(min_lng: float, min_lat: float, max_lng: float, max_lat: float) -> List[Dict[str, Any]]:
    psycopg, dict_row, _ = import_psycopg()
    with psycopg.connect(get_database_url(), row_factory=dict_row) as connection:
        rows = connection.execute(
            postgis_project_select_sql(
                """
                WHERE status = 'published'
                AND ST_Intersects(base_geometry, ST_MakeEnvelope(%s, %s, %s, %s, 4326))
                ORDER BY updated_at DESC
                """
            ),
            (min_lng, min_lat, max_lng, max_lat),
        ).fetchall()
    return [
        project_row_to_dict(row, get_project_features_postgis(str(row["id"])))
        for row in rows
    ]


def storage_status() -> Dict[str, Any]:
    if not use_postgis_storage():
        return {"storage": "json", "postgis": False}
    psycopg, dict_row, _ = import_psycopg()
    with psycopg.connect(get_database_url(), row_factory=dict_row) as connection:
        row = connection.execute(
            "SELECT postgis_full_version() AS postgis_version"
        ).fetchone()
    return {"storage": "postgis", "postgis": True, "postgisVersion": row["postgis_version"]}


async def create_project_record(project: Dict[str, Any]) -> Dict[str, Any]:
    async with project_lock:
        if use_postgis_storage():
            return await asyncio.to_thread(create_project_postgis, project)
        return await asyncio.to_thread(create_project_json, project)


async def get_project_record(project_id: str) -> Dict[str, Any] | None:
    if use_postgis_storage():
        return await asyncio.to_thread(get_project_postgis, project_id)
    return await asyncio.to_thread(get_project_json, project_id)


async def get_project_layers_record(project_id: str) -> List[Dict[str, Any]] | None:
    project = await get_project_record(project_id)
    if project is None:
        return None
    layers = project.get("layers")
    return layers if isinstance(layers, list) else []


async def get_project_features_record(project_id: str) -> List[Dict[str, Any]] | None:
    project = await get_project_record(project_id)
    if project is None:
        return None
    features = project.get("features")
    return features if isinstance(features, list) else []


async def get_project_visible_features_record(
    project_id: str,
    bbox: List[float],
    zoom: float,
    active_layer_id: str | None = None,
    floor_id: str | None = None,
) -> List[Dict[str, Any]] | None:
    if use_postgis_storage():
        return await asyncio.to_thread(
            get_project_visible_features_postgis,
            project_id,
            bbox,
            zoom,
            active_layer_id,
        )
    project = await get_project_record(project_id)
    if project is None:
        return None

    layers = project.get("layers") if isinstance(project.get("layers"), list) else []
    layer_by_id = {
        str(layer.get("id")): layer
        for layer in layers
        if isinstance(layer, dict) and layer.get("id") is not None
    }
    visible_feature_types = set()
    for layer in layers:
        if not isinstance(layer, dict) or not layer.get("visible", True):
            continue
        min_zoom = float(layer.get("minZoom", 0))
        max_zoom = float(layer.get("maxZoom", 24))
        if zoom < min_zoom or zoom > max_zoom:
            continue
        if active_layer_id and str(layer.get("id")) != active_layer_id:
            continue
        for feature_type in layer.get("featureTypes") or []:
            visible_feature_types.add(str(feature_type))

    features = project.get("features") if isinstance(project.get("features"), list) else []
    visible_features = []
    for feature in features:
        if not isinstance(feature, dict):
            continue
        properties = feature.get("properties") if isinstance(feature.get("properties"), dict) else {}
        geometry = feature.get("geometry")
        if not isinstance(geometry, dict):
            continue
        feature_type = str(properties.get("featureType") or "custom")
        feature_min_zoom = float(properties.get("minZoom", 0))
        feature_max_zoom = float(properties.get("maxZoom", 24))
        if zoom < feature_min_zoom or zoom > feature_max_zoom:
            continue
        if visible_feature_types and feature_type not in visible_feature_types:
            continue
        feature_bbox = geometry_bounds(geometry)
        if feature_bbox and bbox_intersects(feature_bbox, bbox):
            visible_features.append(feature)
    return visible_features


async def get_project_feature_record(project_id: str, feature_id: str) -> Dict[str, Any] | None:
    features = await get_project_features_record(project_id)
    if features is None:
        return None
    for feature in features:
        if str(feature.get("id")) == feature_id:
            return feature
    return None


async def save_feature_record(project_id: str, feature: Dict[str, Any]) -> Dict[str, Any] | None:
    async with project_lock:
        if use_postgis_storage():
            return await asyncio.to_thread(save_feature_postgis, project_id, feature)
        return await asyncio.to_thread(save_feature_json, project_id, feature)


async def publish_project_record(project_id: str) -> Dict[str, Any] | None:
    async with project_lock:
        if use_postgis_storage():
            return await asyncio.to_thread(publish_project_postgis, project_id)
        return await asyncio.to_thread(publish_project_json, project_id)


async def map_overlay_records(
    min_lng: float, min_lat: float, max_lng: float, max_lat: float
) -> List[Dict[str, Any]]:
    if use_postgis_storage():
        return await asyncio.to_thread(map_overlays_postgis, min_lng, min_lat, max_lng, max_lat)
    return await asyncio.to_thread(map_overlays_json, min_lng, min_lat, max_lng, max_lat)


def build_project_payload(
    *,
    name: str,
    source: ProjectSource,
    geometry: Dict[str, Any],
    editor_mode: EditorMode,
    osm_type: OsmType | None,
    osm_id: int | None,
    osm_tags: Dict[str, str],
    parent_project_id: str | None = None,
    source_feature_id: str | None = None,
    status: ProjectStatus = "draft",
) -> Dict[str, Any]:
    now = int(time.time())
    thresholds = zoom_thresholds_for_mode(editor_mode)
    stats = geometry_stats(geometry)
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
        "layers": default_layers(editor_mode),
        "floors": default_floors(editor_mode),
        "features": [],
        "parentProjectId": parent_project_id,
        "sourceFeatureId": source_feature_id,
        "createdAt": now,
        "updatedAt": now,
        "publishedAt": None,
    }

async def broadcast_to_frontends(message: dict) -> None:
    dead = []
    for ws in list(frontend_connections):
        try:
            await ws.send_json(message)
        except Exception:
            dead.append(ws)
    for ws in dead:
        try:
            frontend_connections.remove(ws)
        except ValueError:
            pass


@app.websocket("/ws/drone/{drone_id}")
async def ws_drone(websocket: WebSocket, drone_id: str):
    await websocket.accept()
    async with lock:
        drone_connections[drone_id] = websocket
    await broadcast_to_frontends({"type": "connect", "drone_id": drone_id})
    try:
        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
            except Exception:
                msg = {"raw": data}
            await broadcast_to_frontends({"type": "telemetry", "drone_id": drone_id, "payload": msg})
    except WebSocketDisconnect:
        async with lock:
            drone_connections.pop(drone_id, None)
        await broadcast_to_frontends({"type": "disconnect", "drone_id": drone_id})


@app.websocket("/ws/frontend")
async def ws_frontend(websocket: WebSocket):
    await websocket.accept()
    frontend_connections.append(websocket)
    try:
        while True:
            # Keep connection alive; frontend can send pings if desired
            await websocket.receive_text()
    except WebSocketDisconnect:
        try:
            frontend_connections.remove(websocket)
        except ValueError:
            pass


@app.post("/command")
async def post_command(cmd: dict):
    """Dispatch a command to one or more drones.

    Expected JSON shape:
      {"target": {"lat": number, "lon": number, "alt": number (optional)}, "drones": ["id1",...] | "all"}
    """
    target = cmd.get("target")
    drones = cmd.get("drones", "all")
    message = {"type": "command", "target": target}
    sent = []
    async with lock:
        if drones == "all":
            targets = list(drone_connections.keys())
        else:
            targets = drones
        for d in targets:
            ws = drone_connections.get(d)
            if ws:
                try:
                    await ws.send_json(message)
                    sent.append(d)
                except Exception:
                    pass
    await broadcast_to_frontends({"type": "command_sent", "target": target, "to": sent})
    return {"ok": True, "sent": sent}


@app.post("/debug/osm-selection")
async def debug_osm_selection(payload: dict):
    selected_type = payload.get("type")
    selected_id = payload.get("id")
    full = payload.get("full")

    print("\n===== OSM SELECTION =====")
    print(f"Type: {selected_type}")
    print(f"ID: {selected_id}")

    if not isinstance(full, dict):
        print("Raw payload summary: full payload is not a JSON object")
        print("=========================\n")
        return {"ok": True}

    elements = full.get("elements")
    if not isinstance(elements, list):
        print("Raw payload summary: no elements array")
        print(f"Top-level keys: {list(full.keys())}")
        print("=========================\n")
        return {"ok": True}

    matching_element: Dict[str, Any] | None = None
    for element in elements:
        if not isinstance(element, dict):
            continue
        if element.get("type") == selected_type and element.get("id") == selected_id:
            matching_element = element
            break

    if matching_element:
        tags = matching_element.get("tags")
        if isinstance(tags, dict) and tags:
            print("\nTags:")
            for key in sorted(tags.keys()):
                value = tags.get(key)
                print(f"{key} = {value}")
        else:
            print("\nTags: <none>")
    else:
        print("\nMatched selected element: <not found in full payload>")

    node_elements = [
        element for element in elements
        if isinstance(element, dict) and element.get("type") == "node"
    ]
    way_elements = [
        element for element in elements
        if isinstance(element, dict) and element.get("type") == "way"
    ]
    relation_elements = [
        element for element in elements
        if isinstance(element, dict) and element.get("type") == "relation"
    ]

    if selected_type == "way":
        print("\nNodes:")
        if node_elements:
            for index, node in enumerate(node_elements, start=1):
                node_id = node.get("id")
                node_lat = node.get("lat")
                node_lon = node.get("lon")
                print(f"{index}. node {node_id} lat={node_lat} lon={node_lon}")
        else:
            print("<none>")

    if selected_type == "relation":
        print("\nRelation members:")
        members = matching_element.get("members") if matching_element else None
        if isinstance(members, list) and members:
            for index, member in enumerate(members, start=1):
                if not isinstance(member, dict):
                    continue
                member_type = member.get("type")
                member_ref = member.get("ref")
                member_role = member.get("role")
                print(f"{index}. {member_type} {member_ref} role={member_role}")
        else:
            print("<none>")

        print("\nIncluded ways:")
        if way_elements:
            for index, way in enumerate(way_elements, start=1):
                way_id = way.get("id")
                way_nodes = way.get("nodes")
                node_count = len(way_nodes) if isinstance(way_nodes, list) else 0
                print(f"{index}. way {way_id} nodes={node_count}")
        else:
            print("<none>")

        print("\nIncluded nodes:")
        if node_elements:
            for index, node in enumerate(node_elements, start=1):
                node_id = node.get("id")
                node_lat = node.get("lat")
                node_lon = node.get("lon")
                print(f"{index}. node {node_id} lat={node_lat} lon={node_lon}")
        else:
            print("<none>")

    print("\nRaw payload summary:")
    print(f"elements_total={len(elements)}")
    print(f"nodes={len(node_elements)} ways={len(way_elements)} relations={len(relation_elements)}")
    print("=========================\n")
    return {"ok": True}


@app.get("/api/osm/elements/{osm_type}/{osm_id}/geometry")
async def get_osm_element_geometry(osm_type: OsmType, osm_id: int):
    full = fetch_osm_full(osm_type, osm_id)
    geometry, tags = osm_to_geometry(full, osm_type, osm_id)
    stats = geometry_stats(geometry)
    classification = classify_enclosing_space(tags, stats, "openstreetmap")
    return {
        "osmType": osm_type,
        "osmId": osm_id,
        "tags": tags,
        "geometry": geometry,
        "editorMode": classification["editorMode"],
        "classification": classification,
        "bbox": stats["bbox"],
        "areaSquareKm": stats["areaSquareKm"],
        "areaM2": stats["areaM2"],
        "perimeterM": stats["perimeterM"],
        "pointCount": stats["pointCount"],
        "warnings": classification["warnings"],
    }


@app.post("/api/drawing-projects/from-osm")
async def create_drawing_project_from_osm(payload: CreateProjectFromOsmRequest):
    full = fetch_osm_full(payload.osmType, payload.osmId)
    geometry, tags = osm_to_geometry(full, payload.osmType, payload.osmId)
    stats = geometry_stats(geometry)
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
    stored_project = await create_project_record(project)
    return {
        "projectId": stored_project["id"],
        "project": stored_project,
        "editorMode": editor_mode,
        "warnings": classification["warnings"],
        "classification": classification,
    }


@app.post("/api/spatial-projects/from-geometry")
async def create_spatial_project_from_geometry(payload: CreateProjectFromGeometryRequest):
    geometry = normalize_to_multipolygon_geometry(payload.geometry)
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
    stored_project = await create_project_record(project)
    return {"projectId": stored_project["id"], "project": stored_project}


@app.post("/api/spatial-projects/import-geojson")
async def import_spatial_project_geojson(payload: ImportGeoJsonProjectRequest):
    geometry = geometry_from_geojson_payload(payload.geojson)
    stats = geometry_stats(geometry)
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
    stored_project = await create_project_record(project)
    return {
        "projectId": stored_project["id"],
        "project": stored_project,
        "classification": classification,
    }


@app.get("/api/drawing-projects/{project_id}")
async def get_drawing_project(project_id: str):
    project = await get_project_record(project_id)
    if project is not None:
        return project
    raise HTTPException(status_code=404, detail="Drawing project not found")


@app.get("/api/drawing-projects/{project_id}/layers")
async def get_drawing_project_layers(project_id: str):
    layers = await get_project_layers_record(project_id)
    if layers is not None:
        return {"layers": layers}
    raise HTTPException(status_code=404, detail="Drawing project not found")


@app.get("/api/drawing-projects/{project_id}/features")
async def get_drawing_project_features(project_id: str):
    features = await get_project_features_record(project_id)
    if features is not None:
        return {"features": features}
    raise HTTPException(status_code=404, detail="Drawing project not found")


@app.get("/api/map-features")
async def get_map_features(projectId: str, bbox: str, zoom: float, layerId: str | None = None, floorId: str | None = None):
    try:
        parsed_bbox = [float(value) for value in bbox.split(",")]
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="bbox must be minLng,minLat,maxLng,maxLat") from exc
    if len(parsed_bbox) != 4:
        raise HTTPException(status_code=422, detail="bbox must be minLng,minLat,maxLng,maxLat")
    features = await get_project_visible_features_record(projectId, parsed_bbox, zoom, layerId, floorId)
    if features is None:
        raise HTTPException(status_code=404, detail="Drawing project not found")
    return {"features": features}


@app.post("/api/drawing-projects/{project_id}/features")
async def save_drawing_feature(project_id: str, payload: SaveFeatureRequest):
    feature = await save_feature_record(project_id, payload.feature)
    if feature is not None:
        return {"ok": True, "feature": feature}
    raise HTTPException(status_code=404, detail="Drawing project not found")


@app.delete("/api/drawing-projects/{project_id}/features/{feature_id}")
async def delete_drawing_feature(project_id: str, feature_id: str):
    async with project_lock:
        if use_postgis_storage():
            deleted = await asyncio.to_thread(delete_feature_postgis, project_id, feature_id)
        else:
            data = load_projects()
            deleted = False
            for project in data["projects"]:
                if project.get("id") != project_id:
                    continue
                features = project.get("features", [])
                original_length = len(features)
                project["features"] = [f for f in features if f.get("id") != feature_id]
                if len(project["features"]) < original_length:
                    deleted = True
                    project["updatedAt"] = int(time.time())
                    save_projects(data)
                break
    if not deleted:
        raise HTTPException(status_code=404, detail="Feature not found")
    return {"ok": True}


@app.get("/api/drawing-projects/{project_id}/floors")
async def get_project_floors(project_id: str):
    project = await get_project_record(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Drawing project not found")
    floors = project.get("floors") if isinstance(project.get("floors"), list) else []
    return {"floors": floors}


class FloorPayload(BaseModel):
    label: str
    code: str
    level: int
    elevation: float | None = None
    visible: bool = True
    sortOrder: int = 0


@app.post("/api/drawing-projects/{project_id}/floors")
async def create_project_floor(project_id: str, payload: FloorPayload):
    project = await get_project_record(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Drawing project not found")
    floors = project.get("floors") if isinstance(project.get("floors"), list) else []
    new_floor = {
        "id": f"floor-{str(uuid4())[:8]}",
        "label": payload.label,
        "code": payload.code,
        "level": payload.level,
        "elevation": payload.elevation or 0,
        "visible": payload.visible,
        "sortOrder": payload.sortOrder,
    }
    floors.append(new_floor)
    async with project_lock:
        if use_postgis_storage():
            updated = await asyncio.to_thread(update_project_floors_postgis, project_id, floors)
        else:
            data = load_projects()
            updated = None
            for p in data["projects"]:
                if p.get("id") == project_id:
                    p["floors"] = floors
                    p["updatedAt"] = int(time.time())
                    save_projects(data)
                    updated = p
                    break
    if updated is None:
        raise HTTPException(status_code=500, detail="Failed to update floors")
    return {"ok": True, "floor": new_floor, "floors": floors}


@app.put("/api/drawing-projects/{project_id}/floors/{floor_id}")
async def update_project_floor(project_id: str, floor_id: str, payload: FloorPayload):
    project = await get_project_record(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Drawing project not found")
    floors = project.get("floors") if isinstance(project.get("floors"), list) else []
    found = False
    for floor in floors:
        if floor.get("id") == floor_id:
            floor["label"] = payload.label
            floor["code"] = payload.code
            floor["level"] = payload.level
            floor["elevation"] = payload.elevation or 0
            floor["visible"] = payload.visible
            floor["sortOrder"] = payload.sortOrder
            found = True
            break
    if not found:
        raise HTTPException(status_code=404, detail="Floor not found")
    async with project_lock:
        if use_postgis_storage():
            await asyncio.to_thread(update_project_floors_postgis, project_id, floors)
        else:
            data = load_projects()
            for p in data["projects"]:
                if p.get("id") == project_id:
                    p["floors"] = floors
                    p["updatedAt"] = int(time.time())
                    save_projects(data)
                    break
    return {"ok": True, "floors": floors}


@app.delete("/api/drawing-projects/{project_id}/floors/{floor_id}")
async def delete_project_floor(project_id: str, floor_id: str):
    project = await get_project_record(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Drawing project not found")
    floors = project.get("floors") if isinstance(project.get("floors"), list) else []
    original = len(floors)
    floors = [f for f in floors if f.get("id") != floor_id]
    if len(floors) == original:
        raise HTTPException(status_code=404, detail="Floor not found")
    async with project_lock:
        if use_postgis_storage():
            await asyncio.to_thread(update_project_floors_postgis, project_id, floors)
        else:
            data = load_projects()
            for p in data["projects"]:
                if p.get("id") == project_id:
                    p["floors"] = floors
                    p["updatedAt"] = int(time.time())
                    save_projects(data)
                    break
    return {"ok": True, "floors": floors}


@app.post("/api/drawing-projects/{project_id}/publish")
async def publish_drawing_project(project_id: str):
    project = await publish_project_record(project_id)
    if project is not None:
        return {"ok": True, "project": project}
    raise HTTPException(status_code=404, detail="Drawing project not found")


@app.post("/api/drawing-projects/{project_id}/features/{feature_id}/create-child-project")
async def create_child_project_from_feature(
    project_id: str, feature_id: str, payload: CreateChildProjectRequest
):
    parent_project = await get_project_record(project_id)
    if parent_project is None:
        raise HTTPException(status_code=404, detail="Parent project not found")
    feature = await get_project_feature_record(project_id, feature_id)
    if feature is None:
        raise HTTPException(status_code=404, detail="Feature not found")
    geometry = feature.get("geometry")
    if not isinstance(geometry, dict):
        raise HTTPException(status_code=422, detail="Feature geometry is missing")
    base_geometry = normalize_to_multipolygon_geometry(geometry)
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
    stored_project = await create_project_record(child_project)
    return {"childProjectId": stored_project["id"], "project": stored_project}


@app.get("/api/map-overlays")
async def get_map_overlays(bbox: str):
    try:
        min_lng, min_lat, max_lng, max_lat = [float(value) for value in bbox.split(",")]
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="bbox must be minLng,minLat,maxLng,maxLat") from exc

    overlays = await map_overlay_records(min_lng, min_lat, max_lng, max_lat)
    return {"projects": overlays}


@app.get("/api/storage/status")
async def get_storage_status():
    return await asyncio.to_thread(storage_status)

# Mount static files AFTER all routes are defined
frontend_dist_path = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")

# Verify dist directory exists
if not os.path.exists(frontend_dist_path):
    raise RuntimeError(
        f"Frontend dist directory not found at {frontend_dist_path}.\n"
        "Please run: cd frontend && npm run build"
    )


@app.get("/spatial-editor/{project_id}")
async def serve_spatial_editor(project_id: str):
    return FileResponse(os.path.join(frontend_dist_path, "index.html"))


app.mount("/", StaticFiles(directory=frontend_dist_path, html=True), name="static")
