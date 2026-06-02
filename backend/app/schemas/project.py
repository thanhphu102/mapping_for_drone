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
    calibrationCityKey: str | None = None
    editorModeOverride: EditorMode | None = None
    confirmedLargeArea: bool = False
    calibrationOffsetLon: float = 0.0
    calibrationOffsetLat: float = 0.0
    calibrationRotationDeg: float = 0.0


class SaveOsmCityCalibrationRequest(BaseModel):
    cityKey: str
    cityLabel: str | None = None
    offsetLon: float
    offsetLat: float
    rotationDeg: float = 0.0
    sourceOsmType: OsmType | None = None
    sourceOsmId: int | None = None


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
