from datetime import timedelta
from pathlib import Path

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from ...domain.common import utc_now
from ...storage.ledger import list_events
from ...storage.summary import project_stats
from ..deps import require_hub

router = APIRouter(tags=["summary"])


class DiaryDay(BaseModel):
    date: str
    events: int
    tasks_created: int
    tasks_done: int
    assets: int
    reviews: int
    snapshots: int
    highlights: list[str]


class DiaryResponse(BaseModel):
    days: list[DiaryDay]
    totals: dict[str, int]


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


@router.get("/diary", response_model=DiaryResponse)
def get_diary(
    days: int = Query(default=14, ge=1, le=90),
    hub: Path = Depends(require_hub),
) -> DiaryResponse:
    events = list_events(hub, limit=4000)
    buckets: dict[str, DiaryDay] = {}
    today = max((event.at.date() for event in events), default=None)
    if today is None:
        today = utc_now().date()

    for offset in range(days):
        date = today - timedelta(days=offset)
        buckets[date.isoformat()] = DiaryDay(date=date.isoformat(), events=0, tasks_created=0, tasks_done=0, assets=0, reviews=0, snapshots=0, highlights=[])

    for event in events:
        key = event.at.date().isoformat()
        bucket = buckets.get(key)
        if bucket is None:
            continue
        bucket.events += 1
        if event.type == "task.created":
            bucket.tasks_created += 1
        elif event.type == "task.status" and event.data.get("to") == "done":
            bucket.tasks_done += 1
        elif event.type == "asset.imported":
            bucket.assets += 1
        elif event.type == "review.accepted":
            bucket.reviews += 1
        elif event.type == "snapshot.created":
            bucket.snapshots += 1
        if event.type not in bucket.highlights:
            bucket.highlights.append(event.type)

    ordered = [buckets[(today - timedelta(days=offset)).isoformat()] for offset in range(days)]
    totals = {
        "events": sum(day.events for day in ordered),
        "tasks_created": sum(day.tasks_created for day in ordered),
        "tasks_done": sum(day.tasks_done for day in ordered),
        "assets": sum(day.assets for day in ordered),
        "reviews": sum(day.reviews for day in ordered),
        "snapshots": sum(day.snapshots for day in ordered),
    }
    return DiaryResponse(days=ordered, totals=totals)
