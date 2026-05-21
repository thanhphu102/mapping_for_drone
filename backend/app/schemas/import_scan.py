from pydantic import BaseModel, Field
from typing import Any


class ImportObjectRef(BaseModel):
    projectId: str | None = None
    osmType: str | None = None
    osmId: int | str | None = None
    name: str | None = None


class ImportFloorRef(BaseModel):
    floorId: str | None = None
    code: str | None = None
    label: str | None = None
    level: int | None = None


class ImportScanPreviewRequest(BaseModel):
    object: ImportObjectRef
    floor: ImportFloorRef
    payload: dict[str, Any]


class ImportScanCommitRequest(ImportScanPreviewRequest):
    confirm: bool = False


class ImportScanPreviewResponse(BaseModel):
    objectId: str | None = None
    floorId: str | None = None
    detectedRooms: int = 0
    validRooms: int = 0
    invalidRooms: int = 0
    warnings: list[str] = Field(default_factory=list)
    previewFeatures: list[dict[str, Any]] = Field(default_factory=list)

