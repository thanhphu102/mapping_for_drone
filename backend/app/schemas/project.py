from pydantic import BaseModel
from typing import Any, Literal

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


class CreateProjectFromOsmRequest(BaseModel):
    osmType: OsmType
    osmId: int
    editorModeOverride: EditorMode | None = None
    confirmedLargeArea: bool = False


class CreateProjectFromGeometryRequest(BaseModel):
    name: str
    geometry: dict[str, Any]
    editorMode: EditorMode


class ImportGeoJsonProjectRequest(BaseModel):
    name: str
    geojson: dict[str, Any]
    editorMode: EditorMode | None = None


class CreateChildProjectRequest(BaseModel):
    name: str | None = None
    editorMode: Literal["building", "indoor"] = "building"

