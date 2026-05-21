# Integrations Reference

## Document Profile

- Diataxis type: Reference.
- Audience: maintainer developers.
- Goal: document implemented external and internal integration points.
- Scope: runtime integrations visible in source/config. Production integrations not implemented are marked as planned or `[TODO]`.

## Internal HTTP And WebSocket APIs

| Integration | Endpoint or module | Current behavior |
| --- | --- | --- |
| Drone telemetry WebSocket | `/ws/drone/{drone_id}` | Drones send telemetry JSON; backend broadcasts to frontends. |
| Frontend event WebSocket | `/ws/frontend` | Frontend receives connect, disconnect, telemetry, and command sent events. |
| Drone command API | `POST /command` | Backend forwards command target to all or selected connected drones. |
| OSM geometry API | `GET /api/osm/elements/{osm_type}/{osm_id}/geometry` | Backend fetches OSM full JSON and converts selected way/relation to project geometry. |
| Project creation | `POST /api/drawing-projects/from-osm`, `/api/spatial-projects/from-geometry`, `/api/spatial-projects/import-geojson` | Creates JSON-backed spatial projects. |
| Project CRUD | `/api/drawing-projects...` | Lists, loads, deletes, publishes projects and manages features. |
| Floor CRUD | `/api/drawing-projects/{project_id}/floors...` | Lists, creates, updates, deletes floors. |
| Published overlays | `GET /api/map-overlays?bbox=...` | Returns published projects intersecting the viewport bbox. |
| Route tracking | `POST /api/routes` | Saves tracked route GeoJSON under `backend/data/tracked-routes/`. |
| Storage status | `GET /api/storage/status` | Reports JSON storage and `postgis: false`. |
| Tile proxy | `GET /api/tiles/osm/{z}/{x}/{y}.png` | Fetches OSM raster tiles and returns them with cache headers. |
| Static frontend | `StaticFiles` mount and `/spatial-editor/{project_id}` | Serves Vite build output from `frontend/dist`. |

## External Services

| Service | Caller | Purpose | Risk |
| --- | --- | --- | --- |
| OpenStreetMap API | `backend/main.py`, `frontend/src/services/osm.ts` | Fetch full OSM way/relation JSON. | No local cache; backend disables SSL verification for OSM full fetch. |
| Overpass API | `frontend/src/services/osm.ts` | Find enclosing OSM elements around clicked coordinates. | Client-side external dependency, rate-limit and availability risk. |
| OpenStreetMap tile server | `backend/main.py` tile proxy and map style usage | Raster map tiles. | Needs cache/rate-limit policy for heavier use. |
| MapLibre GL JS | Frontend | Map rendering and layer/source management. | Large dependency and WebGL lifecycle complexity. |

## Storage Integrations

Implemented:

- `backend/data/drawing_projects.json` for spatial projects.
- `backend/data/tracked-routes/*.geojson` for saved tracking routes.
- In-memory dictionaries/lists for active drone and frontend WebSocket connections.

Configured but not implemented:

- `docker-compose.yml` defines a PostGIS container.
- `requirements.txt` includes `psycopg[binary]`.
- `DATABASE_URL` is provided to the Docker backend service.
- `backend/main.py` does not use a database driver or migrations.

## Security And Auth

Current state:

- No authentication or authorization is visible in backend routes.
- Drone WebSocket, frontend WebSocket, project edit/delete/publish APIs, and command APIs are open in local mode.
- No CSP/HSTS/security headers are configured in backend code.

Production decision needed:

- Choose auth model for operators, drone clients, and editor users. [ASK USER]
- Decide whether drone transport remains direct WebSocket or moves to brokered transport such as MQTT. [ASK USER]

## Observability

Current state:

- Debug output uses `print()` in `/debug/osm-selection` and OSM fetch failure handling.
- Frontend logs some command and overlay failures to browser console.
- No structured logging, metrics, tracing, or health endpoint is visible beyond Docker PostGIS healthcheck.

Recommended direction:

- Short term: gate debug endpoints/logging and add consistent error notices.
- Long term: add structured backend logs, request IDs, WebSocket connection counts, OSM upstream timing, overlay query timing, and route save metrics.

## Evidence

- `backend/main.py`
- `frontend/src/services/osm.ts`
- `frontend/src/services/spatial.ts`
- `frontend/src/services/realtime.ts`
- `frontend/src/services/commands.ts`
- `frontend/src/services/routes.ts`
- `docker-compose.yml`
- `requirements.txt`
- `README.md`
- `docs/reference-system.md`
