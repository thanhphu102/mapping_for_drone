# Refactor And Optimization Concerns

## Document Profile

- Diataxis type: Explanation plus decision reference.
- Audience: maintainer developers.
- Goal: decide what to keep, refactor, remove, or defer.
- Scope: documentation-backed recommendations only. No runtime code is changed by this audit.

## Decision Matrix

| Area | Decision | Priority | Reason | Risk if ignored | Evidence |
| --- | --- | --- | --- | --- | --- |
| Drone telemetry and command flow | Keep, then type harden | Medium | Core prototype value and relatively isolated frontend hooks/services. | Command payloads remain loosely validated. | `backend/main.py`, `useDroneTelemetry.ts`, `commands.ts` |
| `backend/main.py` as one large module | Refactor | High | It owns unrelated domains in 1789 lines. | Any change risks regression across drone, OSM, editor, routes, and static serving. | `backend/main.py`, `wc -l` |
| JSON project storage | Keep short term, defer replacement | High | It matches current runtime and keeps cleanup small. | Premature PostGIS work may mix schema design with UI refactor. | `/api/storage/status`, `.gitignore`, `backend/main.py` |
| PostGIS dependency/config | Defer implementation or remove from prototype path | High | Docker and dependency exist, but backend reports JSON storage. | Maintainers may assume production persistence exists when it does not. | `docker-compose.yml`, `requirements.txt`, `backend/main.py` |
| Tracked `backend/__pycache__` | Remove from version control | High | Generated binary file is tracked despite ignore rule. | Noisy diffs and stale compiled artifacts. | `git ls-files backend/__pycache__` |
| `/debug/osm-selection` | Remove or gate | High | Debug endpoint logs selected OSM payload details to stdout. | Debug surface remains exposed in local API and can leak noisy data. | `backend/main.py`, `App.tsx` |
| OSM console logging in `App.tsx` | Remove or gate | High | Selection flow logs full OSM JSON. | Browser console can expose large payloads and slows debugging signal. | `frontend/src/App.tsx` |
| Deprecated layers compatibility | Refactor/remove after compatibility decision | Medium | `layers` are migrated away and endpoint returns empty list, but `default_layers()` remains. | Dead API/code keeps old concepts alive. | `backend/main.py`, `docs/explanation-map-canvas-branch-changes.md` |
| `SpatialEditor.tsx` | Refactor | High | 1753-line component owns project loading, drawing, floors, feature editing, publish, and navigation. | UX changes and bug fixes stay expensive. | `SpatialEditor.tsx`, `wc -l` |
| `useDrawingEngine.ts` | Refactor after tests | High | 1645-line hook mixes geometry utilities and interaction lifecycle. | Geometry regressions during extraction. | `useDrawingEngine.ts`, `TESTING.md` |
| `DroneMap.tsx` | Refactor | Medium | Combines drone markers, target popover, OSM highlight, overlays, tracking, floor overlay panel, and delete behavior. | Main map remains hard to reason about. | `DroneMap.tsx` |
| `App.tsx` | Refactor | Medium | Owns main route state, OSM flow, command flow, and tracking control orchestration. | UI workflow changes require broad edits. | `App.tsx` |
| Shared `types/drone.ts` | Refactor | Medium | Contains drone, OSM, tracking, spatial, floor, and editor types. | Domain coupling grows as features are added. | `frontend/src/types/drone.ts` |
| Build bundle size | Optimize | Medium | Build passes but Vite warns about a large JS chunk around 1.12 MB minified. | Slower initial load and worse main-map startup as editor grows. | `npm run build` |
| OSM/Overpass upstream calls | Optimize/defer production policy | Medium | No caching or retry policy is visible. | Rate limits and upstream failures affect operator flow. | `osm.ts`, `backend/main.py` |
| Auth and authorization | Defer to production roadmap | High for production | No auth is visible on command/edit/delete/publish routes. | Unsafe outside trusted local environments. | `backend/main.py`, `README.md` |
| Automated tests | Add before major refactor | High | No test/spec files found. | Refactor becomes manual-QA only. | test-file search, `TESTING.md` |

## Short-Term Cleanup Path

Do this while preserving current JSON-backed behavior:

