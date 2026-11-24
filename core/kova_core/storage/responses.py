from pathlib import Path

from ..domain.enums import TaskStatus
from ..domain.ledger import LedgerEvent
from ..domain.review import ReviewItem
from ..domain.task import ArtifactRef, Task
from .artifacts import save_response
from .ledger import append_event
from .review import save_review
from .tasks import get_task, save_task


def record_response(
    hub: Path,
    task_id: str,
    text: str,
    event_type: str = "response.imported",
    actor: str = "human",
    data: dict[str, object] | None = None,
) -> tuple[Task, ReviewItem, str] | None:
    task = get_task(hub, task_id)
    if task is None:
        return None

    artifact_id, relative = save_response(hub, text)
    task.artifacts.append(ArtifactRef(id=artifact_id, kind="response", path=relative))
    task.status = TaskStatus.review
    saved = save_task(hub, task)

    lines = [line.strip() for line in text.splitlines() if line.strip()]
    summary = (lines[0] if lines else "Ответ AI")[:160]
    review = save_review(
        hub,
        ReviewItem(task_id=saved.id, summary=summary, artifact_path=relative),
    )
    append_event(
        hub,
        LedgerEvent(
            type=event_type,
            subject=saved.id,
            actor=actor,
            data={
                "review_id": review.id,
                "artifact": relative,
                **(data or {}),
            },
        ),
    )
    return saved, review, relative
