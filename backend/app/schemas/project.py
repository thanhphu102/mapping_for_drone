from pydantic import BaseModel
from typing import Any, Literal

OsmType = Literal["way", "relation"]
ProjectSource = Literal["openstreetmap", "manual", "imported"]
ProjectStatus = Literal["draft", "published", "archived"]


class CreateProjectFromOsmRequest(BaseModel):
    osmType: OsmType
    osmId: int
    confirmedLargeArea: bool = False


class CreateProjectFromGeometryRequest(BaseModel):
    name: str
    geometry: dict[str, Any]


class ImportGeoJsonProjectRequest(BaseModel):
    name: str
    geojson: dict[str, Any]


class CreateZoneRequest(BaseModel):
    name: str | None = None
    # GeoJSON Polygon geometry in [lon, lat] order.
    geometry: dict[str, Any]


# Backwards-compatible alias: no-fly and allowed zones share the same request shape.
CreateNoFlyZoneRequest = CreateZoneRequest


class CreateChildProjectRequest(BaseModel):
    name: str | None = None


class SetFloorsEnabledRequest(BaseModel):
    floorsEnabled: bool
