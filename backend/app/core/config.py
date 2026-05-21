from pathlib import Path
import os

BACKEND_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = Path(os.getenv("DATA_DIR", BACKEND_ROOT / "data"))

DRAWING_PROJECTS_PATH = DATA_DIR / "drawing_projects.json"
TRACKED_ROUTES_DIR = DATA_DIR / "tracked-routes"
FRONTEND_DIST_PATH = BACKEND_ROOT.parent / "frontend" / "dist"

DEBUG_OSM = os.getenv("DEBUG_OSM", "false").lower() == "true"

