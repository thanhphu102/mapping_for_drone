# Explanation: Map Canvas Branch Changes

This document explains the code changes introduced by the `map-canvas` branch.
It is written for developers and reviewers who need to understand what changed
before maintaining, testing, or merging related work.

## Document Profile

- Diataxis type: Explanation with reference tables.
- Audience: developers maintaining the drone mapping prototype.
- Goal: understand the branch behavior, changed modules, API surface, and risks.
- Branch: `map-canvas`.
- Head commit: `a71cde6` (`Refactor map rendering logic and add SpatialCanvasOverlay component`).
- Comparison range: `2638242..a71cde6`.
- Merge context: `origin/main` already contains merge commit `fe9c376`, whose first parent is `2638242` and second parent is `a71cde6`. A direct diff against `origin/main` is not useful for this branch because the branch content has already been merged there.

## Scope

Included:

- OSM enclosing-element selection and boundary preview.
- Spatial drawing project creation from OSM, manual geometry, or imported GeoJSON.
- Spatial editor UI, rendering, drawing tools, snapping, floors, metadata editing, publishing, and child indoor projects.
- Main map overlay rendering for published spatial projects.
- Backend spatial project APIs and JSON-backed persistence.
- Configuration, internal skill files, and implementation plan files added by the branch.

Excluded:

- Cleanup commits that exist after the branch merge on `origin/main`.
- Production hardening beyond what this branch implements.
- Desired PostGIS behavior described in `plan.md` but not wired into the current backend code.

## High-Level Summary

The branch expands the project from a drone telemetry and command map into a
spatial map editor. Users can click the main map, fetch enclosing OSM elements,
select a boundary, create a drawing project, edit custom spatial features inside
that boundary, publish the result, and see published projects as overlays on the
main map.

The implementation has three large parts:

- Main map workflow: OSM selection, geometry preview, project creation, and published overlay display.
- Backend spatial project layer: OSM geometry conversion, project and feature storage, floor management, child projects, and overlay queries.
- Spatial editor: dedicated MapLibre workspace with drawing, canvas rendering, snapping, floors, metadata, publishing, and building-to-indoor navigation.

## Commit Timeline

| Commit | Purpose |
| --- | --- |
| `7bdd947` | Adds OSM enclosing element selection, frontend panel, boundary highlighting, and debug endpoint. |
| `4c90dfb` | Adds the first full spatial editor, backend drawing project APIs, drawing hooks, floors, and project storage. |
| `79be157` | Improves indoor mapping support, auto-layer behavior, and map zoom limits. |
| `ff91755` | Refactors draft drawing data to use GeoJSON `FeatureCollection` consistently. |
| `6ae5636` | Adds the floating editor toolbox and improves floor-management behavior. |
| `cb9e34c` | Enhances editor structure, map rendering, object selection, and overlay behavior. |
| `a71cde6` | Moves more visual rendering into `SpatialCanvasOverlay` and simplifies MapLibre feature-layer rendering. |

## Changed File Groups

| Area | Files | Change |
| --- | --- | --- |
| Backend spatial APIs | `backend/main.py` | Adds OSM geometry conversion, project payloads, JSON persistence, feature CRUD, floor CRUD, publish/delete flows, map overlays, and `/spatial-editor/{project_id}` route. |
| Main map flow | `frontend/src/App.tsx`, `frontend/src/components/DroneMap.tsx`, `frontend/src/components/OsmEnclosingPanel.tsx`, `frontend/src/components/TargetCommandPopover.tsx`, `frontend/src/services/osm.ts` | Adds OSM enclosing selection, selected-boundary preview, project creation, existing-project reuse, and published overlay display. |
| Spatial editor | `frontend/src/components/SpatialEditor.tsx`, `MapProvider.tsx`, `EditorToolbar.tsx`, `EditorToolbox.tsx`, `EditorStructurePanel.tsx`, `EditorSidebar.tsx`, `FloorSelector.tsx`, `BuildingEntryOverlay.tsx`, `SpatialCanvasOverlay.tsx` | Adds the dedicated map editor workspace, controls, inspector, structure tree, floor selector, building entry overlay, and canvas overlay rendering. |
| Editor hooks | `frontend/src/hooks/useDrawingEngine.ts`, `useMapRenderer.ts`, `useSnapEngine.ts`, `useFeatureActions.ts` | Adds drawing interaction, map source/layer management, snap preview, geometry transforms, measurements, and feature action helpers. |
| API clients and types | `frontend/src/services/spatial.ts`, `frontend/src/types/drone.ts` | Adds project, geometry, floor, overlay, OSM, classification, and editor-mode types and service calls. |
| Styling | `frontend/src/index.css` | Adds styles for target popover, floor selector, and editor overlays. |
| Runtime config | `docker-compose.yml`, `requirements.txt`, `.gitignore` | Adds PostGIS service and `psycopg[binary]` dependency, ignores `backend/data/` and `backend/__pycache__/`. |
| Planning and local agent docs | `plan.md`, `.agents/skills/*/SKILL.md` | Adds a spatial editor implementation plan and local Codex skill definitions. |
| Generated artifact | `backend/__pycache__/main.cpython-312.pyc` | Binary Python cache file changed and is tracked in the branch. |

