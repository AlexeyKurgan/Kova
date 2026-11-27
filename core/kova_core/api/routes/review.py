from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ...domain.enums import ReviewStatus, TaskStatus
from ...domain.ledger import LedgerEvent
from ...domain.review import ReviewComment, ReviewItem
from ...storage.artifacts import read_artifact
from ...storage.ledger import append_event
from ...storage.review import (
    delete_review_comment,
    get_review,
    get_review_comment,
    list_review,
    list_review_comments,
    save_review,
    save_review_comment,
)
from ...storage.tasks import get_task, save_task
from ...storage.assets import get_asset, list_assets
from ..deps import require_hub

router = APIRouter(prefix="/review", tags=["review"])


class ReviewText(BaseModel):
    text: str


def _plural(value: int, one: str, few: str, many: str) -> str:
    mod10 = value % 10
    mod100 = value % 100
    if mod10 == 1 and mod100 != 11:
        return one
    if 2 <= mod10 <= 4 and not 10 <= mod100 < 20:
        return few
    return many


class ReviewCommentCreate(BaseModel):
    body: str
    asset_id: str | None = None
    version_id: str | None = None
    x: float = 0.5
    y: float = 0.5
    timestamp: float | None = Field(default=None, ge=0, le=86400)
    frame: int | None = Field(default=None, ge=0, le=1000000)


class ReviewCommentUpdate(BaseModel):
    body: str | None = None
    resolved: bool | None = None


@router.get("", response_model=list[ReviewItem])
def get_review_items(hub: Path = Depends(require_hub)) -> list[ReviewItem]:
    return [
        item
        for item in list_review(hub)
        if item.status in (ReviewStatus.pending, ReviewStatus.rework)
    ]


@router.get("/archive", response_model=list[ReviewItem])
def get_review_archive(hub: Path = Depends(require_hub)) -> list[ReviewItem]:
    return [
        item
        for item in list_review(hub)
        if item.status in (ReviewStatus.accepted, ReviewStatus.archived)
    ]


@router.get("/{review_id}/comments", response_model=list[ReviewComment])
def get_comments(review_id: str, hub: Path = Depends(require_hub)) -> list[ReviewComment]:
    if get_review(hub, review_id) is None:
        raise HTTPException(status_code=404, detail="review item not found")
    return list_review_comments(hub, review_id)


@router.post("/{review_id}/comments", response_model=ReviewComment, status_code=201)
def add_comment(
    review_id: str,
    payload: ReviewCommentCreate,
    hub: Path = Depends(require_hub),
) -> ReviewComment:
    item = get_review(hub, review_id)
    if item is None:
        raise HTTPException(status_code=404, detail="review item not found")
    body = payload.body.strip()
    if not body:
        raise HTTPException(status_code=422, detail="comment body is empty")
    if payload.asset_id:
        asset = get_asset(hub, payload.asset_id)
        if asset is None:
            raise HTTPException(status_code=404, detail="asset not found")
        if payload.version_id and all(
            version.id != payload.version_id for version in asset.versions
        ):
            raise HTTPException(status_code=422, detail="version does not belong to asset")
    comment = ReviewComment(
        review_id=review_id,
        asset_id=payload.asset_id,
        version_id=payload.version_id,
        x=min(1.0, max(0.0, payload.x)),
        y=min(1.0, max(0.0, payload.y)),
        timestamp=payload.timestamp,
        frame=payload.frame,
        body=body,
    )
    saved = save_review_comment(hub, comment)
    append_event(
        hub,
        LedgerEvent(
            type="review.commented",
            subject=item.task_id,
            data={"review_id": review_id, "comment_id": saved.id},
        ),
    )
    return saved


@router.patch(
    "/{review_id}/comments/{comment_id}",
    response_model=ReviewComment,
)
def update_comment(
    review_id: str,
    comment_id: str,
    payload: ReviewCommentUpdate,
    hub: Path = Depends(require_hub),
) -> ReviewComment:
    if get_review(hub, review_id) is None:
        raise HTTPException(status_code=404, detail="review item not found")
    comment = get_review_comment(hub, review_id, comment_id)
    if comment is None:
        raise HTTPException(status_code=404, detail="comment not found")
    if payload.body is not None:
        body = payload.body.strip()
        if not body:
            raise HTTPException(status_code=422, detail="comment body is empty")
        comment.body = body
    if payload.resolved is not None:
        comment.resolved = payload.resolved
    return save_review_comment(hub, comment)


@router.delete("/{review_id}/comments/{comment_id}", status_code=204)
def remove_comment(
    review_id: str,
    comment_id: str,
    hub: Path = Depends(require_hub),
) -> None:
    if not delete_review_comment(hub, review_id, comment_id):
        raise HTTPException(status_code=404, detail="comment not found")


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


@router.post("/{review_id}/second-opinion", response_model=ReviewText)
def second_opinion(review_id: str, hub: Path = Depends(require_hub)) -> ReviewText:
    item = get_review(hub, review_id)
    if item is None:
        raise HTTPException(status_code=404, detail="review item not found")
    task = get_task(hub, item.task_id)
    assets = [
        asset
        for asset in list_assets(hub)
        if task is not None and (task.id in asset.task_ids or asset.task_id == task.id)
    ]

    lines = [
        "Ты — независимый критик результата в Kova Hub.",
        "Не переписывай всё без причины. Сначала найди риски и проверь соответствие задаче.",
        "",
        f"Задача: {task.title if task else item.task_id}",
    ]
    if task is not None:
        lines.append(f"Цель: {task.goal or 'не указана'}")
        if task.criteria:
            lines.append("Критерии готовности:")
            lines.extend(f"- {criterion.text}" for criterion in task.criteria)
        if task.constraints:
            lines.append("Ограничения:")
            lines.extend(f"- {constraint}" for constraint in task.constraints)
        if task.validation:
            lines.append("Проверки, настроенные в задаче:")
            lines.extend(f"- {command.label}: {command.command}" for command in task.validation)
    lines.extend(["", f"Результат на приёмку: {item.summary or 'без описания'}", ""])
    if assets:
        lines.append("Связанные ассеты:")
        for asset in assets:
            metrics = asset.metrics
            triangles = metrics.triangles or 0
            materials = metrics.materials or 0
            textures = metrics.textures or 0
            lines.append(
                f"- {asset.name}: {asset.type}, {asset.engine.value}, "
                f"{triangles} {_plural(triangles, 'треугольник', 'треугольника', 'треугольников')}, "
                f"{materials} {_plural(materials, 'материал', 'материала', 'материалов')}, "
                f"{textures} {_plural(textures, 'текстура', 'текстуры', 'текстур')}"
            )
    lines.extend(
        [
            "",
            "Ответь строго по пунктам:",
            "1. Вердикт: принять / доработать / отклонить — и почему.",
            "2. Три главных риска или места, где результат может сломаться.",
            "3. Что проверить руками или в движке до приёмки.",
            "4. Если нужна доработка — конкретные шаги и файлы, без лишних изменений.",
        ]
    )
    append_event(
        hub,
        LedgerEvent(
            type="review.second_opinion",
            subject=item.task_id,
            data={"review_id": item.id, "assets": len(assets)},
        ),
    )
    return ReviewText(text="\n".join(lines))


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
