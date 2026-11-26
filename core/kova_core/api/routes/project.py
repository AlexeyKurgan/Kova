from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ...domain.enums import Engine, IsolationMode
from ...domain.project import Project
from ...storage.projects import (
    clear_active_hub,
    demo_project,
    load_project,
    open_project,
    read_active_hub,
    save_project,
)
from ...storage.registry import register

router = APIRouter(prefix="/project", tags=["project"])


class OpenProjectRequest(BaseModel):
    path: str
    name: str | None = None
    engine: Engine | None = None


class UpdateProjectRequest(BaseModel):
    max_parallel_runs: int | None = Field(default=None, ge=1, le=4)
    isolation: IsolationMode | None = None
    token_budget: int | None = Field(default=None, ge=0, le=100_000_000)
    local_only: bool | None = None
    egress_guard: bool | None = None
    remote_consents: list[str] | None = None


class ProjectResponse(BaseModel):
    project: Project
    path: str
    git_repo: bool = False


def _response(project: Project, hub: Path) -> ProjectResponse:
    from ...agents.worktrees import is_git_repo

    return ProjectResponse(
        project=project,
        path=str(hub.parent),
        git_repo=is_git_repo(hub.parent),
    )


@router.get("", response_model=ProjectResponse)
def get_project() -> ProjectResponse:
    hub = read_active_hub()
    if hub is None:
        raise HTTPException(status_code=404, detail="no active project")
    return _response(load_project(hub), hub)


@router.patch("", response_model=ProjectResponse)
def update_project_route(payload: UpdateProjectRequest) -> ProjectResponse:
    hub = read_active_hub()
    if hub is None:
        raise HTTPException(status_code=404, detail="no active project")
    project = load_project(hub)
    if payload.max_parallel_runs is not None:
        project.max_parallel_runs = payload.max_parallel_runs
    if payload.isolation is not None:
        project.isolation = payload.isolation
    if payload.token_budget is not None:
        project.token_budget = payload.token_budget
    if payload.local_only is not None:
        project.local_only = payload.local_only
    if payload.egress_guard is not None:
        project.egress_guard = payload.egress_guard
    if payload.remote_consents is not None:
        project.remote_consents = list(
            dict.fromkeys(
                str(item).strip()
                for item in payload.remote_consents
                if str(item).strip()
            )
        )[:50]
    save_project(hub, project)
    return _response(project, hub)


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
