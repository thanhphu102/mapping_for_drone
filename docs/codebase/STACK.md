# Stack Reference

## Document Profile

- Diataxis type: Reference.
- Audience: maintainer developers deciding what to keep, refactor, remove, or defer.
- Goal: summarize the verified runtime, tooling, dependency, and storage stack.
- Scope: current repository state only. Proposed production changes are documented as recommendations, not implemented behavior.

## Runtime Stack

| Area | Current implementation | Notes for refactor decisions |
| --- | --- | --- |
| Backend API | FastAPI app in `backend/main.py` | One module owns drone WebSockets, command API, OSM geometry, spatial project CRUD, floors, route persistence, tile proxy, and static frontend serving. |
| Backend runtime | Uvicorn is documented and required by `requirements.txt` | `README.md` runs `uvicorn main:app` from `backend`; Docker runs `uvicorn backend.main:app`. |
| Backend language | Python | `pyproject.toml` says `requires-python = ">=3.12"`, while `docker-compose.yml` uses `python:3.11-slim`. |
| Frontend | React + TypeScript + Vite | `frontend/package.json` scripts are `dev`, `build`, `lint`, and `preview`. |
| Map rendering | MapLibre GL JS | Used on the main map and spatial editor. |
| Styling | Tailwind CSS plus custom CSS in `frontend/src/index.css` | CSS contains MapLibre overrides, marker styles, popover styles, floor selector styles, and editor overlay styles. |
| Icons | `lucide-react` | Imported in UI components such as `App.tsx`. |
| Drone transport | WebSocket JSON payloads | Backend exposes `/ws/drone/{drone_id}` and `/ws/frontend`. |
| Command transport | REST JSON | Backend exposes `POST /command`. |
| Spatial storage | JSON file storage | Runtime storage status endpoint returns `{"storage": "json", "postgis": false}`. |
| Planned storage | PostgreSQL/PostGIS | Docker and dependencies exist, but backend code does not connect to `DATABASE_URL`. |

## Dependencies

Backend dependencies are declared in two places:

- `requirements.txt`: `fastapi`, `uvicorn[standard]`, `websockets`, `psycopg[binary]`.
- `pyproject.toml`: `uv`, `httpx[http2]`, `python-multipart`, `websockets`, `fastapi`.

Frontend dependencies are declared in `frontend/package.json`:

- Production: `@tailwindcss/vite`, `lucide-react`, `maplibre-gl`, `react`, `react-dom`, `tailwindcss`.
- Development: ESLint, TypeScript, React type packages, Vite, `@vitejs/plugin-react`, and related TypeScript ESLint packages.

## Tooling Baseline

Last verified baseline in this documentation pass:

- `npm run lint` from `frontend`: passed.
- `npm run build` from `frontend`: passed.
- `venv/bin/python -c "... ast.parse(...)"`: parsed `backend/main.py` and `drone_sim.py`.

The frontend production build produced one large JavaScript asset around 1.12 MB minified and Vite emitted a large chunk warning. This is an optimization signal for route-level code splitting, especially for the spatial editor.

## Storage Reality

Current storage behavior is JSON-backed:

- Spatial projects are read and written through `backend/data/drawing_projects.json`.
- Tracked routes are written under `backend/data/tracked-routes/`.
- `.gitignore` ignores `backend/data/`, so this directory should be treated as local runtime state.

The repository also contains PostGIS planning/configuration:

- `docker-compose.yml` defines a `postgis/postgis:16-3.4` service.
- `requirements.txt` includes `psycopg[binary]`.
- `docker-compose.yml` sets `DATABASE_URL` for the backend container.
- `backend/main.py` does not import or use `psycopg`, and `/api/storage/status` reports `postgis: false`.

## Decision Notes

- Keep the current JSON storage path for short-term prototype cleanup unless the next milestone is explicitly production persistence.
- Refactor dependency declarations to one source of truth before production work. [ASK USER]
- Resolve the Python runtime mismatch between `pyproject.toml` and `docker-compose.yml`. [ASK USER]
- Defer PostGIS implementation until schema, migrations, and validation responsibilities are decided. [ASK USER]

## Evidence

- `README.md`
- `requirements.txt`
- `pyproject.toml`
- `docker-compose.yml`
- `backend/main.py`
- `.gitignore`
- `frontend/package.json`
- `frontend/src/index.css`
- Command results: `npm run lint`, `npm run build`, Python AST parse command.
