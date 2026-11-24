from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ...domain.enums import Engine
from ...domain.project import Project
from ...storage.projects import (
    clear_active_hub,
    demo_project,
    load_project,
    open_project,
    read_active_hub,
)
from ...storage.registry import register

router = APIRouter(prefix="/project", tags=["project"])


class OpenProjectRequest(BaseModel):
    path: str
    name: str | None = None
    engine: Engine | None = None


class ProjectResponse(BaseModel):
    project: Project
    path: str


def _response(project: Project, hub: Path) -> ProjectResponse:
    return ProjectResponse(project=project, path=str(hub.parent))


@router.get("", response_model=ProjectResponse)
def get_project() -> ProjectResponse:
    hub = read_active_hub()
    if hub is None:
        raise HTTPException(status_code=404, detail="no active project")
    return _response(load_project(hub), hub)


@router.post("/open", response_model=ProjectResponse)
def open_project_route(payload: OpenProjectRequest) -> ProjectResponse:
    try:
        project, hub = open_project(Path(payload.path), payload.name, payload.engine)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    register(hub.parent, project.name, project.engine)
    return _response(project, hub)


@router.post("/demo", response_model=ProjectResponse)
def demo_project_route() -> ProjectResponse:
    project, hub = demo_project()
    register(hub.parent, project.name, project.engine)
    return _response(project, hub)


@router.post("/close", status_code=204)
def close_project() -> None:
    clear_active_hub()
