"""Unit tests for the geofence zone collapse geometry (shapely-backed)."""

from __future__ import annotations

from typing import Any

from backend.app.services import geometry_service, zone_service


def _polygon(coords: list[list[float]]) -> dict[str, Any]:
    return {"type": "Polygon", "coordinates": [coords]}


def _square(x0: float, y0: float, x1: float, y1: float) -> dict[str, Any]:
    return _polygon([[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]])


def _zone_project(pid: str, geometry: dict[str, Any], kind: str = "no_fly_zone") -> dict[str, Any]:
    base = geometry_service.normalize_to_multipolygon_geometry(geometry)
    return {
        "id": pid,
        "kind": kind,
        "name": pid,
        "bbox": geometry_service.geometry_bbox(base),
        "baseGeometry": base,
        "features": [
            {
                "type": "Feature",
                "id": f"{pid}-feature",
                "geometry": geometry,
                "properties": {"featureType": kind, "name": pid},
            }
        ],
    }


BIG = _square(0, 0, 10, 10)


def test_difference_interior_bite_makes_a_donut():
    project = _zone_project("big", BIG)
    interior = _square(4, 4, 6, 6)
    modified, deleted = zone_service.collapse_overlapping_zones(interior, "new", [project])

    assert deleted == []
    assert modified == [project]
    geometry = project["features"][0]["geometry"]
    assert geometry["type"] == "Polygon"
    assert len(geometry["coordinates"]) == 2  # outer ring + one hole


def test_difference_severing_strip_splits_into_multipolygon():
    project = _zone_project("big", BIG)
    strip = _square(4, -1, 6, 11)  # cuts the square into two halves
    modified, deleted = zone_service.collapse_overlapping_zones(strip, "new", [project])

    assert deleted == []
    geometry = project["features"][0]["geometry"]
    assert geometry["type"] == "MultiPolygon"
    assert len(geometry["coordinates"]) == 2


def test_full_cover_marks_zone_for_deletion():
    project = _zone_project("big", BIG)
    cover = _square(-1, -1, 11, 11)
    modified, deleted = zone_service.collapse_overlapping_zones(cover, "new", [project])

    assert modified == []
    assert deleted == ["big"]


def test_non_overlapping_zone_is_untouched():
    project = _zone_project("big", BIG)
    far = _square(100, 100, 101, 101)
    modified, deleted = zone_service.collapse_overlapping_zones(far, "new", [project])

    assert modified == []
    assert deleted == []


def test_collapse_crosses_zone_types_and_skips_self():
    # An allowed zone is clipped by a newer no-fly zone, but the new zone's own
    # project id is skipped so it never clips itself.
    allowed = _zone_project("allowed", BIG, kind="allowed_zone")
    new_proj = _zone_project("new", _square(4, 4, 6, 6), kind="no_fly_zone")
    modified, deleted = zone_service.collapse_overlapping_zones(
        new_proj["features"][0]["geometry"], "new", [allowed, new_proj]
    )

    assert deleted == []
    assert modified == [allowed]  # the cross-type older zone was clipped
    assert allowed["features"][0]["geometry"]["type"] == "Polygon"
    assert len(allowed["features"][0]["geometry"]["coordinates"]) == 2  # donut hole


def test_shape_to_geojson_normalises_and_drops_slivers():
    from shapely.geometry import LineString, Polygon

    single = Polygon([(0, 0), (1, 0), (1, 1), (0, 1)])
    assert zone_service.shape_to_geojson(single)["type"] == "Polygon"

    multi = single.union(Polygon([(5, 5), (6, 5), (6, 6), (5, 6)]))
    assert zone_service.shape_to_geojson(multi)["type"] == "MultiPolygon"

    assert zone_service.shape_to_geojson(LineString([(0, 0), (1, 1)])) is None


def test_clean_repairs_self_intersecting_polygon():
    # A bow-tie polygon is invalid; clean() should make it valid for boolean ops.
    bowtie = zone_service.geojson_to_shape(_polygon([[0, 0], [2, 2], [2, 0], [0, 2], [0, 0]]))
    assert not bowtie.is_valid
    assert zone_service.clean(bowtie).is_valid


def test_apply_zone_geometry_boundary_contains_feature():
    project: dict[str, Any] = {"id": "p1"}
    geometry = _square(4, 4, 6, 6)
    zone_service.apply_zone_geometry(project, "Zone", geometry, "allowed_zone")

    assert project["kind"] == "allowed_zone"
    feature_geometry = project["features"][0]["geometry"]
    assert geometry_service.feature_inside_boundary(feature_geometry, project["baseGeometry"])
