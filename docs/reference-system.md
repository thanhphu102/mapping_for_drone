# Reference: System Contracts and Runtime Model

This reference describes the implemented web contracts and runtime behavior.

## Runtime Processes

- Backend API server: `uvicorn backend.main:app --host <host> --port <port>`
- Drone simulator(s): `python3 drone_sim.py --id <drone_id> --host <host> --port <port>`
- Frontend: static files from `frontend/`, served by backend root route

## HTTP and WebSocket Surface

- Origin (local default): `http://127.0.0.1:9002`
- Static frontend: `GET /`
- Command API: `POST /command`
- Frontend telemetry/events stream: `GET /ws/frontend` with WebSocket upgrade
- Drone connection stream: `GET /ws/drone/{drone_id}` with WebSocket upgrade

Notes:
- Frontend and backend are served from the same origin in local development.
- WebSocket protocol is unencrypted (`ws://`) in local mode; production should use `wss://`.

## Core Files

- `backend/main.py`: WebSocket + REST API, connection registries, broadcast logic
- `frontend/index.html`: map UI, telemetry handling, command dispatch UI
- `drone_sim.py`: async simulator client
- `run_dev.sh`: local orchestration script
- `docker-compose.yml`: minimal containerized run setup

## Backend In-Memory State

- `drone_connections: Dict[str, WebSocket]`
  - Key: drone ID from `/ws/drone/{drone_id}` path
  - Value: live drone WebSocket instance
- `frontend_connections: List[WebSocket]`
  - All browser subscribers for telemetry/events
- `lock: asyncio.Lock`
  - Guards write access to `drone_connections` and command dispatch iteration

## API Contracts

### WebSocket Endpoint: `/ws/drone/{drone_id}`

Direction: drone -> backend and backend -> drone

Drone sends telemetry payloads (JSON text):

```json
{"lat": 37.123, "lon": -122.456, "alt": 50, "battery": 85.5}
```

Backend sends command payloads:

```json
{"type": "command", "target": {"lat": 37.5, "lon": -122.5, "alt": 100}}
```

Behavior:
- A later connection using the same `drone_id` replaces the previous in-memory socket entry.
- Invalid JSON telemetry is wrapped as `{ "raw": "..." }` and still broadcast.
- On disconnect, backend removes the registry entry and emits `disconnect` to frontends.

### WebSocket Endpoint: `/ws/frontend`

Direction: backend -> frontend (frontend may send keepalive text)

Frontend receives events:

```json
{"type": "connect", "drone_id": "drone1"}
{"type": "disconnect", "drone_id": "drone1"}
{"type": "telemetry", "drone_id": "drone1", "payload": {"lat": 37.123, "lon": -122.456, "alt": 50, "battery": 85.5}}
{"type": "command_sent", "target": {"lat": 37.5, "lon": -122.5}, "to": ["drone1", "drone2"]}
```

Behavior:
- Backend attempts broadcast to all connected frontends.
- Dead frontend sockets are removed from connection list on send failure.

### REST Endpoint: `POST /command`

Method and content type:
- Method: `POST`
- Header: `Content-Type: application/json`

Request body:

```json
{
  "target": {"lat": 37.5, "lon": -122.5, "alt": 100},
  "drones": "all"
}
```

or explicit IDs:

```json
{
  "target": {"lat": 37.5, "lon": -122.5},
  "drones": ["drone1", "drone3"]
}
```

Response:

```json
{"ok": true, "sent": ["drone1", "drone3"]}
```

Behavior:
- If `drones` is `"all"`, backend targets all currently connected drone IDs.
- Unknown/disconnected IDs are skipped silently.
- Endpoint currently returns success even when no drones are sent.

## Browser Runtime Expectations

- Required browser features:
  - `WebSocket`
  - `fetch`
  - `requestAnimationFrame`
  - ES2018+ JavaScript support
- Mapping dependency loaded from CDN:
  - `maplibre-gl@4.7.1`
- Tiles loaded from:
  - `https://tile.openstreetmap.org/{z}/{x}/{y}.png`

If CDN or tile network access is unavailable, map rendering degrades/fails.

## Frontend Runtime Model

- `droneState`: object keyed by drone ID with status and latest telemetry
- `markers`: object keyed by drone ID containing map markers
- Marker lifecycle:
  - created/updated when drone is connected and in current map bounds
  - removed when disconnected or outside viewport
- Table lifecycle:
  - updates are batched via `requestAnimationFrame`

Performance notes:
- Marker updates are bounded by current viewport visibility.
- Table rendering uses full tbody replacement, acceptable for prototype sizes.
- For higher drone counts, consider row diffing or virtualized rendering.

## Accessibility Notes (Current State)

- Table structure is semantic (`table`, `thead`, `tbody`), which helps screen readers.
- Command action is currently popup + button + alert driven.
- Future improvement areas:
  - Keyboard-first command workflow
  - ARIA live region for connection and command status
  - Focus management around popup interactions

## Security Notes (Current State)

- Local prototype has no auth/authz for API or WebSocket channels.
- No explicit CSP, HSTS, or additional security headers configured.
- Simulator and frontend trust inbound message shapes.

Recommended hardening baseline:
- Serve via HTTPS and `wss://` behind reverse proxy.
- Add API authentication and route-level authorization.
- Validate and constrain payload schemas.
- Add CSP and related security headers.

## Local Operations

Recommended:

```bash
./run_dev.sh
```

Manual backend:

```bash
uvicorn backend.main:app --host 127.0.0.1 --port 9002 --reload
```

Manual simulator:

```bash
python3 drone_sim.py --id drone1 --host 127.0.0.1 --port 9002
```

## Known Constraints

- Frontend displays only connected drones in table.
- Command dispatch silently skips disconnected drone IDs.
- Backend accepts loosely shaped command dictionaries.
- No historical telemetry retained after process exit.
