# How-to: Add and Modify Features Safely

This guide gives practical recipes for common maintainer tasks with a web-engineering checklist: protocol correctness, browser behavior, accessibility, and performance.

## Before You Change Anything

1. Start local stack with `./run_dev.sh`.
2. Open the app and confirm drones connect.
3. Keep one terminal watching backend logs.
4. Open browser devtools (Console + Network + WS frames).
5. Make one behavior change at a time and retest quickly.

## Recipe 1: Add a New Telemetry Field

Example: add `speed`.

1. Update simulator payload in `drone_sim.py` sender loop to include `speed`.
2. Ensure backend forwards it unchanged (already true in current implementation).
3. Update frontend telemetry handler in `frontend/index.html` to store `speed` in `droneState`.
4. Add a new table column for `speed` and render fallback `-` when missing.
5. Run multiple drones and verify values update without UI errors.
6. Confirm WS frames contain expected field and no parse errors appear in Console.

## Recipe 2: Add a New Command Type

Example: `hold_position`.

1. Extend command payload shape in frontend request body, such as `{ "type": "hold_position", ... }`.
2. Update backend `POST /command` logic to include that type in outbound WS message.
3. Update simulator receiver logic to branch by command `type`.
4. Keep backward compatibility: if `type` is missing, treat command as existing move-to-target.
5. Verify frontend receives `command_sent` event and simulator logs expected action.
6. Validate HTTP behavior in devtools: status code, payload shape, and response timing.

## Recipe 3: Target Selected Drones Instead of All

1. Add selection UI in frontend and derive selected ID list.
2. Send `drones: ["drone1", "drone2"]` to `POST /command`.
3. Keep `"all"` path available for mass command mode.
4. Confirm backend response `sent` only includes connected selected drones.
5. Ensure selection UI is keyboard operable and has visible focus styles.

## Recipe 4: Improve Validation in Backend

1. Create Pydantic models in `backend/main.py` (or a new module) for command and target schema.
2. Change `post_command(cmd: dict)` to typed model input.
3. Return clear `400` errors for invalid payloads.
4. Add a frontend error message path for non-2xx responses.
5. Document new error contract in the reference doc.

## Recipe 5: Add Basic Web Security Headers

1. Add middleware for security headers (at minimum: `X-Content-Type-Options: nosniff`).
2. If served over HTTPS in deployment, add strict transport policy at proxy tier.
3. Add a conservative `Content-Security-Policy` and verify map CDN/tile domains are allowed.
4. Retest frontend map/script loading to ensure no blocked resources.

## Recipe 6: Keep Frontend Performance Stable

1. Avoid DOM updates on every single WS event when batching is possible.
2. Prefer `requestAnimationFrame` for UI updates tied to visual changes.
3. Monitor frame smoothness while running 10+ simulated drones.
4. If table growth causes lag, move to row diffing or virtualization.

## Change Safety Checklist

- No uncaught frontend parse or render errors.
- Drone connect/disconnect still updates table and markers.
- Existing click-to-command flow still works.
- Multiple simulators still run concurrently.
- Restarting stack from `./run_dev.sh` still succeeds.
- No mixed-content or blocked-resource errors in browser console.
- New UI controls are keyboard accessible.
- WS and HTTP payloads match documented contract.
- Performance remains acceptable under target drone count.

## Troubleshooting

- No drones in UI:
  - Verify simulator host/port match backend.
  - Check browser devtools for WebSocket errors.
- Command not delivered:
  - Inspect backend `sent` list in response/event.
  - Ensure drone ID in request is currently connected.
- Port already in use:
  - Rerun `./run_dev.sh` (it cleans old processes).
- Map does not render:
  - Check CDN script/style loading status.
  - Verify tile requests to OpenStreetMap are not blocked.
- Keyboard cannot trigger command flow:
  - Ensure interactive elements are real buttons/inputs and focusable.
