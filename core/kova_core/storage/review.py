from pathlib import Path

from ..domain.common import utc_now
from ..domain.enums import ReviewStatus
from ..domain.review import ReviewComment, ReviewItem
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


def _comments_dir(hub: Path, review_id: str) -> Path:
    return resolve_inside(hub, Path("review") / "comments" / review_id)


def list_review_comments(hub: Path, review_id: str) -> list[ReviewComment]:
    directory = _comments_dir(hub, review_id)
    if not directory.is_dir():
        return []
    comments: list[ReviewComment] = []
    for path in directory.glob("*.json"):
        try:
            comments.append(ReviewComment.model_validate_json(path.read_text(encoding="utf-8")))
        except (OSError, ValueError):
            continue
    comments.sort(key=lambda item: item.created_at)
    return comments


def get_review_comment(hub: Path, review_id: str, comment_id: str) -> ReviewComment | None:
    try:
        path = resolve_inside(_comments_dir(hub, review_id), f"{comment_id}.json")
    except ValueError:
        return None
    if not path.is_file():
        return None
    return ReviewComment.model_validate_json(path.read_text(encoding="utf-8"))


def save_review_comment(hub: Path, comment: ReviewComment) -> ReviewComment:
    comment.updated_at = utc_now()
    directory = _comments_dir(hub, comment.review_id)
    directory.mkdir(parents=True, exist_ok=True)
    target = resolve_inside(directory, f"{comment.id}.json")
    target.write_text(comment.model_dump_json(indent=2) + "\n", encoding="utf-8")
    return comment


def delete_review_comment(hub: Path, review_id: str, comment_id: str) -> bool:
    try:
        path = resolve_inside(_comments_dir(hub, review_id), f"{comment_id}.json")
    except ValueError:
        return False
    if not path.is_file():
        return False
    path.unlink(missing_ok=True)
    return True
