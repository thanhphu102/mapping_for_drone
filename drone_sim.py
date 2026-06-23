#!/usr/bin/env python3
import asyncio
import websockets
import json
import argparse
import random
import math


async def run_drone(
    drone_id: str,
    host: str,
    port: int,
    interval: float = 1.0,
    start_lat: float | None = None,
    start_lon: float | None = None,
    start_alt: float = 10.0,
    drift: float = 0.0,
):
    uri = f"ws://{host}:{port}/ws/drone/{drone_id}"
    print(f"Connecting {drone_id} -> {uri}")
    try:
        async with websockets.connect(uri) as ws:
            # Spawn at the requested coordinates, otherwise a random default location.
            lat = start_lat if start_lat is not None else 37.0 + random.uniform(-0.01, 0.01)
            lon = start_lon if start_lon is not None else -122.0 + random.uniform(-0.01, 0.01)
            alt = start_alt
            target = None

            async def sender():
                nonlocal lat, lon, alt
                while True:
                    # Optional random walk so a stationary drone still looks "alive".
                    if drift and not target:
                        lat += random.uniform(-drift, drift)
                        lon += random.uniform(-drift, drift)
                    payload = {"lat": lat, "lon": lon, "alt": alt, "battery": round(random.uniform(80, 100),1)}
                    await ws.send(json.dumps(payload))
                    await asyncio.sleep(interval)

            async def receiver():
                nonlocal target, lat, lon
                async for msg in ws:
                    try:
                        m = json.loads(msg)
                    except Exception:
                        m = {"raw": msg}
                    if isinstance(m, dict) and m.get("type") == "command":
                        target = m.get("target")
                        print(f"{drone_id} received command: {target}")

            async def navigator():
                nonlocal lat, lon, target
                while True:
                    if target and isinstance(target, dict):
                        tlat = float(target.get('lat', lat))
                        tlon = float(target.get('lon', lon))
                        # move a fraction toward target each tick
                        lat += (tlat - lat) * 0.2
                        lon += (tlon - lon) * 0.2
                        # if close, clear target
                        if abs(lat - tlat) < 0.00001 and abs(lon - tlon) < 0.00001:
                            target = None
                    await asyncio.sleep(interval/2)

            await asyncio.gather(sender(), receiver(), navigator())
    except Exception as e:
        print('drone client error', e)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--id', '-i', default='drone1')
    p.add_argument('--host', default='localhost')
    p.add_argument('--port', type=int, default=8000)
    p.add_argument('--interval', type=float, default=1.0, help='Telemetry send interval (seconds)')
    p.add_argument('--lat', type=float, default=None, help='Initial latitude (e.g. inside a no-fly zone)')
    p.add_argument('--lon', type=float, default=None, help='Initial longitude')
    p.add_argument('--alt', type=float, default=10.0, help='Initial altitude (meters)')
    p.add_argument('--drift', type=float, default=0.0, help='Random walk magnitude in degrees per tick (0 = stationary)')
    args = p.parse_args()
    asyncio.run(run_drone(
        args.id, args.host, args.port, args.interval,
        start_lat=args.lat, start_lon=args.lon, start_alt=args.alt, drift=args.drift,
    ))


if __name__ == '__main__':
    main()
