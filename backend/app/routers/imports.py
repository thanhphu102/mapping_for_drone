from __future__ import annotations

from fastapi import APIRouter

from ..dependencies import import_scan_service
from ..schemas.import_scan import ImportScanCommitRequest, ImportScanPreviewRequest

router = APIRouter()


@router.post("/api/imports/scan-json/preview")
async def preview_scan_json_import(payload: ImportScanPreviewRequest):
    del payload
    import_scan_service.not_implemented()


@router.post("/api/imports/scan-json/commit")
async def commit_scan_json_import(payload: ImportScanCommitRequest):
    del payload
    import_scan_service.not_implemented()

