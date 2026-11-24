from pathlib import Path

from ..domain.common import utc_now
from ..domain.enums import ReviewStatus
from ..domain.review import ReviewItem
from ..security.paths import resolve_inside

REVIEW_FOLDERS = ("inbox", "archive")


def folder_for(status: ReviewStatus) -> str:
    if status in (ReviewStatus.accepted, ReviewStatus.archived):
        return "archive"
    return "inbox"


def review_file(hub: Path, folder: str, review_id: str) -> Path:
    return resolve_inside(hub, Path("review") / folder / f"{review_id}.json")


def list_review(hub: Path) -> list[ReviewItem]:
    items: list[ReviewItem] = []
    for folder in REVIEW_FOLDERS:
        directory = hub / "review" / folder
        if not directory.is_dir():
            continue
        for path in directory.glob("*.json"):
            try:
                items.append(ReviewItem.model_validate_json(path.read_text(encoding="utf-8")))
            except (OSError, ValueError):
                continue
    items.sort(key=lambda item: item.updated_at, reverse=True)
    return items


def get_review(hub: Path, review_id: str) -> ReviewItem | None:
    for folder in REVIEW_FOLDERS:
        try:
            path = review_file(hub, folder, review_id)
        except ValueError:
            return None
        if path.is_file():
            return ReviewItem.model_validate_json(path.read_text(encoding="utf-8"))
    return None


def archive_for_task(hub: Path, task_id: str) -> int:
    changed = 0
    for item in list_review(hub):
        if item.task_id == task_id and item.status is not ReviewStatus.archived:
            item.status = ReviewStatus.archived
            save_review(hub, item)
            changed += 1
    return changed


def save_review(hub: Path, item: ReviewItem) -> ReviewItem:
    item.updated_at = utc_now()
    for folder in REVIEW_FOLDERS:
        review_file(hub, folder, item.id).unlink(missing_ok=True)
    target = review_file(hub, folder_for(item.status), item.id)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(item.model_dump_json(indent=2) + "\n", encoding="utf-8")
    return item
