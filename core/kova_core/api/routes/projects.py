from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from ...domain.enums import Engine
from ...domain.ledger import LedgerEvent
from ...storage.ledger import append_event
from ...storage.registry import (
    cover_file,
    create_project,
    default_parent,
    delete_project,
    duplicate_project,
    get_project,
    list_projects,
    open_project_by_id,
    set_cover,
    update_project,
)

router = APIRouter(prefix="/projects", tags=["projects"])


class ProjectCard(BaseModel):
    id: str
    name: str
    engine: Engine
    path: str
    cover_url: str = ""
    active: bool = False
    exists: bool = True
    created_at: str = ""
    last_opened_at: str = ""
    updated_at: str = ""
    tasks_total: int = 0
    tasks_active: int = 0
    tasks_done: int = 0
    assets_total: int = 0


class ProjectsResponse(BaseModel):
    projects: list[ProjectCard]
    default_parent: str


class CreateProjectRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    engine: Engine = Engine.generic
    parent: str | None = None


class OpenProjectRequest(BaseModel):
    project: str


class UpdateProjectRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    engine: Engine | None = None


class DuplicateProjectRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    parent: str | None = None


class CoverRequest(BaseModel):
    path: str


@router.get("", response_model=ProjectsResponse)
def get_projects() -> ProjectsResponse:
    default_parent().mkdir(parents=True, exist_ok=True)
    rows = list_projects()
    return ProjectsResponse(
        projects=[ProjectCard(**row) for row in rows],
        default_parent=str(default_parent()),
    )


@router.post("", response_model=ProjectCard, status_code=201)
def create_project_route(payload: CreateProjectRequest) -> ProjectCard:
    parent = Path(payload.parent) if payload.parent else None
    try:
        row = create_project(payload.name, payload.engine, parent)
    except FileExistsError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    hub = Path(str(row["path"])) / ".hub"
    if hub.is_dir():
        append_event(
            hub,
            LedgerEvent(type="project.created", subject=str(row["id"]), data={"name": row["name"]}),
        )
    return ProjectCard(**row)


@router.post("/{project}/open", response_model=ProjectCard)
def open_project_route(project: str) -> ProjectCard:
    if get_project(project) is None:
        raise HTTPException(status_code=404, detail="project not found")
    row = open_project_by_id(project)
    if row is None:
        raise HTTPException(status_code=400, detail="папка проекта не найдена")
    return ProjectCard(**row)


@router.patch("/{project}", response_model=ProjectCard)
def update_project_route(project: str, payload: UpdateProjectRequest) -> ProjectCard:
    if get_project(project) is None:
        raise HTTPException(status_code=404, detail="project not found")
    row = update_project(project, payload.name, payload.engine)
    if row is None:
        raise HTTPException(status_code=400, detail="проект недоступен")
    return ProjectCard(**row)


@router.delete("/{project}", status_code=204)
def delete_project_route(
    project: str,
    delete_files: bool = Query(default=False),
) -> None:
    if get_project(project) is None:
        raise HTTPException(status_code=404, detail="project not found")
    try:
        delete_project(project, delete_files=delete_files)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/{project}/duplicate", response_model=ProjectCard, status_code=201)
def duplicate_project_route(project: str, payload: DuplicateProjectRequest) -> ProjectCard:
    if get_project(project) is None:
        raise HTTPException(status_code=404, detail="project not found")
    parent = Path(payload.parent) if payload.parent else None
    try:
        row = duplicate_project(project, payload.name, parent)
    except FileExistsError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if row is None:
        raise HTTPException(status_code=400, detail="папка проекта не найдена")
    return ProjectCard(**row)


@router.post("/{project}/cover", response_model=ProjectCard)
def set_cover_route(project: str, payload: CoverRequest) -> ProjectCard:
    if get_project(project) is None:
        raise HTTPException(status_code=404, detail="project not found")
    try:
        row = set_cover(project, Path(payload.path))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if row is None:
        raise HTTPException(status_code=400, detail="проект недоступен")
    return ProjectCard(**row)


@router.get("/{project}/cover")
def get_cover(project: str) -> FileResponse:
    path = cover_file(project)
    if path is None or not path.is_file():
        raise HTTPException(status_code=404, detail="cover not found")
    media = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
    }.get(path.suffix.lower(), "application/octet-stream")
    return FileResponse(path, media_type=media, headers={"Cache-Control": "no-store"})
