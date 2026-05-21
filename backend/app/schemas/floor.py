from pydantic import BaseModel


class FloorModel(BaseModel):
    id: str
    label: str
    code: str
    level: int
    elevation: float = 0
    visible: bool = True
    sortOrder: int


class FloorPayload(BaseModel):
    label: str
    code: str
    level: int
    elevation: float | None = None
    visible: bool = True
    sortOrder: int = 0

