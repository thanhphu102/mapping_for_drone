from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any


def _ensure_project_feature_snapshots(project: dict[str, Any]) -> None:
    features = project.get("features")
    if not isinstance(features, list):
        project["features"] = []
        features = project["features"]

    published_features = project.get("publishedFeatures")
    if isinstance(published_features, list):
        return

    if project.get("status") == "published":
        project["publishedFeatures"] = json.loads(json.dumps(features))
    else:
        project["publishedFeatures"] = []


class JsonProjectRepository:
    def __init__(self, path: Path):
        self.path = path

    async def load_document(self) -> dict[str, Any]:
        def read() -> dict[str, Any]:
            if not self.path.exists():
                return {"projects": []}

            try:
                with self.path.open("r", encoding="utf-8") as file:
                    data = json.load(file)
            except (OSError, json.JSONDecodeError):
                return {"projects": []}

            if not isinstance(data, dict):
                return {"projects": []}

            if "projects" not in data or not isinstance(data["projects"], list):
                data["projects"] = []

            modified = False
            for project in data["projects"]:
                if not isinstance(project, dict):
                    continue
                if "layers" in project:
                    project.pop("layers", None)
                    modified = True
                features = project.get("features")
                if isinstance(features, list):
                    for feature in features:
                        if not isinstance(feature, dict):
                            continue
                        props = feature.get("properties")
                        if not isinstance(props, dict):
                            feature["properties"] = {}
                            props = feature["properties"]
                        if "floorId" not in props:
                            props["floorId"] = None
                            modified = True

            if modified:
                self.path.parent.mkdir(parents=True, exist_ok=True)
                temp_path = self.path.with_suffix(".tmp")
                with temp_path.open("w", encoding="utf-8") as file:
                    json.dump(data, file, ensure_ascii=False, indent=2)
                temp_path.replace(self.path)

            return data

        return await asyncio.to_thread(read)

    async def save_document(self, document: dict[str, Any]) -> None:
        def write() -> None:
            self.path.parent.mkdir(parents=True, exist_ok=True)

            temp_path = self.path.with_suffix(".tmp")
            with temp_path.open("w", encoding="utf-8") as file:
                json.dump(document, file, ensure_ascii=False, indent=2)

            temp_path.replace(self.path)

        await asyncio.to_thread(write)

    async def list_projects(self) -> list[dict[str, Any]]:
        document = await self.load_document()
        projects = document.get("projects", [])
        normalized_projects = [
            project for project in projects if isinstance(project, dict)
        ]
        for project in normalized_projects:
            _ensure_project_feature_snapshots(project)
        return normalized_projects

    async def get_project(self, project_id: str) -> dict[str, Any] | None:
        projects = await self.list_projects()
        return next(
            (project for project in projects if project.get("id") == project_id),
            None,
        )

    async def find_project_by_osm(
        self,
        osm_type: str,
        osm_id: int | str,
    ) -> dict[str, Any] | None:
        projects = await self.list_projects()
        osm_id_str = str(osm_id)

        return next(
            (
                project
                for project in projects
                if project.get("osmType") == osm_type
                and str(project.get("osmId")) == osm_id_str
            ),
            None,
        )

    async def replace_project(self, project: dict[str, Any]) -> dict[str, Any]:
        document = await self.load_document()
        projects = document.get("projects", [])

        project_id = project.get("id")
        replaced = False

        for index, existing in enumerate(projects):
            if isinstance(existing, dict) and existing.get("id") == project_id:
                projects[index] = project
                replaced = True
                break

        if not replaced:
            projects.append(project)

        document["projects"] = projects
        await self.save_document(document)

        return project

    async def delete_project(self, project_id: str) -> bool:
        document = await self.load_document()
        projects = document.get("projects", [])

        project_ids = {str(project_id)}
        changed = True
        while changed:
            changed = False
            for project in projects:
                if not isinstance(project, dict):
                    continue
                parent_id = project.get("parentProjectId")
                current_id = project.get("id")
                if parent_id in project_ids and current_id not in project_ids:
                    project_ids.add(str(current_id))
                    changed = True

        next_projects = [
            project
            for project in projects
            if not isinstance(project, dict)
            or str(project.get("id")) not in project_ids
        ]

        deleted = len(next_projects) != len(projects)

        if deleted:
            for project in next_projects:
                if not isinstance(project, dict):
                    continue
                features = project.get("features")
                if not isinstance(features, list):
                    continue
                for feature in features:
                    if not isinstance(feature, dict):
                        continue
                    props = feature.get("properties")
                    if not isinstance(props, dict):
                        continue
                    child_id = props.get("childProjectId")
                    if child_id and str(child_id) in project_ids:
                        props["childProjectId"] = None

            document["projects"] = next_projects
            await self.save_document(document)

        return deleted

