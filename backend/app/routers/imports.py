from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..dependencies import (
    feature_service,
    floor_service,
    import_scan_service,
    project_lock,
    project_service,
)
from ..schemas.import_scan import ImportScanCommitRequest, ImportScanPreviewRequest

router = APIRouter()


@router.post("/api/imports/scan-json/preview")
async def preview_scan_json_import(payload: ImportScanPreviewRequest):
    project_id = payload.object.projectId
    if not project_id:
        raise HTTPException(status_code=422, detail="object.projectId is required")

    project = await project_service.get_project_or_404(project_id)
    object_id = payload.object.objectId or "object-default"
    floor_id = payload.floor.floorId

    if not floor_id and payload.floor.code:
        floor = floor_service.find_floor_by_code(project, payload.floor.code)
        floor_id = str(floor.get("id") or "") if floor else None
    if not floor_id and payload.floor.level is not None:
        floor = floor_service.find_floor_by_level(project, payload.floor.level)
        floor_id = str(floor.get("id") or "") if floor else None

    return import_scan_service.build_preview(
        project=project,
        object_id=object_id,
        floor_id=floor_id,
        payload=payload.payload,
    )


@router.post("/api/imports/scan-json/commit")
async def commit_scan_json_import(payload: ImportScanCommitRequest):
    project_id = payload.object.projectId
    if not project_id:
        raise HTTPException(status_code=422, detail="object.projectId is required")

    if not payload.confirm:
        raise HTTPException(status_code=422, detail="confirm must be true for commit")

    async with project_lock:
        project = await project_service.get_project_or_404(project_id)
        object_id = payload.object.objectId or "object-default"
        target_object = import_scan_service.ensure_target_object(project, object_id)
        floor = floor_service.get_or_create_floor(
            project,
            floor_id=payload.floor.floorId,
            code=payload.floor.code,
            label=payload.floor.label,
            level=payload.floor.level,
        )
        floor_id = str(floor.get("id") or "")

        object_floors = target_object.get("floors")
        if isinstance(object_floors, list) and not any(
            isinstance(item, dict) and item.get("id") == floor_id for item in object_floors
        ):
            object_floors.append(floor)

        preview = import_scan_service.build_preview(
            project=project,
            object_id=object_id,
            floor_id=floor_id,
            payload=payload.payload,
        )
        upserted: list[dict] = []
        for feature in preview["previewFeatures"]:
            properties = feature.get("properties") if isinstance(feature.get("properties"), dict) else {}
            existing_id = import_scan_service.find_existing_feature_id(
                project,
                object_id=object_id,
                floor_id=floor_id,
                external_id=str(properties.get("externalId") or "") or None,
                geometry_hash=str(properties.get("geometryHash") or ""),
            )
            if existing_id:
                feature["id"] = existing_id
            saved = feature_service.upsert_feature(project, feature)
            upserted.append(saved)

        await project_service.save_project(project, touch=False)

    return {
        "ok": True,
        "projectId": project_id,
        "objectId": object_id,
        "floorId": floor_id,
        "changes": {"features": {"upsert": upserted}},
        "detectedRooms": preview["detectedRooms"],
        "validRooms": preview["validRooms"],
        "invalidRooms": preview["invalidRooms"],
        "warnings": preview["warnings"],
    }