## Main Map Workflow

The main app now supports a two-path workflow from a clicked coordinate:

- Send a drone target command as before.
- Fetch OSM enclosing elements around the selected coordinate and use one of
  those elements as the base boundary for a drawing project.

The important frontend changes are:

- `App.tsx` adds state for OSM candidates, selected candidate, highlighted candidate, selected geometry, editor mode override, large-area confirmation, and local route handling for `/spatial-editor/:projectId`.
- `TargetCommandPopover.tsx` adds the `Fetch location` action next to the existing command send action.
- `OsmEnclosingPanel.tsx` displays candidate OSM ways/relations, classification details, area/perimeter, warnings, editor-mode override buttons, and the action to open the spatial editor.
- `DroneMap.tsx` renders OSM highlight layers and published spatial project overlays on the main map.
- `services/osm.ts` calls Overpass with `is_in(lat, lon)`, collects enclosing ways and relations, normalizes tags and geometry, and fetches full OSM JSON from the OSM API when a candidate is selected.

The creation flow is:

1. User clicks the map.
2. `TargetCommandPopover` shows the target coordinate.
3. User clicks `Fetch location`.
4. `App.tsx` calls `fetchEnclosingOsmElements`.
5. `OsmEnclosingPanel` lists OSM candidates.
6. User selects a candidate.
7. Frontend fetches full OSM JSON and backend-built geometry.
8. `DroneMap.tsx` previews the selected boundary.
9. User opens the spatial editor.
10. Existing project is reused when one already exists for the same `osmType` and `osmId`; otherwise the backend creates a new project.

## Backend Spatial Project Layer

`backend/main.py` changes from a simple drone control backend into a combined
drone control and spatial project API.

### Geometry and OSM Processing

The backend now includes helpers to:

- Fetch full OSM element JSON from the OSM API.
- Build node and way maps from OSM payloads.
- Convert OSM ways and relations into GeoJSON `MultiPolygon` geometry.
- Stitch relation way segments into closed rings.
- Validate closed rings and non-empty polygon boundaries.
- Normalize `Polygon` and `MultiPolygon` inputs to `MultiPolygon`.
- Calculate bounding box, approximate area, approximate perimeter, and point count.
- Classify selected geometry into editor modes such as `building`, `campus`, `agriculture`, `parking`, `region`, or `custom`.
- Require confirmation for extremely large boundaries.

### Project Model

Spatial projects now include:

- `id`, `name`, `source`, `status`
- `osmType`, `osmId`, `osmTags`
- `editorMode`
- `baseGeometry`
- `bbox`, `areaSquareKm`, `areaM2`, `perimeterM`
- zoom thresholds: `boundaryMinZoom`, `detailMinZoom`, `indoorMinZoom`
- `config` for canvas, precision zoom, snapping, and measurement
- `floors`
- `features`
- optional `parentProjectId` and `sourceFeatureId` for child indoor projects
- timestamps for creation, update, and publication

The branch also migrates legacy JSON projects by removing deprecated `layers`
data and ensuring feature properties contain `floorId`.

### Persistence

Current implemented persistence is JSON-backed:

- Data file: `backend/data/drawing_projects.json`.
- Write behavior: writes to a temporary file and replaces the JSON file.
- Concurrency: project writes are protected by an async `project_lock`.
- Storage status endpoint returns `{"storage": "json", "postgis": false}`.

