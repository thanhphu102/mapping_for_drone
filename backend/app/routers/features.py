from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..dependencies import feature_service, project_lock, project_service
from ..schemas.feature import SaveFeatureRequest

router = APIRouter()


@router.get("/api/drawing-projects/{project_id}/features")
async def get_drawing_project_features(project_id: str):
    project = await project_service.get_project_or_404(project_id)
    return {"features": feature_service.list_features(project)}


@router.get("/api/map-features")
async def get_map_features(
    projectId: str,
    bbox: str,
    zoom: float,
    layerId: str | None = None,
    floorId: str | None = None,
):
    del layerId
    try:
        parsed_bbox = [float(value) for value in bbox.split(",")]
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="bbox must be minLng,minLat,maxLng,maxLat") from exc
    if len(parsed_bbox) != 4:
        raise HTTPException(status_code=422, detail="bbox must be minLng,minLat,maxLng,maxLat")
    project = await project_service.get_project_or_404(projectId)
    return {
        "features": feature_service.visible_features(
            project,
            parsed_bbox,
            zoom,
            floor_id=floorId,
        )
    }


@router.post("/api/drawing-projects/{project_id}/features")
async def save_drawing_feature(project_id: str, payload: SaveFeatureRequest):
    async with project_lock:
        project = await project_service.get_project_or_404(project_id)
        feature = feature_service.upsert_feature(project, payload.feature)
        await project_service.save_project(project, touch=False)
    return {"ok": True, "feature": feature}


@router.delete("/api/drawing-projects/{project_id}/features/{feature_id}")
async def delete_drawing_feature(project_id: str, feature_id: str):
    async with project_lock:
        project = await project_service.get_project_or_404(project_id)
        deleted = feature_service.delete_feature(project, feature_id)
        if deleted:
            await project_service.save_project(project, touch=False)
    if not deleted:
        raise HTTPException(status_code=404, detail="Feature not found")
    return {"ok": True}

