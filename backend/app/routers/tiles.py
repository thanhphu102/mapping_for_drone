from __future__ import annotations

import urllib.request

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

router = APIRouter()


@router.get("/api/storage/status")
async def get_storage_status():
    return {"storage": "json", "postgis": False}


@router.get("/api/tiles/osm/{z}/{x}/{y}.png")
async def proxy_osm_tile(z: str, x: str, y: str):
    try:
        z_value = int(z)
        x_value = int(x)
        y_value = int(y)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid tile coordinates") from exc

    if z_value < 0 or z_value > 22:
        raise HTTPException(status_code=400, detail="Invalid tile coordinates")

    tile_count = 2 ** z_value
    if x_value < 0 or x_value >= tile_count or y_value < 0 or y_value >= tile_count:
        raise HTTPException(status_code=400, detail="Invalid tile coordinates")

    tile_url = f"https://tile.openstreetmap.org/{z_value}/{x_value}/{y_value}.png"
    request = urllib.request.Request(
        tile_url,
        headers={"User-Agent": "mapping-for-drone-spatial-editor/0.1"},
    )

    try:
        with urllib.request.urlopen(request, timeout=15) as tile_response:
            content_type = tile_response.headers.get("Content-Type", "image/png")
            tile_bytes = tile_response.read()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Tile proxy upstream fetch failed: {exc}") from exc

    return Response(
        content=tile_bytes,
        media_type=content_type,
        headers={"Cache-Control": "public, max-age=86400"},
    )