The branch adds `psycopg[binary]` and a PostGIS Docker service, but the current
backend does not use PostGIS yet.

### API Endpoints Added

| Endpoint | Purpose |
| --- | --- |
| `POST /debug/osm-selection` | Logs selected OSM payload details for debugging. |
| `GET /api/osm/elements/{osm_type}/{osm_id}/geometry` | Converts an OSM way or relation to project-ready geometry and classification. |
| `POST /api/drawing-projects/from-osm` | Creates a drawing project from an OSM element. |
| `POST /api/spatial-projects/from-geometry` | Creates a project from manual `Polygon` or `MultiPolygon` geometry. |
| `POST /api/spatial-projects/import-geojson` | Creates a project from GeoJSON. |
| `GET /api/drawing-projects` | Lists projects, with optional parent and OSM filters. |
| `GET /api/drawing-projects/{project_id}` | Gets one project. |
| `GET /api/drawing-projects/{project_id}/layers` | Returns an empty list for compatibility because layers are deprecated. |
| `GET /api/drawing-projects/{project_id}/features` | Lists project features. |
| `GET /api/map-features` | Returns viewport-visible features filtered by bbox, zoom, and optional floor. |
| `POST /api/drawing-projects/{project_id}/features` | Saves or updates one GeoJSON feature. |
| `DELETE /api/drawing-projects/{project_id}/features/{feature_id}` | Deletes one feature. |
| `GET /api/drawing-projects/{project_id}/floors` | Lists floors. |
| `POST /api/drawing-projects/{project_id}/floors` | Creates a floor. |
| `PUT /api/drawing-projects/{project_id}/floors/{floor_id}` | Updates a floor. |
| `DELETE /api/drawing-projects/{project_id}/floors/{floor_id}` | Deletes a floor. |
| `POST /api/drawing-projects/{project_id}/publish` | Marks a project as published. |
| `DELETE /api/drawing-projects/{project_id}` | Deletes a project and its child projects. |
| `POST /api/drawing-projects/{project_id}/features/{feature_id}/create-child-project` | Creates a building or indoor child project from a polygon feature. |
| `GET /api/map-overlays` | Returns published projects intersecting a bbox. |
| `GET /api/storage/status` | Reports current storage mode. |
| `GET /spatial-editor/{project_id}` | Serves the frontend route for the spatial editor. |

The existing drone WebSocket and command endpoints remain in the same module.

## Spatial Editor

The branch adds a dedicated spatial editor route and workspace for editing
features inside a locked base boundary.

### Editor Shell

`SpatialEditor.tsx` coordinates:

- Project loading by `projectId`.
- Visible feature loading by viewport, zoom, and selected floor.
- Drawing mode state.
- Draft geometry state.
- Selected feature state.
- Floor creation, update, deletion, and selection.
- Metadata inspector state.
- Publish flow.
- Child project navigation for building-to-indoor maps.

`MapProvider.tsx` owns the editor MapLibre instance and exposes map state through context.
The editor map uses a simple background style rather than OSM raster tiles.

### Drawing Tools

`useDrawingEngine.ts` adds these drawing and editing modes:

- `select`
- `move`
- `text`
- `pen`
- `point`
- `line`
- `polygon`
- `rectangle`
- `ellipse`
- `square`
- `triangle`
- `room`
- `wall`
- `door`
- `corridor`
- `indoor_route`
- `delete_lasso`

Interaction behavior includes:

- Click to add points.
- Double click or Enter to commit applicable geometry.
- Drag to create boxes, ellipses, triangles, text boxes, and lasso rectangles.
- Freehand pen drawing.
- Select by click or shift-box.
- Move selected features by dragging.
- Delete by context menu, Backspace, Delete, or lasso selection.
- Escape to clear draft and selection.
- Ctrl/Cmd+Z to remove the last draft point.

Draft rendering is normalized through GeoJSON `FeatureCollection`, which makes
the renderer, toolbar, and sidebar consume the same draft shape.

### Canvas Rendering

`SpatialCanvasOverlay.tsx` renders visible features, draft features, selected
features, text boxes, and snap markers on an HTML canvas overlay above the map.
This reduces the amount of visual styling pushed through MapLibre layers and
keeps text-box drawing under frontend control.

