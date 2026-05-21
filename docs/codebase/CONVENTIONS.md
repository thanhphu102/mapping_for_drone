# Conventions Reference

## Document Profile

- Diataxis type: Reference.
- Audience: maintainer developers.
- Goal: document observed implementation conventions and where they should be tightened before refactor.
- Scope: conventions visible in source files. Team preferences that are not encoded in the repo are marked `[ASK USER]`.

## Naming And Domain Terms

Observed domain terms:

- Drone transport: `DroneState`, `DroneRegistry`, `TelemetrySnapshot`, `CommandTarget`.
- OSM selection: `OsmCandidate`, `OsmElementType`, `OsmElementGeometryResponse`.
- Spatial projects: `DrawingProject`, `SpatialFloor`, `ProjectCanvasConfig`, `EditorMode`.
- Tracking: `TrackingPoint`, `TrackingRoute`, `SaveTrackedRouteRequest`.

The shared type file `frontend/src/types/drone.ts` uses the drone domain name but now contains OSM, tracking, spatial project, floor, and editor types. This is an accurate reflection of current code, but it is a refactor candidate.

## Backend Patterns

Backend conventions visible in `backend/main.py`:

- FastAPI decorators define all HTTP and WebSocket endpoints in one module.
- Pydantic models are used for many structured request bodies.
- Some endpoints still use untyped dictionaries, notably `POST /command` and `/debug/osm-selection`.
- JSON persistence helpers use synchronous file IO wrapped with `asyncio.to_thread()` for some project paths.
- `project_lock` and `tracked_route_lock` protect write paths.
- Geometry validation raises `HTTPException` with user-facing detail strings.
- Storage records use camelCase keys for frontend compatibility.

Recommended convention decisions:

- Refactor backend into routers by domain: drone, OSM, projects, features, floors, routes, tiles, static serving.
- Move geometry helpers into a dedicated module with tests.
- Move JSON storage into a repository module before introducing PostGIS.
- Convert raw dictionary endpoints to Pydantic request/response models.
- Decide whether public API keys remain camelCase or backend internals move to snake_case with explicit serializers. [ASK USER]

## Frontend Patterns

Observed frontend conventions:

- React function components with hooks.
- TypeScript types imported from `frontend/src/types/drone.ts`.
- Service modules wrap fetch calls for backend and external APIs.
- `readJsonResponse<T>()` appears in service modules to normalize error handling.
- MapLibre objects are managed through refs/effects and cleaned up in effect return callbacks.
- UI state is mostly local to `App.tsx`, `DroneMap.tsx`, and `SpatialEditor.tsx`.
- `requestAnimationFrame` is used for telemetry batching, map render timing, snap pointer processing, and canvas overlay rendering.

Recommended convention decisions:

- Keep service modules as the boundary for network calls.
- Split large hooks into pure utilities plus React lifecycle hooks.
- Keep MapLibre source/layer IDs centralized per map domain.
- Prefer route-level lazy loading for `SpatialEditor`.
- Split `types/drone.ts` into domain files after service boundaries are stable.

## Error Handling

Current behavior:

- Backend raises `HTTPException` for validation and not-found cases.
- Frontend service wrappers throw `Error` for non-OK responses.
- Some frontend errors are displayed as `Notice` state or OSM panel status messages.
- Some failures only log to the browser console, such as published overlay fetch failure and delete overlay failure.
- `/debug/osm-selection` logs selected OSM data to backend stdout.

Recommended cleanup:

- Keep user-visible notices for command, OSM selection, project creation, publish, delete, and route save failures.
- Remove or gate debug logging before production.
- Standardize error response shape before adding more API clients. [ASK USER]

## Data And Persistence Conventions

Current persisted JSON fields use camelCase:

- Project identity and source: `id`, `name`, `source`, `osmType`, `osmId`, `osmTags`.
- Geometry and display: `baseGeometry`, `bbox`, `areaSquareKm`, `areaM2`, `perimeterM`, zoom thresholds.
- Editing state: `floors`, `features`, `publishedFeatures`, `config`.
- Hierarchy: `parentProjectId`, `sourceFeatureId`.

Layers are deprecated in runtime, but compatibility remains:

- `load_projects()` migrates legacy stored project `layers` away.
- `GET /api/drawing-projects/{project_id}/layers` returns an empty list.
- `default_layers()` still exists in `backend/main.py`.

## UI Conventions

Current UI conventions:

- The main dashboard uses a map-first layout with a right sidebar.
- Status messages use `Notice`, `StatusStrip`, OSM panel messages, and inline command status.
- Editor controls are split across toolbar/toolbox/sidebar/floor selector components.
- Custom CSS defines map markers, target popover, floor selector, and building entry overlay behavior.

UX/UI recommendations:

- Clarify the main map click workflow: distinguish `Send drone command` from `Fetch OSM location`.
- Group spatial editor tools by draw/edit/navigate/manage instead of one long tool surface.
- Hide floor controls for outdoor-only projects unless floors exist or are explicitly enabled.
- Promote consistent loading, empty, and error states for OSM, overlays, publish, delete, and route save.
- Add keyboard and ARIA coverage for map/editor controls before production use.

## Evidence

- `backend/main.py`
- `frontend/src/types/drone.ts`
- `frontend/src/App.tsx`
- `frontend/src/components/DroneMap.tsx`
- `frontend/src/components/SpatialEditor.tsx`
- `frontend/src/components/Notice.tsx`
- `frontend/src/components/StatusStrip.tsx`
- `frontend/src/services/spatial.ts`
- `frontend/src/services/routes.ts`
- `frontend/src/index.css`
