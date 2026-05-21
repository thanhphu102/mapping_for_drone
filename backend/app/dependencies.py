from __future__ import annotations

import asyncio

from .core.config import DRAWING_PROJECTS_PATH, TRACKED_ROUTES_DIR
from .repositories.json_project_repository import JsonProjectRepository
from .repositories.json_route_repository import JsonRouteRepository
from .services.feature_service import FeatureService
from .services.floor_service import FloorService
from .services.import_scan_service import ImportScanService
from .services.overlay_service import OverlayService
from .services.osm_service import OsmService
from .services.project_service import ProjectService
from .services.route_service import RouteService

project_repository = JsonProjectRepository(DRAWING_PROJECTS_PATH)
project_service = ProjectService(project_repository)
floor_service = FloorService()
feature_service = FeatureService()
osm_service = OsmService()
overlay_service = OverlayService()
route_service = RouteService(JsonRouteRepository(TRACKED_ROUTES_DIR))
import_scan_service = ImportScanService()

project_lock = asyncio.Lock()
route_lock = asyncio.Lock()

