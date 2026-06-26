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


class CreateNoFlyZoneRequest(BaseModel):
    name: str | None = None
    # GeoJSON Polygon geometry in [lon, lat] order.
    geometry: dict[str, Any]


class CreateChildProjectRequest(BaseModel):
    name: str | None = None


class SetFloorsEnabledRequest(BaseModel):
    floorsEnabled: bool
