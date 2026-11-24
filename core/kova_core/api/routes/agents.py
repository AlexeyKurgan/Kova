from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from ...agents.providers import get_provider
from ...agents import routing
from ...agents.retention import cleanup
from ...agents.runner import (
    apply_worktree_run,
    cancel_run,
    decide_approval,
    get_run,
    list_runs,
    preview_handoff,
    reconcile_runs,
    start_run,
)
from ...agents.sessions import get_session, list_sessions
from ...security.paths import resolve_inside
from ...storage.tasks import get_task
from ..deps import require_hub

router = APIRouter(prefix="/ai", tags=["agents"])


class HandoffPreviewRequest(BaseModel):
    task_id: str
    from_session_id: str
    to_provider: str


class HandoffPreview(BaseModel):
    id: str = ""
    from_session_id: str = ""
    from_provider_id: str = ""
    from_provider_name: str = ""
    from_session_status: str = ""
    from_run_id: str = ""
    from_run_status: str = ""
    snapshot_id: str = ""
    to_provider_id: str = ""
    to_provider_name: str = ""
    summary: str = ""
    created_at: str = ""
    text: str = ""


class CleanupRequest(BaseModel):
    keep: int = 50


class StartRunRequest(BaseModel):
    task_id: str
    provider: str | None = None
    snapshot: bool = True
    message: str = ""
    model: str | None = None
    handoff_from_session: str | None = None
    read_only: bool = False
    workflow_step_id: str = ""
    role_id: str = ""
    tool_policy: str = "workspace"


class RoutingRule(BaseModel):
    id: str = ""
    tag: str
    provider_id: str


class AgentRole(BaseModel):
    id: str = ""
    name: str
    prompt: str = ""
    provider_id: str = ""


class RoutingPayload(BaseModel):
    rules: list[RoutingRule] = Field(default_factory=list)
    roles: list[AgentRole] = Field(default_factory=list)


class ApprovalRequest(BaseModel):
    decision: str


class ResumeRunRequest(BaseModel):
    message: str = ""
    model: str | None = None
    snapshot: bool = True
    read_only: bool = False


class FileChange(BaseModel):
    path: str
    status: str
    size: int = 0
    previous_size: int = 0
    patch_path: str = ""
    binary: bool = False
    patch_truncated: bool = False
    additions: int = 0
    deletions: int = 0


class RunInfo(BaseModel):
    id: str
    task_id: str
    task_title: str = ""
    session_id: str = ""
    provider_id: str = ""
    provider_name: str = ""
    status: str = "queued"
    created_at: str = ""
    started_at: str = ""
    finished_at: str = ""
    exit_code: int | None = None
    output: str = ""
    error: str = ""
    log_path: str = ""
    artifact_path: str = ""
    review_id: str = ""
    snapshot_id: str = ""
    snapshot_error: str = ""
    command: str = ""
    args: list[str] = Field(default_factory=list)
    cancel_requested: bool = False
    pid: int | None = None
    interrupted_reason: str = ""
    model: str = ""
    handoff_id: str = ""
    changes: list[FileChange] = Field(default_factory=list)
    changes_total: int = 0
    changes_truncated: bool = False
    changes_error: str = ""
    queue_position: int = 0
    max_parallel_runs: int = 0
    isolation: str = "direct"
    worktree_path: str = ""
    worktree_applied_at: str = ""
    worktree_applied: int = 0
    worktree_deleted: int = 0
    read_only: bool = False
    resumed: bool = False
    resumed_from_session: str = ""
    resumed_from_run: str = ""
    workflow_step_id: str = ""
    role_id: str = ""
    role_name: str = ""
    tool_policy: str = ""
    approval: dict | None = None
    auto_approve: bool = False
    cli_session_id: str = ""
    usage: dict | None = None
    actions: list[dict] = Field(default_factory=list)


class SessionInfo(BaseModel):
    id: str
    task_id: str
    task_title: str = ""
    provider_id: str = ""
    provider_name: str = ""
    status: str = "active"
    created_at: str = ""
    updated_at: str = ""
    finished_at: str = ""
    snapshot_before: str = ""
    handoff_id: str = ""
    cli_session_id: str = ""
    run_ids: list[str] = Field(default_factory=list)
    runs: list[RunInfo] = Field(default_factory=list)


