# Testing Reference

## Document Profile

- Diataxis type: Reference and how-to checklist.
- Audience: maintainer developers.
- Goal: document current validation commands, test gaps, and scenarios needed before refactor.
- Scope: current repo capabilities and recommended test coverage. No new test framework is added in this documentation pass.

## Current Automated Test State

No test files were found by this documentation pass using:

```bash
find . -maxdepth 4 -type f \( -name '*test*' -o -name '*spec*' \) -not -path './frontend/node_modules/*' -not -path './venv/*' -print
```

Current available checks:

```bash
cd frontend
npm run lint
npm run build
```

```bash
venv/bin/python -c "import ast, pathlib; ast.parse(pathlib.Path('backend/main.py').read_text(encoding='utf-8')); ast.parse(pathlib.Path('drone_sim.py').read_text(encoding='utf-8')); print('python_ast_ok')"
```

Last verified baseline in this documentation pass:

- Frontend lint passed.
- Frontend build passed.
- Python AST parse passed.
- Vite warned that one minified JS chunk is larger than 500 kB; built JS asset was around 1.12 MB.

## Manual QA Scenarios

Use these before and after any refactor that touches runtime behavior.

| Scenario | Steps | Expected result |
| --- | --- | --- |
| Drone telemetry connect | Start backend and at least one simulator through `./run_dev.sh`. | Drone appears connected in table and marker appears on map. |
| Drone command | Click map and send command. | `POST /command` succeeds and command status reports sent drone IDs. |
| WebSocket reconnect | Stop and restart backend or simulator. | Frontend shows connection change and recovers after reconnect. |
| OSM candidate fetch | Click map, choose `Fetch location`. | OSM candidate panel loads or shows a clear error. |
| OSM project create | Select a valid way/relation and open spatial editor. | Existing project is reused or new project is created and route opens. |
| Large boundary confirmation | Select an extremely large boundary if available. | Creation requires confirmation before proceeding. |
| Spatial draw/save | Draw point, line, polygon, text, and box shapes inside boundary. | Draft can be saved and reloaded. |
| Boundary validation | Try saving geometry outside the base boundary. | Backend rejects invalid feature. |
| Publish and overlay | Publish project, return to main map, zoom into project area. | Boundary and published features render as overlays. |
| Overlay delete | Select an overlay project and delete it. | Project and child projects disappear from local overlay state after successful backend delete. |
| Floor management | Create, rename, delete floors in a building/indoor project. | Floor list and feature filtering update correctly. |
| Tracking route save | Select drone, start tracking, stop, save route. | `/api/routes` returns saved route metadata and file path. |
| Tile proxy | Load map tiles through configured backend route if used. | Tile responses succeed or show clear upstream failure. |

## Recommended Backend Tests

Add focused tests before moving code out of `backend/main.py`:

- OSM way conversion preserves way node order and outputs `[lng, lat]`.
- OSM relation conversion stitches outer ways and handles inner rings.
- Invalid node-only, line-only, non-closed, or zero-area geometry is rejected.
- `normalize_to_multipolygon_geometry()` accepts Polygon/MultiPolygon and rejects unsupported geometry.
- `validate_feature_inside_boundary()` accepts inside features and rejects outside features.
- Large-area classification sets warnings and confirmation flags.
- Project JSON write/read keeps `features`, `publishedFeatures`, `floors`, and hierarchy fields.
- Floor create/update/delete preserves project timestamps and feature floor references as intended. [ASK USER]
- Route save rejects invalid coordinates and mismatched point/geometry lengths.
- `/command` validates target and drones shape once converted to Pydantic. [ASK USER]

## Recommended Frontend Tests

Add tests around pure logic first:

- `formatCoordinate()`, `formatBattery()`, and `formatDroneList()`.
- OSM candidate label/category parsing.
- Main map camera storage parser.
- Drawing geometry utilities: point-in-boundary, translate, rotate, measurement, draft-to-feature conversion.
- Tracking point sampling and LineString payload generation.
- Spatial service error handling for JSON and non-JSON error bodies.

Then add interaction/e2e coverage:

- Main map command popover workflow.
- OSM panel candidate selection and large-area confirmation.
- Spatial editor mode switching and keyboard shortcuts.
- Floor selector filtering.
- Publish-to-overlay path.
- Tracking route save path.

## Test Infrastructure Recommendations

- Backend: `pytest` plus FastAPI `TestClient` or `httpx` test client.
- Frontend unit tests: Vitest with React Testing Library.
- Browser/e2e: Playwright for MapLibre-heavy workflows and screenshot checks.
- Geometry fixtures: keep small OSM way/relation JSON fixtures under a test fixture directory.
- Network isolation: mock OSM, Overpass, and tile upstream calls in automated tests.

## Evidence

- `frontend/package.json`
- `frontend/eslint.config.js`
- `frontend/tsconfig.app.json`
- `backend/main.py`
- `drone_sim.py`
- `frontend/src/hooks/useDrawingEngine.ts`
- `frontend/src/hooks/useDroneTracking.ts`
- `frontend/src/services/osm.ts`
- `frontend/src/services/spatial.ts`
- Command results: test-file search, `npm run lint`, `npm run build`, Python AST parse.
