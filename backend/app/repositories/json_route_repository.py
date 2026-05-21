from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any


class JsonRouteRepository:
    def __init__(self, routes_dir: Path):
        self.routes_dir = routes_dir

    async def save_route(self, filename: str, route_feature: dict[str, Any]) -> Path:
        def write() -> Path:
            self.routes_dir.mkdir(parents=True, exist_ok=True)
            full_path = self.routes_dir / filename
            temp_path = full_path.with_suffix(".tmp")
            with temp_path.open("w", encoding="utf-8") as file:
                json.dump(route_feature, file, ensure_ascii=False, indent=2)
            temp_path.replace(full_path)
            return full_path

        return await asyncio.to_thread(write)

