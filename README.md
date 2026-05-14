# Swarm GSC Map Prototype

Interactive map frontend for Ground Station Computer (GSC) to control drone swarms. Click on the map to set target coordinates, and all connected drones will fly to that point.

## Maintainer Documentation

For architecture, internal references, and feature-development guides, see:

- `docs/README.md`

## Quickstart

**One command to start everything:**
```bash
./run_dev.sh              # 3 drones on port 9002 (auto-kills old processes)
./run_dev.sh 5            # 5 drones
./run_dev.sh 5 8000       # 5 drones on port 8000
```

Then open your browser to **http://127.0.0.1:9002**

Features:
- ✅ Auto-kills any old processes for fresh start
- ✅ Starts backend + drone simulators
- ✅ No separate setup needed (uses existing venv)
- ✅ Ctrl+C to stop all services cleanly

## Manual Setup

1. Create virtual environment and install dependencies:
```bash
python3 -m venv venv
source venv/bin/activate  # or: venv\Scripts\activate (Windows)
pip install -r requirements.txt
```

2. Start the backend:
```bash
cd backend
uvicorn main:app --reload --host 127.0.0.1 --port 9002
```

3. In another terminal, run drone simulator(s):
```bash
python3 drone_sim.py --id drone1 --port 9002
python3 drone_sim.py --id drone2 --port 9002  # add more drones
```

4. Open http://127.0.0.1:9002 in your browser.

## Features

✅ **Interactive Map** - MapLibre GL JS map with OpenStreetMap raster tiles
✅ **Drone Status Table** - Real-time list of connected drones with position and battery
✅ **WebSocket Telemetry** - Live drone positions streamed to frontend
✅ **Swarm Commands** - Click map → send target to all/selected drones
✅ **Multi-Drone Sim** - Asyncio-based simulator for testing swarm behavior

## Frontend UI

- **Left**: MapLibre map showing drone positions (markers update in real-time)
- **Right Sidebar**: 
  - Click info: instructions
  - Drone Status Table showing: ID, Status (On/Off), Lat, Lon, Battery %
  
Click on the map to set a target → drones navigate toward it.

## Architecture

```
┌─────────────────────────────────────────────┐
│  Frontend (MapLibre GL JS + WebSocket)      │
│  - Displays drone positions                 │
│  - Accepts map clicks → target coords       │
│  - Real-time drone status table             │
└──────────────┬──────────────────────────────┘
               │ WebSocket /ws/frontend
               ▼
┌─────────────────────────────────────────────┐
│  Backend (FastAPI + Uvicorn)                │
│  - /ws/drone/{id}      - drone telemetry    │
│  - /ws/frontend        - frontend stream    │
│  - POST /command       - send commands      │
└──────────────┬──────────────────────────────┘
               │ WebSocket /ws/drone/{id}
               ▼
    ┌──────────────────────────┐
    │ Drone Sim (asyncio)      │
    │ - Sends telemetry        │
    │ - Receives commands      │
    │ - Navigates to targets   │
    └──────────────────────────┘
```

## API

### WebSocket: `/ws/frontend`
Frontend subscribes to telemetry broadcasts:
```json
{"type": "telemetry", "drone_id": "drone1", "payload": {"lat": 37.123, "lon": -122.456, "alt": 50, "battery": 85.5}}
{"type": "connect", "drone_id": "drone1"}
{"type": "disconnect", "drone_id": "drone1"}
{"type": "command_sent", "target": {...}, "to": ["drone1", "drone2"]}
```

### WebSocket: `/ws/drone/{drone_id}`
Drones connect and:
- **Send (every 1s by default):** `{"lat": float, "lon": float, "alt": float, "battery": float}`
- **Receive:** `{"type": "command", "target": {"lat": float, "lon": float, "alt": optional}}`

### REST: `POST /command`
Send command to drones:
```json
{
  "target": {"lat": 37.5, "lon": -122.5, "alt": 100},
  "drones": "all"  // or ["drone1", "drone2"]
}
```
Response:
```json
{"ok": true, "sent": ["drone1", "drone2"]}
```

## Configuration

Environment variables (optional):
```bash
export HOST=0.0.0.0           # Backend listen address
export PORT=8000              # Backend listen port
export INTERVAL=0.5           # Drone telemetry interval (seconds)
```

## Development Notes

- **Simulator** uses asyncio for concurrent operations; scales to many drones on a single machine
- **Frontend** updates drone table on every telemetry message for real-time feedback
- **Backend** broadcasts all drone telemetry to all frontends; add auth layer for production
- Messages are small JSON payloads; consider Protocol Buffers for optimization at scale

## Next Steps

- [ ] Add altitude visualization (3D view or altitude graph)
- [ ] Implement MQTT broker option (scalable pub/sub)
- [ ] Add mission planning (waypoint sequences)
- [ ] Geofencing & safety boundaries
- [ ] Authentication & authorization (JWT)
- [ ] Persistent flight logs & telemetry DB
- [ ] Collision avoidance for swarm optimization
