from pydantic import BaseModel, Field
from typing import Any, Literal


class GeoJsonFeatureModel(BaseModel):
    type: Literal["Feature"]
    geometry: dict[str, Any]
    properties: dict[str, Any] = Field(default_factory=dict)
    id: str | None = None


class SaveFeatureRequest(BaseModel):
    feature: dict[str, Any]

