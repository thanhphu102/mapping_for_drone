from __future__ import annotations

from fastapi import APIRouter

from ..services.command_service import connection_service

router = APIRouter()


@router.post("/command")
async def post_command(cmd: dict):
    return await connection_service.dispatch_command(cmd)

