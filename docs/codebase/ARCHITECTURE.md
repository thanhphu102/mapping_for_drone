# Architecture Explanation

## Document Profile

- Diataxis type: Explanation.
- Audience: maintainer developers.
- Goal: explain how the current system works so refactors preserve behavior.
- Scope: implemented runtime flows. PostGIS and production hardening are described only where repo evidence shows planning/configuration.

## System Shape

The repository is a local-first drone mapping prototype that has grown into a spatial map editor. The current app has five major runtime flows:

- Drone telemetry and command dispatch.
- OSM enclosing element selection.
- Spatial project creation and editing.
- Published spatial overlay rendering on the main map.
- Drone path tracking and route persistence.

The backend is centralized in `backend/main.py`. The frontend is a React/Vite app with a main map dashboard and a route-like spatial editor view handled in `App.tsx`.

## Drone Telemetry Flow

1. A simulator connects to `/ws/drone/{drone_id}`.
2. The backend stores the drone WebSocket in `drone_connections`.
3. The backend broadcasts `connect`, `telemetry`, and `disconnect` events to frontend WebSocket clients.
4. The frontend connects through `useDroneTelemetry()` and batches snapshot updates with `requestAnimationFrame`.
5. `DroneMap` renders markers through `useDroneMarkers()`.
6. `DroneTable` renders connected drone state.

Command dispatch is separate:

1. The operator clicks the main map.
2. `TargetCommandPopover` offers command actions.
3. `useCommandDispatch()` posts to `/command`.
4. The backend forwards a command JSON message to selected or all connected drone sockets.
5. The backend broadcasts `command_sent` to frontend clients.

## OSM Selection Flow

1. The operator clicks the main map and chooses `Fetch location`.
2. `frontend/src/services/osm.ts` calls Overpass to find enclosing OSM ways/relations.
3. `OsmEnclosingPanel` lists candidates.
4. Selecting a candidate triggers two calls:
   - frontend fetches OSM full JSON from OpenStreetMap through `fetchOsmElementFull()`;
   - backend fetches and converts OSM geometry through `/api/osm/elements/{osm_type}/{osm_id}/geometry`.
5. `DroneMap` previews candidate or selected boundary geometry.
6. `App.tsx` can call `/debug/osm-selection` for backend console logging.

This flow currently uses both frontend direct external calls and backend external calls. That is useful for debugging, but it creates duplicate network responsibility.

## Spatial Project Flow

1. `App.tsx` checks for an existing drawing project by `osmType` and `osmId`.
2. If none exists, it posts to `/api/drawing-projects/from-osm`.
3. The backend fetches OSM full JSON, converts the selected way/relation into `MultiPolygon`, classifies editor mode, and writes a project to JSON storage.
4. The frontend navigates to `/spatial-editor/{project_id}`.
5. `SpatialEditor` loads project data and visible features.
6. Drawing interactions are handled by `useDrawingEngine()`, `useSnapEngine()`, and `SpatialCanvasOverlay`.
7. Feature saves post to `/api/drawing-projects/{project_id}/features`.
8. Publish posts to `/api/drawing-projects/{project_id}/publish`, which snapshots current features into `publishedFeatures`.

The current storage model writes project state to JSON. The planned PostGIS source of truth in `plan.md` is not implemented.

## Published Overlay Flow

1. `DroneMap` listens to map movement and zoom.
2. Above `boundaryMinZoom`, it fetches `/api/map-overlays?bbox=...`.
3. The backend returns published projects whose bounding boxes intersect the viewport.
4. The frontend writes project boundaries and published features into MapLibre GeoJSON sources.
5. At higher zoom, nearby overlay projects can be selected and floor-filtered.
6. `DroneMap` can delete a selected overlay project through `deleteDrawingProject()`.

Optimization note: overlay fetch is debounced with a timeout in `DroneMap`, but the fetch itself is not cancellable and no server-side spatial index exists in JSON mode.

## Route Tracking Flow

1. `DroneTrackingControls` selects tracking actions from the sidebar.
2. `DroneMap` wires tracking behavior through `useDroneTracking()`.
3. Tracking stores points in frontend state and can save a LineString route.
4. `frontend/src/services/routes.ts` posts to `/api/routes`.
5. The backend validates route coordinates and writes a GeoJSON file under `backend/data/tracked-routes/`.

## Current Architectural Trade-Offs

- Fast iteration: most behavior is inspectable in a small number of files.
- High coupling: backend and major frontend modules have multiple unrelated responsibilities.
- Low persistence complexity: JSON storage is simple but not suited for concurrent production editing or spatial indexing.
- Loose API validation: some endpoints use Pydantic models, while `POST /command` and `/debug/osm-selection` accept raw dictionaries.
- Duplicate OSM responsibility: frontend calls Overpass and OSM APIs; backend also calls OSM API for authoritative geometry conversion.
- No auth boundary: project edit, delete, publish, command, and WebSocket APIs are unauthenticated.

## Refactor Direction

Short-term prototype phase:

- Keep JSON storage and existing API behavior.
- Extract backend routers/services without changing endpoint contracts.
- Split spatial editor and drawing engine by domain.
- Remove tracked generated files and gate or remove debug endpoints/logging.
- Add tests around geometry conversion, feature boundary validation, and route saving before deeper refactors.

Long-term production/PostGIS phase:

- Define PostGIS schema and migrations.
- Move project, feature, floor, route, and overlay queries behind storage interfaces.
- Put final geometry validation in backend/PostGIS.
- Add authn/authz for command and editing routes.
- Add caching/rate-limit behavior for OSM/Overpass and tile proxy.

## Evidence

- `backend/main.py`
- `frontend/src/App.tsx`
- `frontend/src/components/DroneMap.tsx`
- `frontend/src/components/SpatialEditor.tsx`
- `frontend/src/hooks/useDroneTelemetry.ts`
- `frontend/src/hooks/useDroneTracking.ts`
- `frontend/src/services/osm.ts`
- `frontend/src/services/spatial.ts`
- `frontend/src/services/routes.ts`
- `plan.md`
