from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ...domain.capsule import Capsule
from ...domain.enums import AgentMode, Engine, TaskStatus, TaskType, ValidationMode
from ...domain.ledger import LedgerEvent
from ...domain.review import ReviewItem
from ...domain.task import Criterion, Task, ValidationCommand, WorkflowStep
from ...integrations.blender.skills import list_skills
from ...checks.validation import list_validation_results, run_validation, suggest_validation
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
    validation_mode: ValidationMode | None = None
    role_id: str | None = None


class WorkflowStepRequest(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    prompt: str = ""


class WorkflowStepUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    prompt: str | None = None
    status: str | None = None


class ValidationCommandRequest(BaseModel):
    label: str = Field(min_length=1, max_length=80)
    command: str = Field(min_length=1, max_length=1000)
    timeout: int = Field(default=300, ge=30, le=7200)


class RunValidationRequest(BaseModel):
    command_id: str | None = None
    run_id: str | None = None


class ValidationSuggestion(BaseModel):
    label: str
    command: str
    source: str = ""


class ValidationResult(BaseModel):
    id: str
    task_id: str
    command_id: str
    label: str
    command: str
    status: str
    exit_code: int | None = None
    duration_ms: int = 0
    output: str = ""
    error: str = ""
    log_path: str = ""
    created_at: str = ""
    agent_run_id: str = ""
    agent_session_id: str = ""
    agent_run_status: str = ""


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


@router.post("/{task_id}/workflow", response_model=Task, status_code=201)
def add_workflow_step(
    task_id: str,
    payload: WorkflowStepRequest,
    hub: Path = Depends(require_hub),
) -> Task:
    task = get_task(hub, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")
    task.workflow.append(WorkflowStep(title=payload.title, prompt=payload.prompt))
    return save_task(hub, task)


@router.patch("/{task_id}/workflow/{step_id}", response_model=Task)
def update_workflow_step(
    task_id: str,
    step_id: str,
    payload: WorkflowStepUpdate,
    hub: Path = Depends(require_hub),
) -> Task:
    task = get_task(hub, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")
    step = next((item for item in task.workflow if item.id == step_id), None)
    if step is None:
        raise HTTPException(status_code=404, detail="step not found")
    if payload.title is not None:
        step.title = payload.title
    if payload.prompt is not None:
        step.prompt = payload.prompt
    if payload.status is not None:
        if payload.status not in {"pending", "active", "done", "failed", "skipped"}:
            raise HTTPException(status_code=400, detail="invalid step status")
        step.status = payload.status
    return save_task(hub, task)


@router.delete("/{task_id}/workflow/{step_id}", response_model=Task)
def delete_workflow_step(
    task_id: str,
    step_id: str,
    hub: Path = Depends(require_hub),
) -> Task:
    task = get_task(hub, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")
    remaining = [item for item in task.workflow if item.id != step_id]
    if len(remaining) == len(task.workflow):
        raise HTTPException(status_code=404, detail="step not found")
    task.workflow = remaining
    return save_task(hub, task)


@router.post("/{task_id}/validation", response_model=Task, status_code=201)
def add_validation_command(
    task_id: str,
    payload: ValidationCommandRequest,
    hub: Path = Depends(require_hub),
) -> Task:
    task = get_task(hub, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")
    task.validation.append(
        ValidationCommand(
            label=payload.label.strip(),
            command=payload.command.strip(),
            timeout=payload.timeout,
        )
    )
    saved = save_task(hub, task)
    append_event(
        hub,
        LedgerEvent(
            type="task.validation.added",
            subject=task.id,
            data={"label": payload.label},
        ),
    )
    return saved


@router.delete("/{task_id}/validation/{command_id}", response_model=Task)
def delete_validation_command(
    task_id: str,
    command_id: str,
    hub: Path = Depends(require_hub),
) -> Task:
    task = get_task(hub, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")
    task.validation = [item for item in task.validation if item.id != command_id]
    saved = save_task(hub, task)
    append_event(
        hub,
        LedgerEvent(
            type="task.validation.deleted",
            subject=task.id,
            data={"command_id": command_id},
        ),
    )
    return saved


@router.get(
    "/{task_id}/validation/suggestions",
    response_model=list[ValidationSuggestion],
)
def get_validation_suggestions(
    task_id: str,
    hub: Path = Depends(require_hub),
) -> list[ValidationSuggestion]:
    if get_task(hub, task_id) is None:
        raise HTTPException(status_code=404, detail="task not found")
    return [ValidationSuggestion(**row) for row in suggest_validation(hub)]


@router.get("/{task_id}/validation/results", response_model=list[ValidationResult])
def get_validation_results(
    task_id: str,
    hub: Path = Depends(require_hub),
) -> list[ValidationResult]:
    if get_task(hub, task_id) is None:
        raise HTTPException(status_code=404, detail="task not found")
    return [ValidationResult(**row) for row in list_validation_results(hub, task_id)]


@router.post("/{task_id}/validation/run", response_model=list[ValidationResult])
def run_validation_route(
    task_id: str,
    payload: RunValidationRequest,
    hub: Path = Depends(require_hub),
) -> list[ValidationResult]:
    task = get_task(hub, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")
    try:
        results = run_validation(hub, task, payload.command_id, payload.run_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return [ValidationResult(**row) for row in results]


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
