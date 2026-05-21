from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..dependencies import floor_service, project_lock, project_service
from ..schemas.floor import FloorPayload

router = APIRouter()


@router.get("/api/drawing-projects/{project_id}/floors")
async def get_project_floors(project_id: str):
    project = await project_service.get_project_or_404(project_id)
    return {"floors": floor_service.list_floors(project)}


@router.post("/api/drawing-projects/{project_id}/floors")
async def create_project_floor(project_id: str, payload: FloorPayload):
    async with project_lock:
        project = await project_service.get_project_or_404(project_id)
        new_floor = floor_service.create_floor(
            project,
            label=payload.label,
            code=payload.code,
            level=payload.level,
            elevation=payload.elevation or 0,
            visible=payload.visible,
            sort_order=payload.sortOrder,
        )
        await project_service.save_project(project, touch=False)
    return {"ok": True, "floor": new_floor, "floors": floor_service.list_floors(project)}


@router.put("/api/drawing-projects/{project_id}/floors/{floor_id}")
async def update_project_floor(project_id: str, floor_id: str, payload: FloorPayload):
    async with project_lock:
        project = await project_service.get_project_or_404(project_id)
        found = floor_service.update_floor(
            project,
            floor_id,
            label=payload.label,
            code=payload.code,
            level=payload.level,
            elevation=payload.elevation or 0,
            visible=payload.visible,
            sort_order=payload.sortOrder,
        )
        if found:
            await project_service.save_project(project, touch=False)
    if not found:
        raise HTTPException(status_code=404, detail="Floor not found")
    return {"ok": True, "floors": floor_service.list_floors(project)}


@router.delete("/api/drawing-projects/{project_id}/floors/{floor_id}")
async def delete_project_floor(project_id: str, floor_id: str):
    async with project_lock:
        project = await project_service.get_project_or_404(project_id)
        deleted = floor_service.delete_floor(project, floor_id)
        if deleted:
            await project_service.save_project(project, touch=False)
    if not deleted:
        raise HTTPException(status_code=404, detail="Floor not found")
    return {"ok": True, "floors": floor_service.list_floors(project)}

