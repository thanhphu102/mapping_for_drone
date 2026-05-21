from pydantic import BaseModel
from typing import Any


class GeometryPayload(BaseModel):
    geometry: dict[str, Any]

