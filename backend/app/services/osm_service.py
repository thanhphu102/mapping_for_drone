from __future__ import annotations

import json
import ssl
import urllib.request
from typing import Any

from fastapi import HTTPException

from ..schemas.project import OsmType
from . import geometry_service


class OsmService:
    def fetch_osm_full(self, osm_type: OsmType, osm_id: int) -> dict[str, Any]:
        url = f"https://api.openstreetmap.org/api/0.6/{osm_type}/{osm_id}/full.json"
        request = urllib.request.Request(
            url,
            headers={"User-Agent": "mapping-for-drone-spatial-editor/0.1"},
        )
        ctx = ssl._create_unverified_context()
        try:
            with urllib.request.urlopen(request, timeout=20, context=ctx) as response:
                return json.loads(response.read().decode("utf-8"))
        except Exception as exc:
            print(f"OSM API request failed URL: {url}")
            print(f"OSM API request exception: {repr(exc)}")
            raise HTTPException(status_code=502, detail=f"OSM API request failed: {exc}") from exc

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

