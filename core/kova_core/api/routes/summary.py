from pathlib import Path

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ...storage.summary import project_stats
from ..deps import require_hub

router = APIRouter(tags=["summary"])


class ProjectStats(BaseModel):
    assets_total: int
    assets_review: int
    assets_accepted: int
    assets_problems: int
    tasks_total: int
    tasks_active: int
    tasks_review: int
    tasks_done: int


@router.get("/stats", response_model=ProjectStats)
def get_stats(hub: Path = Depends(require_hub)) -> ProjectStats:
    return ProjectStats(**project_stats(hub))
