from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from ...agents.providers import get_provider
from ...agents.runner import cancel_run, get_run, list_runs, start_run
from ...storage.tasks import get_task
from ..deps import require_hub

router = APIRouter(prefix="/ai", tags=["agents"])


class StartRunRequest(BaseModel):
    task_id: str
    provider: str | None = None
    snapshot: bool = True


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
        record = start_run(hub, payload.task_id, payload.provider, payload.snapshot)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return RunInfo(**record)


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


@router.post("/runs/{run_id}/cancel", response_model=RunInfo)
def cancel_run_route(run_id: str, hub: Path = Depends(require_hub)) -> RunInfo:
    record = cancel_run(hub, run_id)
    if record is None:
        raise HTTPException(status_code=404, detail="run not found")
    return RunInfo(**record)
