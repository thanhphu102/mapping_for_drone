from __future__ import annotations

import json
import ssl
import time
import urllib.parse
import urllib.request
from urllib.error import HTTPError, URLError
from typing import Any

from fastapi import HTTPException

from ..schemas.project import OsmType
from . import geometry_service


class OsmService:
    def __init__(self):
        self._full_cache: dict[str, tuple[float, dict[str, Any]]] = {}
        self._enclosing_cache: dict[str, tuple[float, dict[str, Any]]] = {}
        self._cache_ttl_seconds = 300.0

    def _fetch_json_with_retry(
        self,
        *,
        url: str,
        data: bytes | None = None,
        content_type: str | None = None,
        cache_key: str | None = None,
        timeout_steps: tuple[int, ...] = (8, 14, 22),
    ) -> dict[str, Any]:
        now = time.time()
        if cache_key:
            cached = self._full_cache.get(cache_key) or self._enclosing_cache.get(cache_key)
            if cached and (now - cached[0]) <= self._cache_ttl_seconds:
                return cached[1]

        ctx = ssl._create_unverified_context()
        last_exception: Exception | None = None
        for timeout_seconds in timeout_steps:
            headers = {"User-Agent": "mapping-for-drone-spatial-editor/0.1"}
            if content_type:
                headers["Content-Type"] = content_type
            request = urllib.request.Request(url, data=data, headers=headers)
            try:
                with urllib.request.urlopen(request, timeout=timeout_seconds, context=ctx) as response:
                    payload = json.loads(response.read().decode("utf-8"))
                    if cache_key:
                        target_cache = self._full_cache if cache_key.startswith(("way:", "relation:")) else self._enclosing_cache
                        target_cache[cache_key] = (time.time(), payload)
                    return payload
            except HTTPError as exc:
                last_exception = exc
                if exc.code not in {429, 500, 502, 503, 504}:
                    break
            except URLError as exc:
                last_exception = exc
            except Exception as exc:
                last_exception = exc
            time.sleep(0.25)

        print(f"OSM/Overpass request failed URL: {url}")
        print(f"OSM/Overpass request exception: {repr(last_exception)}")
        raise HTTPException(status_code=502, detail=f"OSM/Overpass request failed: {last_exception}") from last_exception

    def fetch_osm_full(self, osm_type: OsmType, osm_id: int) -> dict[str, Any]:
        cache_key = f"{osm_type}:{osm_id}"
        url = f"https://api.openstreetmap.org/api/0.6/{osm_type}/{osm_id}/full.json"
        return self._fetch_json_with_retry(url=url, cache_key=cache_key)

    def fetch_enclosing_elements(self, lat: float, lon: float) -> dict[str, Any]:
        primary_query = f"""
[out:json][timeout:10];
is_in({lat},{lon})->.areas;
(
  way(pivot.areas);
  relation(pivot.areas);
);
out tags geom;
"""
        fallback_query = f"""
[out:json][timeout:10];
(
  way(around:90,{lat},{lon})[building];
  way(around:90,{lat},{lon})[landuse];
  way(around:90,{lat},{lon})[leisure];
  relation(around:140,{lat},{lon})[boundary=administrative];
  relation(around:120,{lat},{lon})[type=multipolygon];
);
out tags geom;
"""
        endpoints = (
            "https://overpass-api.de/api/interpreter",
            "https://overpass.kumi.systems/api/interpreter",
            "https://overpass.openstreetmap.fr/api/interpreter",
        )
        cache_key = f"enclosing:{lat:.6f}:{lon:.6f}"
        last_error: HTTPException | None = None

        def has_elements(payload: dict[str, Any]) -> bool:
            elements = payload.get("elements")
            return isinstance(elements, list) and len(elements) > 0

        for query_index, query in enumerate((primary_query, fallback_query)):
            for endpoint in endpoints:
                try:
                    payload = self._fetch_json_with_retry(
                        url=endpoint,
                        data=urllib.parse.urlencode({"data": query}).encode("utf-8"),
                        content_type="application/x-www-form-urlencoded;charset=UTF-8",
                        cache_key=cache_key if query_index == 0 else None,
                        timeout_steps=(7, 10, 14),
                    )
                    if has_elements(payload):
                        return payload
                except HTTPException as exc:
                    last_error = exc
                    continue

        if last_error:
            raise last_error
        return {"elements": []}

    def get_elements(self, full: dict[str, Any]) -> list[dict[str, Any]]:
        elements = full.get("elements")
        if not isinstance(elements, list):
            raise HTTPException(status_code=422, detail="OSM payload has no elements array")
        return [element for element in elements if isinstance(element, dict)]

    def find_osm_element(
        self,
        elements: list[dict[str, Any]],
        osm_type: OsmType,
        osm_id: int,
    ) -> dict[str, Any]:
        for element in elements:
            if element.get("type") == osm_type and element.get("id") == osm_id:
                return element
        raise HTTPException(status_code=404, detail="Selected OSM element not found")

    def way_ring(self, way: dict[str, Any], node_map: dict[int, list[float]]) -> list[list[float]]:
        node_ids = way.get("nodes")
        if not isinstance(node_ids, list) or len(node_ids) < 4:
            raise HTTPException(status_code=422, detail="OSM way is not polygon-capable")
        ring: list[list[float]] = []
        for node_id in node_ids:
            if not isinstance(node_id, int) or node_id not in node_map:
                raise HTTPException(status_code=422, detail="OSM way references missing nodes")
            ring.append(node_map[node_id])
        return geometry_service.normalize_ring(ring)

    def way_positions(self, way: dict[str, Any], node_map: dict[int, list[float]]) -> list[list[float]]:
        node_ids = way.get("nodes")
        if not isinstance(node_ids, list) or len(node_ids) < 2:
            return []
        positions: list[list[float]] = []
        for node_id in node_ids:
            if isinstance(node_id, int) and node_id in node_map:
                positions.append(node_map[node_id])
        return positions

    def stitch_way_segments(self, segments: list[list[list[float]]]) -> list[list[list[float]]]:
        unused = [segment[:] for segment in segments if len(segment) >= 2]
        rings: list[list[list[float]]] = []

        while unused:
            ring = unused.pop(0)
            changed = True
            while changed and not geometry_service.same_position(ring[0], ring[-1]):
                changed = False
                for index, segment in enumerate(unused):
                    if geometry_service.same_position(ring[-1], segment[0]):
                        ring.extend(segment[1:])
                    elif geometry_service.same_position(ring[-1], segment[-1]):
                        ring.extend(reversed(segment[:-1]))
                    elif geometry_service.same_position(ring[0], segment[-1]):
                        ring = segment[:-1] + ring
                    elif geometry_service.same_position(ring[0], segment[0]):
                        ring = list(reversed(segment[1:])) + ring
                    else:
                        continue
                    unused.pop(index)
                    changed = True
                    break
            if len(ring) >= 4 and geometry_service.same_position(ring[0], ring[-1]):
                rings.append(geometry_service.normalize_ring(ring))

        return rings

    def osm_to_geometry(
        self,
        full: dict[str, Any],
        osm_type: OsmType,
        osm_id: int,
    ) -> tuple[dict[str, Any], dict[str, str]]:
        elements = self.get_elements(full)
        selected = self.find_osm_element(elements, osm_type, osm_id)
        tags = selected.get("tags") if isinstance(selected.get("tags"), dict) else {}
        clean_tags = {str(key): str(value) for key, value in tags.items()}
        node_map: dict[int, list[float]] = {}
        way_map: dict[int, dict[str, Any]] = {}

        for element in elements:
            if element.get("type") == "node" and isinstance(element.get("id"), int):
                lat = element.get("lat")
                lon = element.get("lon")
                if isinstance(lat, (int, float)) and isinstance(lon, (int, float)):
                    node_map[element["id"]] = [float(lon), float(lat)]
            elif element.get("type") == "way" and isinstance(element.get("id"), int):
                way_map[element["id"]] = element

        if osm_type == "way":
            ring = self.way_ring(selected, node_map)
            return {"type": "MultiPolygon", "coordinates": [[ring]]}, clean_tags

        members = selected.get("members")
        if not isinstance(members, list):
            raise HTTPException(status_code=422, detail="OSM relation has no members")

        outer_segments: list[list[list[float]]] = []
        inner_segments: list[list[list[float]]] = []
        for member in members:
            if not isinstance(member, dict) or member.get("type") != "way":
                continue
            ref = member.get("ref")
            way = way_map.get(ref) if isinstance(ref, int) else None
            if way is None:
                continue
            positions = self.way_positions(way, node_map)
            if len(positions) < 2:
                continue
            if member.get("role") == "inner":
                inner_segments.append(positions)
            else:
                outer_segments.append(positions)

        outer_rings = self.stitch_way_segments(outer_segments)
        if not outer_rings:
            raise HTTPException(status_code=422, detail="OSM relation has no closed outer polygon")

        inner_rings = self.stitch_way_segments(inner_segments)
        polygons = [[outer] for outer in outer_rings]
        if len(polygons) == 1:
            polygons[0].extend(inner_rings)

        return {"type": "MultiPolygon", "coordinates": polygons}, clean_tags

    def debug_selection_summary(self, payload: dict[str, Any]) -> None:
        selected_type = payload.get("type")
        selected_id = payload.get("id")
        full = payload.get("full")

        print("\n===== OSM SELECTION =====")
        print(f"Type: {selected_type}")
        print(f"ID: {selected_id}")

        if not isinstance(full, dict):
            print("Raw payload summary: full payload is not a JSON object")
            print("=========================\n")
            return

        elements = full.get("elements")
        if not isinstance(elements, list):
            print("Raw payload summary: no elements array")
            print(f"Top-level keys: {list(full.keys())}")
            print("=========================\n")
            return

        matching_element: dict[str, Any] | None = None
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

        print("\nRaw payload summary:")
        print(f"elements_total={len(elements)}")
        print(f"nodes={len(node_elements)} ways={len(way_elements)} relations={len(relation_elements)}")
        print("=========================\n")