`useMapRenderer.ts` still manages the core MapLibre sources and layers:

- base boundary
- dim-outside mask
- hidden feature hit-test layers
- draft source
- snap preview source
- selected feature outline filter
- precision mode raster fade behavior

### Snapping

`useSnapEngine.ts` adds snap previews for:

- vertices
- midpoints
- edges
- corridor centers
- door centers

Snapping uses pixel distance from the current map projection and respects the
project snapping configuration.

### Floors and Indoor Projects

The branch makes floors the primary grouping mechanism for building and indoor
features:

- `FloorSelector.tsx` provides an in-map floor switcher.
- `EditorStructurePanel.tsx` provides floor creation, rename, delete, and object filtering.
- Building and indoor projects require a selected floor before drawing.
- The editor auto-creates a default `F1` floor if a building or indoor project has no floors.
- `BuildingEntryOverlay.tsx` lets a selected campus building polygon open or create a child indoor project.

Layers are deprecated in runtime. The backend compatibility endpoint returns an
empty layer list.

### Metadata and Measurement

`EditorSidebar.tsx` adds an inspector for:

- selected object name
- tag
- note
- active floor
- zoom and precision status
- visible object count
- cursor coordinates
- local coordinates relative to the project bbox origin
- draft length, area, and perimeter estimates
- snap status

## Published Overlay Behavior

`DroneMap.tsx` can show published projects on the main map:

- It fetches overlays from `/api/map-overlays` using the current map bbox.
- It only requests and displays overlays above `boundaryMinZoom`.
- It shows project boundaries and features as separate GeoJSON sources.
- It selects nearby projects and displays a small spatial map panel at high zoom.
- It filters selected project features by selected floor.
- It can delete a selected overlay project and remove child projects from local state.

This connects the editor publish flow back to the original operator map.

## Type and Service Contract Changes

`frontend/src/types/drone.ts` now includes types for:

- OSM element geometry and candidate metadata.
- editor modes.
- project source and status.
- floor records.
- project canvas, snapping, and measurement config.
- drawing project payloads.
- enclosing-space classification responses.

`frontend/src/services/spatial.ts` wraps the new backend API surface for:

- fetching OSM geometry
- creating projects from OSM, geometry, or GeoJSON
- listing and loading projects
- fetching visible features
- saving and deleting features
- publishing and deleting projects
- managing floors
- fetching map overlays
- creating and listing child projects

## Configuration Changes

`docker-compose.yml` now defines:

- `db`: PostGIS `postgis/postgis:16-3.4`
- `backend`: Python 3.11 backend with `DATABASE_URL`
- `sim`: simulator service

`requirements.txt` adds:

- `psycopg[binary]>=3.1.18`

`.gitignore` adds:

- `backend/data/`
- `backend/__pycache__/`

The `.gitignore` change is correct for new generated files, but the branch
still contains a tracked `backend/__pycache__/main.cpython-312.pyc` binary file.

## Notable Risks and Follow-Up Work

- PostGIS is configured but not used by the current backend. The implemented persistence path is JSON.
- `backend/__pycache__/main.cpython-312.pyc` is tracked and should be removed from version control in a cleanup commit.
- OSM and Overpass requests depend on external network services and do not have caching, retry policy, or rate-limit handling.
- Backend feature validation is mainly vertex-based. Complex boundaries can still need stronger geometry intersection checks.
- There is no authentication or authorization for project editing, deletion, or publish APIs.
- The spatial editor is large and stateful, but no automated tests were added in this branch.
- `plan.md` describes a broader target architecture than the code currently implements; reviewers should treat it as planning context, not implemented behavior.

## Review Checklist

Use this checklist when reviewing or continuing work on this branch:

- Confirm the intended storage backend: JSON now, PostGIS later.
- Remove tracked Python cache files before final merge cleanup.
- Test OSM way and relation selection with real examples.
- Test large-area confirmation behavior.
- Test project creation, reload, publish, overlay display, and delete.
- Test floor creation, rename, delete, and selected-floor feature filtering.
- Test editor interactions: select, move, delete, lasso, pen, text, polygon, rectangle, ellipse, triangle.
- Test child indoor project creation from a campus building polygon.
- Add backend and frontend tests around geometry conversion and feature persistence before production use.
