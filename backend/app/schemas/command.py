from pydantic import BaseModel, Field
from typing import Any


class CommandRequest(BaseModel):
    target: dict[str, Any]
    drones: list[str] | str | None = "all"
    command: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)

