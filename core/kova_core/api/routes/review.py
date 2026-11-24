from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ...domain.enums import ReviewStatus, TaskStatus
from ...domain.ledger import LedgerEvent
from ...domain.review import ReviewItem
from ...storage.artifacts import read_artifact
from ...storage.ledger import append_event
from ...storage.review import get_review, list_review, save_review
from ...storage.tasks import get_task, save_task
from ..deps import require_hub

router = APIRouter(prefix="/review", tags=["review"])


class ReviewText(BaseModel):
    text: str


@router.get("", response_model=list[ReviewItem])
def get_review_items(hub: Path = Depends(require_hub)) -> list[ReviewItem]:
    return [
        item
        for item in list_review(hub)
        if item.status in (ReviewStatus.pending, ReviewStatus.rework)
    ]


@router.get("/{review_id}/response", response_model=ReviewText)
def get_review_response(review_id: str, hub: Path = Depends(require_hub)) -> ReviewText:
    item = get_review(hub, review_id)
    if item is None:
        raise HTTPException(status_code=404, detail="review item not found")
    if not item.artifact_path:
        raise HTTPException(status_code=404, detail="no response artifact")
    return ReviewText(text=read_artifact(hub, item.artifact_path))


def _resolve(
    review_id: str,
    hub: Path,
    review_status: ReviewStatus,
    task_status: TaskStatus,
    event_type: str,
) -> ReviewItem:
    item = get_review(hub, review_id)
    if item is None:
        raise HTTPException(status_code=404, detail="review item not found")

    item.status = review_status
    saved = save_review(hub, item)

    task = get_task(hub, saved.task_id)
    if task is not None:
        task.status = task_status
        save_task(hub, task)

    append_event(
        hub,
        LedgerEvent(
            type=event_type,
            subject=saved.task_id,
            data={"review_id": saved.id},
        ),
    )
    return saved


@router.post("/{review_id}/accept", response_model=ReviewItem)
def accept_review(review_id: str, hub: Path = Depends(require_hub)) -> ReviewItem:
    return _resolve(
        review_id,
        hub,
        ReviewStatus.accepted,
        TaskStatus.done,
        "review.accepted",
    )


@router.post("/{review_id}/rework", response_model=ReviewItem)
def rework_review(review_id: str, hub: Path = Depends(require_hub)) -> ReviewItem:
    return _resolve(
        review_id,
        hub,
        ReviewStatus.rework,
        TaskStatus.working,
        "review.rework",
    )
