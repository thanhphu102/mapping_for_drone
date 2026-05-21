# Structure Reference

## Document Profile

- Diataxis type: Reference with explanation notes.
- Audience: maintainer developers planning refactor and deletion work.
- Goal: map the source tree and highlight high-complexity files.
- Scope: source files, documentation, and runtime data boundaries. Generated output is identified but not treated as source convention.

## Top-Level Layout

| Path | Role | Refactor relevance |
| --- | --- | --- |
| `backend/main.py` | FastAPI app, drone API, spatial APIs, OSM conversion, JSON persistence, tile proxy, static serving | Highest backend split candidate. |
| `drone_sim.py` | Async drone simulator | Keep as local development and test support. |
| `main.py` | Root-level file present in repo | [TODO] Confirm whether this is an active entrypoint or legacy wrapper. |
| `run_dev.sh` | Local orchestration script | Keep for prototype developer workflow. |
| `frontend/` | React/Vite frontend app | Main UI and spatial editor. |
| `docs/` | Maintainer documentation | Existing Diataxis docs plus this audit set. |
| `backend/data/` | Local JSON runtime data | Ignored by `.gitignore`; should not be treated as canonical source. |
| `.agents/skills/` | Local Codex skill instructions | Tooling/context, not runtime. |
| `plan.md` | Spatial editor architecture plan | Planning intent, not fully implemented behavior. |

## Backend Module Shape

`backend/main.py` currently contains these responsibilities:

- FastAPI app construction.
- In-memory drone and frontend WebSocket registries.
- Pydantic request models for OSM projects, feature saves, child projects, floors, and routes.
- OSM full payload fetching and OSM-to-GeoJSON conversion.
- Geometry utilities such as ring validation, bounding boxes, point-in-polygon checks, and approximate area/perimeter.
- JSON-backed project CRUD and feature CRUD.
- Floor CRUD.
- Published overlay queries.
- Route tracking persistence to GeoJSON files.
- Tile proxy for OpenStreetMap tiles.
- Static frontend serving.

Short-term refactor target: split by responsibility into routers/services/modules while keeping behavior unchanged. Long-term target: move storage and spatial validation behind a repository/service layer that can support PostGIS.

## Frontend Module Shape

| Area | Files | Notes |
| --- | --- | --- |
| App shell and routing | `frontend/src/App.tsx` | Owns main dashboard state, OSM flow, tracking control state, and manual route handling for `/spatial-editor/:projectId`. |
| Main map | `frontend/src/components/DroneMap.tsx`, `frontend/src/hooks/useDroneMap.ts`, `frontend/src/hooks/useDroneMarkers.ts` | Mixes base map setup, drone markers, OSM highlight, published overlays, tracking integration, and overlay project deletion. |
| Spatial editor | `frontend/src/components/SpatialEditor.tsx`, `SpatialCanvasOverlay.tsx`, `EditorToolbar.tsx`, `EditorToolbox.tsx`, `EditorSidebar.tsx`, `EditorStructurePanel.tsx`, `FloorSelector.tsx` | Largest UI workflow. Good target for route-level lazy loading and smaller domain hooks. |
| Drawing engine | `frontend/src/hooks/useDrawingEngine.ts`, `useSnapEngine.ts`, `useMapRenderer.ts` | Complex map interaction and geometry behavior. Needs focused unit tests before large edits. |
| Drone telemetry | `frontend/src/hooks/useDroneTelemetry.ts`, `frontend/src/services/realtime.ts`, `frontend/src/services/commands.ts` | Relatively well-isolated transport path. |
| API clients | `frontend/src/services/spatial.ts`, `osm.ts`, `routes.ts` | Fetch wrappers for backend and external OSM/Overpass calls. |
| Shared types | `frontend/src/types/drone.ts` | Contains drone, telemetry, OSM, tracking, floor, project, and editor types. Split candidate. |

## High-Complexity Files

Line-count signals from `wc -l` during this documentation pass:

| File | Lines | Decision signal |
| --- | ---: | --- |
| `backend/main.py` | 1789 | Refactor by backend domain. |
| `frontend/src/components/SpatialEditor.tsx` | 1753 | Refactor into editor shell, project data hook, feature editing hook, floor hook, and inspector components. |
| `frontend/src/hooks/useDrawingEngine.ts` | 1645 | Add tests before extracting geometry and interaction utilities. |
| `frontend/src/components/DroneMap.tsx` | 890 | Split overlay, OSM highlight, drone marker, and tracking concerns. |
| `frontend/src/App.tsx` | 646 | Move OSM and tracking orchestration into hooks or route modules. |
| `frontend/src/hooks/useDroneTracking.ts` | 457 | Good candidate for tests around point sampling and route save behavior. |
| `frontend/src/services/spatial.ts` | 303 | Could split by project, feature, floor, and overlay APIs after backend API is stabilized. |
| `frontend/src/types/drone.ts` | 247 | Split into domain type files. |

## Generated And Local State

- `frontend/dist/` exists after builds and is ignored by `frontend/.gitignore`.
- `frontend/node_modules/` and `venv/` exist locally and are ignored.
- `backend/data/` is ignored local runtime state.
- `backend/__pycache__/main.cpython-312.pyc` is tracked by Git even though `.gitignore` ignores `backend/__pycache__/`; this should be removed from version control in a cleanup commit.

## Evidence

- `find backend frontend/src -maxdepth 3 -type f`
- `wc -l backend/main.py frontend/src/App.tsx frontend/src/components/DroneMap.tsx frontend/src/components/SpatialEditor.tsx frontend/src/hooks/useDrawingEngine.ts frontend/src/types/drone.ts frontend/src/services/spatial.ts frontend/src/hooks/useDroneTracking.ts`
- `git ls-files backend/data backend/__pycache__ docs/codebase .agents plan.md`
- `.gitignore`
- `frontend/.gitignore`
