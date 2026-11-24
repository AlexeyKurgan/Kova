from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ...domain.capsule import Capsule
from ...domain.enums import AgentMode, Engine, TaskStatus, TaskType
from ...domain.ledger import LedgerEvent
from ...domain.review import ReviewItem
from ...domain.task import Criterion, Task
from ...integrations.blender.skills import list_skills
from ...storage.assets import get_asset, link_asset_task, unlink_task_from_assets
from ...storage.capsules import build_capsule, capsule_text, save_capsule
from ...storage.ledger import append_event
from ...storage.projects import load_project
from ...storage.responses import record_response
from ...storage.review import archive_for_task
from ...storage.tasks import (
    get_task,
    list_tasks,
    list_trash,
    purge_task,
    restore_task,
    save_task,
    soft_delete_task,
)
from ..deps import require_hub

router = APIRouter(prefix="/tasks", tags=["tasks"])


class CreateTaskRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    type: TaskType = TaskType.model
    engine: Engine = Engine.generic
    goal: str = ""
    criteria: list[str] = Field(default_factory=list)
    constraints: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    mode: AgentMode = AgentMode.clipboard
    assigned_agent: str | None = None
    skills: list[str] = Field(default_factory=list)
    asset_ids: list[str] = Field(default_factory=list)


class UpdateTaskRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    status: TaskStatus | None = None
    type: TaskType | None = None
    engine: Engine | None = None
    goal: str | None = None
    next_step: str | None = None
    criteria: list[str] | None = None
    constraints: list[str] | None = None
    tags: list[str] | None = None
    mode: AgentMode | None = None
    assigned_agent: str | None = None
    skills: list[str] | None = None


class CapsuleResponse(BaseModel):
    capsule: Capsule
    text: str


class ImportResponseRequest(BaseModel):
    text: str = Field(min_length=1)


class ImportResponseResult(BaseModel):
    task: Task
    review: ReviewItem
    artifact_path: str


def _validate_skills(names: list[str]) -> list[str]:
    known = {str(row["path"]) for row in list_skills()}
    unknown = [name for name in names if name not in known]
    if unknown:
        raise HTTPException(
            status_code=400,
            detail="unknown skill: " + ", ".join(unknown),
        )
    return list(dict.fromkeys(names))


@router.get("", response_model=list[Task])
def get_tasks(hub: Path = Depends(require_hub)) -> list[Task]:
    return list_tasks(hub)


@router.get("/trash", response_model=list[Task])
def get_trash(hub: Path = Depends(require_hub)) -> list[Task]:
    return list_trash(hub)


@router.post("", response_model=Task, status_code=201)
def create_task(payload: CreateTaskRequest, hub: Path = Depends(require_hub)) -> Task:
    task = Task(
        title=payload.title,
        type=payload.type,
        engine=payload.engine,
        goal=payload.goal,
        criteria=[Criterion(text=text) for text in payload.criteria],
        constraints=payload.constraints,
        tags=payload.tags,
        mode=payload.mode,
        assigned_agent=payload.assigned_agent,
        skills=_validate_skills(payload.skills),
        asset_ids=[],
    )
    for asset_id in dict.fromkeys(payload.asset_ids):
        asset = get_asset(hub, asset_id)
        if asset is None:
            raise HTTPException(status_code=400, detail=f"asset not found: {asset_id}")
        task.asset_ids.append(asset_id)
    saved = save_task(hub, task)
    for asset_id in saved.asset_ids:
        asset = get_asset(hub, asset_id)
        if asset is not None:
            link_asset_task(hub, asset, saved.id)
    append_event(
        hub,
        LedgerEvent(type="task.created", subject=saved.id, data={"title": saved.title}),
    )
    return saved


@router.patch("/{task_id}", response_model=Task)
def update_task(
    task_id: str,
    payload: UpdateTaskRequest,
    hub: Path = Depends(require_hub),
) -> Task:
    task = get_task(hub, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")

    updates = payload.model_dump(exclude_unset=True)
    if "criteria" in updates:
        updates["criteria"] = [Criterion(text=text) for text in updates["criteria"]]
    if "skills" in updates:
        updates["skills"] = _validate_skills(updates["skills"] or [])

    previous_status = task.status
    for key, value in updates.items():
        setattr(task, key, value)

    saved = save_task(hub, task)
    if saved.status is not previous_status:
        append_event(
            hub,
            LedgerEvent(
                type="task.status",
                subject=saved.id,
                data={"from": previous_status.value, "to": saved.status.value},
            ),
        )
    return saved


@router.delete("/{task_id}", status_code=204)
def delete_task_route(task_id: str, hub: Path = Depends(require_hub)) -> None:
    task = get_task(hub, task_id)
    if task is None or task.deleted_at is not None:
        raise HTTPException(status_code=404, detail="task not found")
    archive_for_task(hub, task_id)
    soft_delete_task(hub, task_id)
    append_event(
        hub,
        LedgerEvent(
            type="task.deleted",
            subject=task_id,
            data={"title": task.title, "recoverable": True},
        ),
    )


@router.post("/{task_id}/restore", response_model=Task)
def restore_task_route(task_id: str, hub: Path = Depends(require_hub)) -> Task:
    task = restore_task(hub, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="удалённая задача не найдена")
    append_event(
        hub,
        LedgerEvent(
            type="task.restored",
            subject=task.id,
            data={"title": task.title},
        ),
    )
    return task


@router.delete("/{task_id}/purge", status_code=204)
def purge_task_route(task_id: str, hub: Path = Depends(require_hub)) -> None:
    task = get_task(hub, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")
    unlink_task_from_assets(hub, task_id)
    purge_task(hub, task_id)
    append_event(
        hub,
        LedgerEvent(
            type="task.purged",
            subject=task_id,
            data={"title": task.title},
        ),
    )


@router.post("/{task_id}/capsule", response_model=CapsuleResponse)
def prepare_capsule(task_id: str, hub: Path = Depends(require_hub)) -> CapsuleResponse:
    task = get_task(hub, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")

    project = load_project(hub)
    capsule = build_capsule(task, project)
    text = capsule_text(capsule, task, project, hub)
    save_capsule(hub, capsule, text)
    append_event(
        hub,
        LedgerEvent(
            type="capsule.created",
            subject=task.id,
            data={"capsule_id": capsule.id},
        ),
    )
    return CapsuleResponse(capsule=capsule, text=text)


@router.post("/{task_id}/response", response_model=ImportResponseResult, status_code=201)
def import_response(
    task_id: str,
    payload: ImportResponseRequest,
    hub: Path = Depends(require_hub),
) -> ImportResponseResult:
    result = record_response(hub, task_id, payload.text)
    if result is None:
        raise HTTPException(status_code=404, detail="task not found")
    task, review, relative = result
    return ImportResponseResult(task=task, review=review, artifact_path=relative)
