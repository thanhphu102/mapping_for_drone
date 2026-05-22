from __future__ import annotations

import asyncio
from collections import OrderedDict
from threading import Lock
from typing import NamedTuple

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

router = APIRouter()


class TileCacheItem(NamedTuple):
    content_type: str
    tile_bytes: bytes


_TILE_CACHE_MAX_ITEMS = 2048
_tile_cache: "OrderedDict[tuple[int, int, int], TileCacheItem]" = OrderedDict()
_tile_cache_lock = Lock()
_inflight_tile_requests: dict[tuple[int, int, int], asyncio.Future[TileCacheItem]] = {}
_inflight_tile_lock = asyncio.Lock()

_tile_http_client = httpx.AsyncClient(
    timeout=httpx.Timeout(8.0, connect=3.0),
    limits=httpx.Limits(max_connections=120, max_keepalive_connections=40),
    http2=True,
    headers={"User-Agent": "mapping-for-drone-spatial-editor/0.1"},
)


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
    if y_value < 0 or y_value >= tile_count:
        raise HTTPException(status_code=400, detail="Invalid tile coordinates")

    # MapLibre may request wrapped worlds with x outside [0, tile_count).
    # Normalize x so zoomed-out panning does not produce proxy 400s/blank tiles.
    x_value = x_value % tile_count

    cache_key = (z_value, x_value, y_value)
    with _tile_cache_lock:
        cached = _tile_cache.get(cache_key)
        if cached is not None:
            _tile_cache.move_to_end(cache_key)
    if cached is not None:
        return Response(
            content=cached.tile_bytes,
            media_type=cached.content_type,
            headers={"Cache-Control": "public, max-age=86400"},
        )

    created = False
    async with _inflight_tile_lock:
        inflight = _inflight_tile_requests.get(cache_key)
        if inflight is None:
            loop = asyncio.get_running_loop()
            inflight = loop.create_future()
            _inflight_tile_requests[cache_key] = inflight
            created = True

    if created:
        tile_url = f"https://tile.openstreetmap.org/{z_value}/{x_value}/{y_value}.png"
        try:
            upstream = await _tile_http_client.get(tile_url)
            upstream.raise_for_status()
            fetched = TileCacheItem(
                content_type=upstream.headers.get("Content-Type", "image/png"),
                tile_bytes=upstream.content,
            )
            with _tile_cache_lock:
                _tile_cache[cache_key] = fetched
                _tile_cache.move_to_end(cache_key)
                while len(_tile_cache) > _TILE_CACHE_MAX_ITEMS:
                    _tile_cache.popitem(last=False)
            if not inflight.done():
                inflight.set_result(fetched)
        except Exception as exc:
            if not inflight.done():
                inflight.set_exception(exc)
        finally:
            _inflight_tile_requests.pop(cache_key, None)

    try:
        fetched = await inflight
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Tile proxy upstream fetch failed: {exc}") from exc

    return Response(
        content=fetched.tile_bytes,
        media_type=fetched.content_type,
        headers={
            "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800, immutable",
        },
    )
