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
_tile_cache: "OrderedDict[tuple[str, int, int, int, int], TileCacheItem]" = OrderedDict()
_tile_cache_lock = Lock()
_inflight_tile_requests: dict[tuple[str, int, int, int, int], asyncio.Future[TileCacheItem]] = {}
_inflight_tile_lock = asyncio.Lock()

_tile_http_client = httpx.AsyncClient(
    timeout=httpx.Timeout(8.0, connect=3.0),
    limits=httpx.Limits(max_connections=120, max_keepalive_connections=40),
    http2=True,
    headers={"User-Agent": "mapping-for-drone-spatial-editor/0.1"},
)

_GOOGLE_TILE_LAYERS = {
    "streets": "m",
    "satellite": "s",
    "hybrid": "y",
}


@router.get("/api/storage/status")
async def get_storage_status():
    return {"storage": "json", "postgis": False}


def _parse_tile_coordinates(z: str, x: str, y: str) -> tuple[int, int, int]:
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

    return z_value, x_value, y_value


async def _fetch_cached_tile(
    cache_key: tuple[str, int, int, int, int],
    tile_url: str,
) -> Response:
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


@router.get("/api/tiles/google/{map_style}/{z}/{x}/{y}.png")
async def proxy_google_tile(map_style: str, z: str, x: str, y: str, scale: int = 1):
    z_value, x_value, y_value = _parse_tile_coordinates(z, x, y)

    if scale not in (1, 2):
        raise HTTPException(status_code=400, detail="Invalid tile scale")

    layer_code = _GOOGLE_TILE_LAYERS.get(map_style)
    if layer_code is None:
        raise HTTPException(status_code=404, detail="Unknown Google tile style")

    normalized_scale = scale
    subdomain_index = (x_value + y_value) % 4
    tile_url = (
        f"https://mt{subdomain_index}.google.com/vt/lyrs={layer_code}"
        f"&x={x_value}&y={y_value}&z={z_value}&scale={normalized_scale}"
    )
    cache_key = (f"google-{map_style}", z_value, x_value, y_value, normalized_scale)

    return await _fetch_cached_tile(cache_key, tile_url)


@router.get("/api/tiles/osm/{z}/{x}/{y}.png")
async def proxy_osm_tile(z: str, x: str, y: str, scale: int = 1):
    z_value, x_value, y_value = _parse_tile_coordinates(z, x, y)

    if scale not in (1, 2):
        raise HTTPException(status_code=400, detail="Invalid tile scale")

    # The public OSM standard tile server serves the stable raster path as .png.
    # Keep accepting scale=2 from older clients, but normalize to the standard
    # tile to avoid upstream @2x 404/502 storms.
    normalized_scale = 1

    tile_url = f"https://tile.openstreetmap.org/{z_value}/{x_value}/{y_value}.png"
    cache_key = ("osm", z_value, x_value, y_value, normalized_scale)

    return await _fetch_cached_tile(cache_key, tile_url)
