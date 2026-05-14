# Tutorial: Your First Safe Feature Change

Goal: add an `altitude` column to the frontend drone table and verify end-to-end web data flow (WebSocket payload to rendered UI).

Estimated time: 15-25 minutes.

## What You Will Learn

- Where telemetry enters and exits the backend
- How frontend state is populated from WebSocket events
- How to implement a low-risk UI enhancement
- How to validate a web change using browser devtools

## Step 1: Run the Stack

```bash
./run_dev.sh
```

Open `http://127.0.0.1:9002`.

Open browser devtools:
- Console tab for JS/runtime errors
- Network tab (including WS frames) for protocol verification

Expected result:
- Drone rows appear in the table
- Markers appear on map when drones are in viewport

## Step 2: Inspect Current Telemetry Handling

In `frontend/index.html`, find WebSocket message handling for `msg.type === 'telemetry'`.

Observe:
- `lat`, `lon`, and `battery` are read from payload
- these fields are stored in `droneState[id]`
- telemetry arrives via WebSocket message frames from `/ws/frontend`

## Step 3: Add Altitude to State

In telemetry handler, store altitude:

```js
const alt = p.alt;
droneState[id].alt = alt;
```

## Step 4: Add Altitude Table Column

1. Add a new `Alt` header cell in the table head.
2. In row rendering, format altitude with fallback:

```js
const alt = (state.alt !== undefined) ? Number(state.alt).toFixed(1) : '-';
```

3. Render `${alt}` into the new column.

## Step 5: Verify Behavior

1. Refresh browser.
2. Confirm each connected drone row now shows altitude.
3. Click map and send command; verify nothing regressed.
4. In WS frames, verify `alt` is present in telemetry payloads.
5. Confirm Console has no new errors.

## Step 6: Validate Regression Surface

Check these flows still work:
- Drone connect/disconnect events
- Marker updates while panning/zooming
- Command dispatch alert and backend response handling
- Table remains readable on narrow viewport widths
- Keyboard can still reach interactive command button in popup

## Outcome

You completed a full, low-risk feature cycle by extending an existing telemetry field from payload to UI.

Next tutorials:
- Add selected-drone command targeting
- Add backend payload validation with typed models
