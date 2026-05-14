from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
import asyncio
import json
import os
from typing import Any, Dict, List

app = FastAPI()

drone_connections: Dict[str, WebSocket] = {}
frontend_connections: List[WebSocket] = []
lock = asyncio.Lock()

async def broadcast_to_frontends(message: dict) -> None:
    dead = []
    for ws in list(frontend_connections):
        try:
            await ws.send_json(message)
        except Exception:
            dead.append(ws)
    for ws in dead:
        try:
            frontend_connections.remove(ws)
        except ValueError:
            pass


@app.websocket("/ws/drone/{drone_id}")
async def ws_drone(websocket: WebSocket, drone_id: str):
    await websocket.accept()
    async with lock:
        drone_connections[drone_id] = websocket
    await broadcast_to_frontends({"type": "connect", "drone_id": drone_id})
    try:
        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
            except Exception:
                msg = {"raw": data}
            await broadcast_to_frontends({"type": "telemetry", "drone_id": drone_id, "payload": msg})
    except WebSocketDisconnect:
        async with lock:
            drone_connections.pop(drone_id, None)
        await broadcast_to_frontends({"type": "disconnect", "drone_id": drone_id})


@app.websocket("/ws/frontend")
async def ws_frontend(websocket: WebSocket):
    await websocket.accept()
    frontend_connections.append(websocket)
    try:
        while True:
            # Keep connection alive; frontend can send pings if desired
            await websocket.receive_text()
    except WebSocketDisconnect:
        try:
            frontend_connections.remove(websocket)
        except ValueError:
            pass


@app.post("/command")
async def post_command(cmd: dict):
    """Dispatch a command to one or more drones.

    Expected JSON shape:
      {"target": {"lat": number, "lon": number, "alt": number (optional)}, "drones": ["id1",...] | "all"}
    """
    target = cmd.get("target")
    drones = cmd.get("drones", "all")
    message = {"type": "command", "target": target}
    sent = []
    async with lock:
        if drones == "all":
            targets = list(drone_connections.keys())
        else:
            targets = drones
        for d in targets:
            ws = drone_connections.get(d)
            if ws:
                try:
                    await ws.send_json(message)
                    sent.append(d)
                except Exception:
                    pass
    await broadcast_to_frontends({"type": "command_sent", "target": target, "to": sent})
    return {"ok": True, "sent": sent}


@app.post("/debug/osm-selection")
async def debug_osm_selection(payload: dict):
    selected_type = payload.get("type")
    selected_id = payload.get("id")
    full = payload.get("full")

    print("\n===== OSM SELECTION =====")
    print(f"Type: {selected_type}")
    print(f"ID: {selected_id}")

    if not isinstance(full, dict):
        print("Raw payload summary: full payload is not a JSON object")
        print("=========================\n")
        return {"ok": True}

    elements = full.get("elements")
    if not isinstance(elements, list):
        print("Raw payload summary: no elements array")
        print(f"Top-level keys: {list(full.keys())}")
        print("=========================\n")
        return {"ok": True}

    matching_element: Dict[str, Any] | None = None
    for element in elements:
        if not isinstance(element, dict):
            continue
        if element.get("type") == selected_type and element.get("id") == selected_id:
            matching_element = element
            break

    if matching_element:
        tags = matching_element.get("tags")
        if isinstance(tags, dict) and tags:
            print("\nTags:")
            for key in sorted(tags.keys()):
                value = tags.get(key)
                print(f"{key} = {value}")
        else:
            print("\nTags: <none>")
    else:
        print("\nMatched selected element: <not found in full payload>")

    node_elements = [
        element for element in elements
        if isinstance(element, dict) and element.get("type") == "node"
    ]
    way_elements = [
        element for element in elements
        if isinstance(element, dict) and element.get("type") == "way"
    ]
    relation_elements = [
        element for element in elements
        if isinstance(element, dict) and element.get("type") == "relation"
    ]

    if selected_type == "way":
        print("\nNodes:")
        if node_elements:
            for index, node in enumerate(node_elements, start=1):
                node_id = node.get("id")
                node_lat = node.get("lat")
                node_lon = node.get("lon")
                print(f"{index}. node {node_id} lat={node_lat} lon={node_lon}")
        else:
            print("<none>")

    if selected_type == "relation":
        print("\nRelation members:")
        members = matching_element.get("members") if matching_element else None
        if isinstance(members, list) and members:
            for index, member in enumerate(members, start=1):
                if not isinstance(member, dict):
                    continue
                member_type = member.get("type")
                member_ref = member.get("ref")
                member_role = member.get("role")
                print(f"{index}. {member_type} {member_ref} role={member_role}")
        else:
            print("<none>")

        print("\nIncluded ways:")
        if way_elements:
            for index, way in enumerate(way_elements, start=1):
                way_id = way.get("id")
                way_nodes = way.get("nodes")
                node_count = len(way_nodes) if isinstance(way_nodes, list) else 0
                print(f"{index}. way {way_id} nodes={node_count}")
        else:
            print("<none>")

        print("\nIncluded nodes:")
        if node_elements:
            for index, node in enumerate(node_elements, start=1):
                node_id = node.get("id")
                node_lat = node.get("lat")
                node_lon = node.get("lon")
                print(f"{index}. node {node_id} lat={node_lat} lon={node_lon}")
        else:
            print("<none>")

    print("\nRaw payload summary:")
    print(f"elements_total={len(elements)}")
    print(f"nodes={len(node_elements)} ways={len(way_elements)} relations={len(relation_elements)}")
    print("=========================\n")
    return {"ok": True}

# Mount static files AFTER all routes are defined
frontend_dist_path = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")

# Verify dist directory exists
if not os.path.exists(frontend_dist_path):
    raise RuntimeError(
        f"Frontend dist directory not found at {frontend_dist_path}.\n"
        "Please run: cd frontend && npm run build"
    )

app.mount("/", StaticFiles(directory=frontend_dist_path, html=True), name="static")
