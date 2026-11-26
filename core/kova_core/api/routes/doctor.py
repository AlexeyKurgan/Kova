from pathlib import Path

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ...checks.doctor import run_doctor
from ...domain.check import CheckResult
from ...storage.hub import HUB_STRUCTURE
from ..deps import require_hub

router = APIRouter(tags=["doctor"])


class DoctorRepairResponse(BaseModel):
    actions: list[str]
    checks: list[CheckResult]


@router.get("/doctor", response_model=list[CheckResult])
def get_doctor(hub: Path = Depends(require_hub)) -> list[CheckResult]:
    return run_doctor(hub)


@router.post("/doctor/repair", response_model=DoctorRepairResponse)
def repair_doctor(hub: Path = Depends(require_hub)) -> DoctorRepairResponse:
    actions: list[str] = []

    for relative in HUB_STRUCTURE:
        target = hub / relative
        if not target.is_dir():
            target.mkdir(parents=True, exist_ok=True)
            actions.append(f"Создана папка: {relative}")

    for relative in ("decisions/decisions.jsonl", "ledger/events.jsonl"):
        target = hub / relative
        if not target.is_file():
            target.parent.mkdir(parents=True, exist_ok=True)
            target.touch()
            actions.append(f"Создан журнал: {relative}")

    index = hub / "snapshots" / "index.json"
    if not index.is_file():
        index.parent.mkdir(parents=True, exist_ok=True)
        index.write_text("{}\n", encoding="utf-8")
        actions.append("Создан индекс снапшотов")

    if not (hub / "project.json").is_file():
        actions.append(
            "project.json отсутствует — восстанови его из Git или снапшота, автоматически создавать его небезопасно"
        )

    if not actions:
        actions.append("Структура .hub уже в порядке — исправлять нечего")

    return DoctorRepairResponse(actions=actions, checks=run_doctor(hub))
