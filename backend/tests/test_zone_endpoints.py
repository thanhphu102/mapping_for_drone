"""End-to-end tests for the zone REST endpoints + newest-wins collapse."""

from __future__ import annotations

import json
from typing import Any

import pytest
from fastapi.testclient import TestClient

from backend.app import dependencies
from backend.app.main import app


@pytest.fixture
def client(tmp_path):
    store = tmp_path / "drawing_projects.json"
    store.write_text(json.dumps({"projects": []}))
    repository = dependencies.project_service.repository
    original = repository.path
    repository.path = store
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        repository.path = original


def _square(x0: float, y0: float, x1: float, y1: float) -> dict[str, Any]:
    return {
        "type": "Polygon",
        "coordinates": [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]],
    }


def _overlays(client: TestClient) -> list[dict[str, Any]]:
    response = client.get("/api/map-overlays", params={"bbox": "-5,-5,30,30"})
    assert response.status_code == 200
    return response.json()["projects"]


def _zone_feature(project: dict[str, Any]) -> dict[str, Any]:
    return next(
        feature
        for feature in project["publishedFeatures"]
        if feature["properties"]["featureType"] in {"no_fly_zone", "allowed_zone"}
    )


def test_create_no_fly_zone_publishes_project(client):
    response = client.post("/api/no-fly-zones", json={"geometry": _square(0, 0, 10, 10)})
    assert response.status_code == 200
    project = response.json()["project"]
    assert project["kind"] == "no_fly_zone"
    assert project["status"] == "published"
    assert _zone_feature(project)["properties"]["featureType"] == "no_fly_zone"


def test_overlapping_allowed_zone_clips_no_fly_into_donut(client):
    nfz_id = client.post("/api/no-fly-zones", json={"geometry": _square(0, 0, 10, 10)}).json()[
        "projectId"
    ]
    client.post("/api/allowed-zones", json={"geometry": _square(4, 4, 6, 6)})

    overlays = {project["id"]: project for project in _overlays(client)}
    assert len(overlays) == 2  # both zones present
    assert nfz_id in overlays  # the no-fly zone was reduced, not deleted

    geometry = _zone_feature(overlays[nfz_id])["geometry"]
    if geometry["type"] == "Polygon":
        assert len(geometry["coordinates"]) == 2  # outer ring + carved hole
    else:
        assert geometry["type"] == "MultiPolygon"


def test_zone_fully_covered_by_newer_zone_is_deleted(client):
    small_id = client.post("/api/no-fly-zones", json={"geometry": _square(4, 4, 6, 6)}).json()[
        "projectId"
    ]
    big_id = client.post("/api/no-fly-zones", json={"geometry": _square(0, 0, 10, 10)}).json()[
        "projectId"
    ]

    ids = {project["id"] for project in _overlays(client)}
    assert small_id not in ids  # fully covered -> deleted
    assert big_id in ids


def test_polygon_with_too_few_points_is_rejected(client):
    response = client.post(
        "/api/allowed-zones",
        json={"geometry": {"type": "Polygon", "coordinates": [[[0, 0], [1, 1], [0, 0]]]}},
    )
    assert response.status_code == 422
