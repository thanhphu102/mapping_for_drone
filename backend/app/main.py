from __future__ import annotations

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .core.config import FRONTEND_DIST_PATH
from .routers import (
    commands,
    drones,
    features,
    floors,
    imports,
    osm,
    overlays,
    projects,
    routes,
    tiles,
)

app = FastAPI()

app.include_router(projects.router)
app.include_router(floors.router)
app.include_router(features.router)
app.include_router(overlays.router)
app.include_router(routes.router)
app.include_router(osm.router)
app.include_router(commands.router)
app.include_router(drones.router)
app.include_router(tiles.router)
app.include_router(imports.router)

if FRONTEND_DIST_PATH.exists():
    @app.get("/spatial-editor/{project_id}")
    async def serve_spatial_editor(project_id: str):
        del project_id
        return FileResponse(FRONTEND_DIST_PATH / "index.html")

    app.mount("/", StaticFiles(directory=FRONTEND_DIST_PATH, html=True), name="static")
