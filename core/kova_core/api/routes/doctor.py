from pathlib import Path

from fastapi import APIRouter, Depends

from ...checks.doctor import run_doctor
from ...domain.check import CheckResult
from ..deps import require_hub

router = APIRouter(tags=["doctor"])


@router.get("/doctor", response_model=list[CheckResult])
def get_doctor(hub: Path = Depends(require_hub)) -> list[CheckResult]:
    return run_doctor(hub)
