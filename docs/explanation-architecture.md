# Explanation: Architecture and Design Rationale

This project is a local-first swarm control prototype with three primary processes:

1. FastAPI backend (`backend/main.py`)
2. Browser frontend (`frontend/index.html`), served as static files by FastAPI
3. One or more simulator clients (`drone_sim.py`)

## Architectural Intent

The implementation chooses simple, inspectable web primitives:

- WebSocket between backend and drones for bidirectional, low-latency control.
- WebSocket between backend and frontend for real-time telemetry fanout.
- A REST endpoint (`POST /command`) for user-driven command dispatch.
- In-memory state on both backend and frontend to keep iteration speed high.

This makes the system easy to reason about while building swarm interaction workflows.

## Web Stack Perspective

- Transport model: HTTP/1.1 for REST and WebSocket upgrade; same-origin serving in local mode.
- Data format: JSON payloads for both REST and WebSocket messages.
- Frontend rendering: client-side rendering with MapLibre and DOM table updates.
- Connection model: long-lived WebSocket sessions for telemetry and control fanout.

The project intentionally avoids additional web infrastructure (reverse proxy, message broker, persistent store) to keep development feedback loops short.

## Component Responsibilities

### Backend (`backend/main.py`)

- Accepts drone WebSocket connections at `/ws/drone/{drone_id}`.
- Accepts frontend WebSocket connections at `/ws/frontend`.
- Receives telemetry from drones and broadcasts to every connected frontend.
- Receives commands via `POST /command` and forwards to target drone sockets.
- Hosts the frontend static app at `/`.

### Frontend (`frontend/index.html`)

- Renders map (MapLibre + OSM tiles).
- Maintains client-side `droneState` and marker objects.
- Displays connected drones and latest telemetry in a table.
- Lets operator click map to send a target command to all connected drones.

### Drone Simulator (`drone_sim.py`)

- Connects to backend as a named drone.
- Sends telemetry periodically.
- Listens for command messages.
- Moves simulated position toward the commanded target over time.

## End-to-End Flow

```mermaid
flowchart LR
    U[Operator clicks map] --> F[Frontend]
    F -->|POST /command| B[FastAPI backend]
    B -->|WS command message| D1[Drone socket(s)]
    D1 -->|WS telemetry| B
    B -->|WS telemetry broadcast| F
```

## Browser and UI Design Considerations

- The frontend depends on modern browser APIs: `WebSocket`, `fetch`, `requestAnimationFrame`.
- Marker refresh is viewport-aware, reducing map DOM/render load when many drones exist outside view.
- Table updates are batched in animation frames to avoid excessive layout and repaint work.
- Static asset serving from FastAPI avoids CORS complexity during local development.

## Why This Works for Maintenance

- Low cognitive overhead: one backend module, one frontend file, one simulator file.
- Observable behavior: WebSocket payloads are plain JSON and easy to inspect.
- Safe incremental changes: features can be added behind new message types.
- Web-native contracts: API and realtime flows map cleanly to browser devtools (Network + WS frames).

## Current Trade-Offs

- No persistence: restart loses all runtime state.
- No authentication or authorization: appropriate only for local/prototype use.
- Loose schemas: payloads are dictionary-based and minimally validated.
- Single-process in-memory connection registry: simple but not horizontally scalable.
- No hardened browser security policy (CSP/HSTS/header policy) by default.
- Limited accessibility semantics in UI controls and status announcements.

## Evolution Path

To grow toward production-grade web behavior, introduce changes in this order:

1. Message schemas with Pydantic models and validation.
2. Authn/authz for both REST and WebSocket channels.
3. Durable telemetry storage and event logs.
4. Brokered drone transport (e.g., MQTT) for scale and resilience.
5. Task allocation and safety modules (geofence, failsafe, retries).
6. Web security headers and TLS termination strategy (CSP, HSTS, secure cookies if sessions are used).
7. Frontend accessibility pass (keyboard flow, ARIA labels, contrast, status live regions).
8. Performance budget and measurement loop (frame rate, WS message volume, client memory).