1. Remove tracked generated artifacts: `backend/__pycache__/main.cpython-312.pyc`.
2. Remove or environment-gate `/debug/osm-selection` and browser `console.log()` calls for full OSM payloads.
3. Add backend tests for OSM geometry conversion, boundary validation, project JSON persistence, and route save validation.
4. Add frontend tests for pure drawing/geometry utilities before extracting from `useDrawingEngine.ts`.
5. Split `backend/main.py` into routers and service modules without changing endpoint contracts.
6. Split `SpatialEditor.tsx` into data-loading hooks, feature editing hooks, floor management, inspector, and shell components.
7. Split `DroneMap.tsx` overlay and tracking behavior into dedicated hooks/components.
8. Split `types/drone.ts` into domain type files once service boundaries are stable.

## UX/UI Optimization Recommendations

- Make the clicked-map target workflow explicit: one action path for drone command, one for OSM/spatial project creation.
- Replace long editor tool surfaces with grouped controls: select/edit, draw shapes, indoor tools, floor/project management.
- Keep floor selector hidden for outdoor projects unless floors exist or the user is editing a child indoor/building project.
- Add consistent loading, empty, success, and error states for OSM fetch, project create, publish, overlay fetch/delete, and route save.
- Add keyboard and screen-reader coverage for critical editor controls.
- Reduce modal/confirm reliance for destructive actions by using clearer inline confirmation states where practical.

## Performance Optimization Recommendations

Short term:

- Lazy-load `SpatialEditor` so the main map dashboard does not ship the full editor on initial load.
- Move heavy drawing geometry utilities into separately imported modules once tests exist.
- Abort or ignore stale overlay fetches when map viewport changes quickly.
- Cache OSM full geometry responses on the backend for repeated project creation/preview.
- Keep `requestAnimationFrame` batching for telemetry and canvas rendering.

Long term:

- Implement PostGIS storage with spatial indexes for project bbox and feature visibility queries.
- Use backend-side OSM/Overpass cache with rate-limit policy.
- Add performance budgets for initial JS, map startup, overlay refresh, and editor frame time.
- Add metrics around WebSocket message rate, overlay query duration, OSM upstream duration, and editor render frame cost.

## Intent Vs Reality Divergences

- Intent in `plan.md`: PostgreSQL/PostGIS is the source of truth. Reality: backend stores projects in JSON and reports `postgis: false`.
- Intent in `.gitignore`: ignore `backend/__pycache__/`. Reality: one `backend/__pycache__` file is tracked.
- Intent in docs: older `docs/reference-system.md` still describes `frontend/index.html` as a core frontend file. Reality: current frontend source is React/Vite under `frontend/src`.
- Intent in branch explanation: layers are deprecated. Reality: compatibility endpoint and `default_layers()` remain in backend code.
- Intent for production-like safety: backend validates some spatial data. Reality: auth, schema-wide validation, database constraints, and production observability are not implemented.

## Open Decisions

1. [ASK USER] Should short-term cleanup keep PostGIS config as roadmap scaffolding, or remove it until implementation begins?
2. [ASK USER] Should `/debug/osm-selection` be fully removed or protected behind a development flag?
3. [ASK USER] What compatibility window is required for `/api/drawing-projects/{project_id}/layers`?
4. [ASK USER] Should API contracts remain camelCase end-to-end, or should backend internals use snake_case with serializers?
5. [ASK USER] What auth model should protect drone command, project edit/delete/publish, and WebSocket APIs before non-local use?
6. [ASK USER] Is the next milestone prototype cleanup, PostGIS migration, or UX polish?

## Evidence

- `backend/main.py`
- `frontend/src/App.tsx`
- `frontend/src/components/DroneMap.tsx`
- `frontend/src/components/SpatialEditor.tsx`
- `frontend/src/hooks/useDrawingEngine.ts`
- `frontend/src/types/drone.ts`
- `docker-compose.yml`
- `requirements.txt`
- `.gitignore`
- `plan.md`
- `docs/reference-system.md`
- `docs/explanation-map-canvas-branch-changes.md`
- Command results: `git ls-files backend/__pycache__`, `wc -l`, `npm run build`, test-file search.
