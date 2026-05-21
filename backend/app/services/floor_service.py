from __future__ import annotations

from typing import Any
from uuid import uuid4

from ..core.time import now_ts


class FloorService:
    def list_floors(self, project: dict[str, Any]) -> list[dict[str, Any]]:
        return project.setdefault("floors", [])

    def find_floor_by_id(self, project: dict[str, Any], floor_id: str) -> dict[str, Any] | None:
        return next(
            (floor for floor in self.list_floors(project) if floor.get("id") == floor_id),
            None,
        )

    def find_floor_by_code(self, project: dict[str, Any], code: str) -> dict[str, Any] | None:
        return next(
            (floor for floor in self.list_floors(project) if floor.get("code") == code),
            None,
        )

    def find_floor_by_level(self, project: dict[str, Any], level: int) -> dict[str, Any] | None:
        return next(
            (floor for floor in self.list_floors(project) if floor.get("level") == level),
            None,
        )

    def create_floor(
        self,
        project: dict[str, Any],
        *,
        label: str,
        code: str,
        level: int,
        elevation: float = 0,
        visible: bool = True,
        sort_order: int | None = None,
    ) -> dict[str, Any]:
        floors = self.list_floors(project)

        floor = {
            "id": f"floor-{uuid4().hex[:8]}",
            "label": label,
            "code": code,
            "level": level,
            "elevation": elevation,
            "visible": visible,
            "sortOrder": len(floors) if sort_order is None else sort_order,
        }

        floors.append(floor)
        project["updatedAt"] = now_ts()
        return floor

    def update_floor(
        self,
        project: dict[str, Any],
        floor_id: str,
        *,
        label: str,
        code: str,
        level: int,
        elevation: float = 0,
        visible: bool = True,
        sort_order: int = 0,
    ) -> bool:
        floor = self.find_floor_by_id(project, floor_id)
        if floor is None:
            return False
        floor["label"] = label
        floor["code"] = code
        floor["level"] = level
        floor["elevation"] = elevation
        floor["visible"] = visible
        floor["sortOrder"] = sort_order
        project["updatedAt"] = now_ts()
        return True

    def delete_floor(self, project: dict[str, Any], floor_id: str) -> bool:
        floors = self.list_floors(project)
        original = len(floors)
        project["floors"] = [floor for floor in floors if floor.get("id") != floor_id]
        deleted = len(project["floors"]) != original
        if deleted:
            project["updatedAt"] = now_ts()
        return deleted

    def get_or_create_floor(
        self,
        project: dict[str, Any],
        *,
        floor_id: str | None = None,
        code: str | None = None,
        label: str | None = None,
        level: int | None = None,
    ) -> dict[str, Any]:
        if floor_id:
            floor = self.find_floor_by_id(project, floor_id)
            if floor:
                return floor

        if code:
            floor = self.find_floor_by_code(project, code)
            if floor:
                return floor

        if level is not None:
            floor = self.find_floor_by_level(project, level)
            if floor:
                return floor

        return self.create_floor(
            project,
            label=label or code or f"Floor {level or 1}",
            code=code or f"F{level or 1}",
            level=level or 1,
        )