@router.post("/handoffs/preview", response_model=HandoffPreview)
def preview_handoff_route(
    payload: HandoffPreviewRequest,
    hub: Path = Depends(require_hub),
) -> HandoffPreview:
    try:
        record = preview_handoff(
            hub,
            payload.task_id,
            payload.from_session_id,
            payload.to_provider,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return HandoffPreview(**record)


@router.post("/runs/{run_id}/approval", response_model=RunInfo)
def approval_route(
    run_id: str,
    payload: ApprovalRequest,
    hub: Path = Depends(require_hub),
) -> dict:
    if payload.decision not in {"allow", "deny", "allow_all"}:
        raise HTTPException(status_code=400, detail="invalid decision")
    try:
        record = decide_approval(hub, run_id, payload.decision)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if record is None:
        raise HTTPException(status_code=404, detail="run not found")
    return record


@router.post("/sessions/{session_id}/resume", response_model=RunInfo, status_code=201)
def resume_session_route(
    session_id: str,
    payload: ResumeRunRequest,
    hub: Path = Depends(require_hub),
) -> RunInfo:
    from ...agents.sessions import get_session

    source = get_session(hub, session_id)
    if source is None:
        raise HTTPException(status_code=404, detail="сессия не найдена")
    try:
        record = start_run(
            hub,
            str(source.get("task_id") or ""),
            str(source.get("provider_id") or ""),
            payload.snapshot,
            payload.message,
            payload.model,
            None,
            payload.read_only,
            session_id,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return RunInfo(**record)


@router.post("/runs/{run_id}/apply-worktree", response_model=RunInfo)
def apply_worktree_route(run_id: str, hub: Path = Depends(require_hub)) -> dict:
    try:
        return apply_worktree_run(hub, run_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/routing", response_model=RoutingPayload)
def get_routing() -> RoutingPayload:
    data = routing.load()
    return RoutingPayload(
        rules=[RoutingRule(**row) for row in data["rules"]],
        roles=[AgentRole(**row) for row in data["roles"]],
    )


@router.put("/routing", response_model=RoutingPayload)
def save_routing(payload: RoutingPayload) -> RoutingPayload:
    data = routing.save(
        routing.normalize_rules([row.model_dump() for row in payload.rules]),
        routing.normalize_roles([row.model_dump() for row in payload.roles]),
    )
    return RoutingPayload(
        rules=[RoutingRule(**row) for row in data["rules"]],
        roles=[AgentRole(**row) for row in data["roles"]],
    )


@router.get("/routing/recommend")
def recommend_route(task_id: str, hub: Path = Depends(require_hub)) -> dict:
    from ...agents.providers import list_providers
    from ...storage.tasks import get_task

    task = get_task(hub, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")
    providers, _default = list_providers()
    return routing.recommend(task, providers)


@router.get("/usage")
def usage_route(hub: Path = Depends(require_hub)) -> dict:
    from ...agents.usage import usage_summary
    from ...storage.projects import load_project

    project = load_project(hub)
    return usage_summary(hub, int(project.token_budget or 0))


@router.post("/cleanup")
def cleanup_history(
    payload: CleanupRequest,
    hub: Path = Depends(require_hub),
) -> dict[str, int]:
    return cleanup(hub, payload.keep)


@router.post("/runs", response_model=RunInfo, status_code=201)
def start_run_route(
    payload: StartRunRequest,
    hub: Path = Depends(require_hub),
) -> RunInfo:
    if get_task(hub, payload.task_id) is None:
        raise HTTPException(status_code=404, detail="task not found")
    provider = get_provider(payload.provider)
    if provider is None:
        raise HTTPException(status_code=404, detail="AI-провайдер не найден")
    running = [
        run
        for run in list_runs(hub, payload.task_id, limit=20)
        if run.get("status") in {"queued", "running"}
    ]
    if running:
        raise HTTPException(status_code=409, detail="для задачи уже выполняется AI-запуск")

    try:
        record = start_run(
            hub,
            payload.task_id,
            payload.provider,
            payload.snapshot,
            payload.message,
            payload.model,
            payload.handoff_from_session,
            payload.read_only,
            None,
            payload.workflow_step_id,
            payload.role_id,
            payload.tool_policy,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return RunInfo(**record)


def _session_info(hub: Path, row: dict) -> SessionInfo:
    rows = [
        RunInfo(**run)
        for run in list_runs(hub, str(row.get("task_id") or ""), limit=200)
        if run.get("session_id") == row.get("id")
    ]
    rows.sort(key=lambda run: run.started_at or run.created_at)
    return SessionInfo(**{**row, "runs": rows})


@router.get("/sessions", response_model=list[SessionInfo])
def get_sessions(
    task_id: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    hub: Path = Depends(require_hub),
) -> list[SessionInfo]:
    reconcile_runs(hub)
    return [_session_info(hub, row) for row in list_sessions(hub, task_id)[:limit]]


@router.get("/sessions/{session_id}", response_model=SessionInfo)
def get_session_route(session_id: str, hub: Path = Depends(require_hub)) -> SessionInfo:
    reconcile_runs(hub)
    row = get_session(hub, session_id)
    if row is None:
        raise HTTPException(status_code=404, detail="session not found")
    return _session_info(hub, row)


@router.get("/runs", response_model=list[RunInfo])
def get_runs(
    task_id: str | None = Query(default=None),
    limit: int = Query(default=30, ge=1, le=200),
    hub: Path = Depends(require_hub),
) -> list[RunInfo]:
    return [RunInfo(**row) for row in list_runs(hub, task_id, limit)]


@router.get("/runs/{run_id}", response_model=RunInfo)
def get_run_route(run_id: str, hub: Path = Depends(require_hub)) -> RunInfo:
    record = get_run(hub, run_id)
    if record is None:
        raise HTTPException(status_code=404, detail="run not found")
    return RunInfo(**record)


@router.get("/runs/{run_id}/changes/{index}")
def get_run_change_patch(
    run_id: str,
    index: int,
    hub: Path = Depends(require_hub),
) -> FileResponse:
    record = get_run(hub, run_id)
    if record is None:
        raise HTTPException(status_code=404, detail="run not found")
    changes = record.get("changes") or []
    if index < 0 or index >= len(changes):
        raise HTTPException(status_code=404, detail="change not found")
    patch_path = str(changes[index].get("patch_path") or "")
    if not patch_path:
        raise HTTPException(status_code=404, detail="patch not found")
    try:
        path = resolve_inside(hub, Path(patch_path))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="patch not found") from exc
    if not path.is_file():
        raise HTTPException(status_code=404, detail="patch not found")
    return FileResponse(
        path,
        media_type="text/plain; charset=utf-8",
        headers={"Cache-Control": "no-store"},
    )


@router.post("/runs/{run_id}/cancel", response_model=RunInfo)
def cancel_run_route(run_id: str, hub: Path = Depends(require_hub)) -> RunInfo:
    record = cancel_run(hub, run_id)
    if record is None:
        raise HTTPException(status_code=404, detail="run not found")
    return RunInfo(**record)
