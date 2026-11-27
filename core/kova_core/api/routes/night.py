import re
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ...agents import night
from ...agents.providers import get_provider
from ...domain.night import NightShiftState
from ...storage.night import load_night, save_night
from ...storage.tasks import get_task
from ..deps import require_hub

router = APIRouter(prefix="/night", tags=["night"])


class NightConfigUpdate(BaseModel):
    enabled: bool | None = None
    start_at: str | None = None
    provider_id: str | None = None
    task_ids: list[str] | None = None
    max_tasks: int | None = Field(default=None, ge=1, le=20)
    stop_on_error: bool | None = None


class NightStartRequest(BaseModel):
    provider_id: str = ""
    task_ids: list[str] = Field(default_factory=list)


@router.get("", response_model=NightShiftState)
def get_night(hub: Path = Depends(require_hub)) -> NightShiftState:
    return load_night(hub)


@router.patch("", response_model=NightShiftState)
def update_night(
    payload: NightConfigUpdate,
    hub: Path = Depends(require_hub),
) -> NightShiftState:
    state = load_night(hub)
    updates = payload.model_dump(exclude_unset=True)
    config = state.config
    for key, value in updates.items():
        setattr(config, key, value)
    if config.start_at and not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", config.start_at):
        raise HTTPException(status_code=422, detail="start_at must be HH:MM")
    config.task_ids = [
        task_id for task_id in dict.fromkeys(config.task_ids) if get_task(hub, task_id) is not None
    ]
    config.max_tasks = max(1, min(20, config.max_tasks))
    save_night(hub, state)
    return state


@router.post("/start", response_model=NightShiftState)
def start_night(
    payload: NightStartRequest,
    hub: Path = Depends(require_hub),
) -> NightShiftState:
    if night.night_running():
        raise HTTPException(status_code=409, detail="night shift is already running")
    state = load_night(hub)
    if state.run is not None and state.run.status in {"queued", "running"}:
        raise HTTPException(status_code=409, detail="previous night shift is still running")

    provider_id = payload.provider_id or state.config.provider_id
    if get_provider(provider_id or None) is None:
        raise HTTPException(status_code=400, detail="AI-провайдер не настроен")

    task_ids = [
        task_id
        for task_id in dict.fromkeys(payload.task_ids or state.config.task_ids)
        if get_task(hub, task_id) is not None
    ][: state.config.max_tasks]
    if not task_ids:
        raise HTTPException(status_code=400, detail="queue is empty")

    night.begin_run(
        hub,
        provider_id,
        task_ids,
        state.config.stop_on_error,
    )
    return load_night(hub)


@router.post("/stop", response_model=NightShiftState)
def stop_night(hub: Path = Depends(require_hub)) -> NightShiftState:
    night.stop_night_shift()
    return load_night(hub)
