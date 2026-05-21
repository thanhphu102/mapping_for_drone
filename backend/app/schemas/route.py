from pydantic import BaseModel
from typing import Any, Literal


class TrackingPointPayload(BaseModel):
    lng: float
    lat: float
    timestamp: int


class SaveRouteRequest(BaseModel):
    name: str
    droneId: str
    source: Literal["mouse_simulation", "drone_gps"]
    geometry: dict[str, Any]
    points: list[TrackingPointPayload] = []

