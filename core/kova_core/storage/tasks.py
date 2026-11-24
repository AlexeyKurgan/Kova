from pathlib import Path

from ..domain.common import utc_now
from ..domain.enums import TaskStatus
from ..domain.task import Task
from ..security.paths import resolve_inside

TASK_FOLDERS = ("active", "done", "archive", "trash")


def folder_for(task: Task) -> str:
    if task.deleted_at is not None:
        return "trash"
    if task.status is TaskStatus.archived:
        return "archive"
    if task.status is TaskStatus.done:
        return "done"
    return "active"


def task_file(hub: Path, folder: str, task_id: str) -> Path:
    return resolve_inside(hub, Path("tasks") / folder / f"{task_id}.json")


def list_tasks(hub: Path, include_trash: bool = False) -> list[Task]:
    tasks: list[Task] = []
    for folder in TASK_FOLDERS:
        if folder == "trash" and not include_trash:
            continue
        directory = hub / "tasks" / folder
        if not directory.is_dir():
            continue
        for path in directory.glob("*.json"):
            try:
                task = Task.model_validate_json(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if not include_trash and task.deleted_at is not None:
                continue
            tasks.append(task)
    tasks.sort(key=lambda task: task.updated_at, reverse=True)
    return tasks


def list_trash(hub: Path) -> list[Task]:
    return [task for task in list_tasks(hub, include_trash=True) if task.deleted_at is not None]


def get_task(hub: Path, task_id: str) -> Task | None:
    for folder in TASK_FOLDERS:
        try:
            path = task_file(hub, folder, task_id)
        except ValueError:
            return None
        if path.is_file():
            return Task.model_validate_json(path.read_text(encoding="utf-8"))
    return None


def soft_delete_task(hub: Path, task_id: str) -> Task | None:
    task = get_task(hub, task_id)
    if task is None:
        return None
    if task.deleted_at is None:
        task.deleted_at = utc_now()
    return save_task(hub, task)


def restore_task(hub: Path, task_id: str) -> Task | None:
    task = get_task(hub, task_id)
    if task is None or task.deleted_at is None:
        return None
    task.deleted_at = None
    return save_task(hub, task)


def purge_task(hub: Path, task_id: str) -> bool:
    removed = False
    for folder in TASK_FOLDERS:
        path = task_file(hub, folder, task_id)
        if path.is_file():
            path.unlink(missing_ok=True)
            removed = True
    return removed


def save_task(hub: Path, task: Task) -> Task:
    task.touch()
    for folder in TASK_FOLDERS:
        task_file(hub, folder, task.id).unlink(missing_ok=True)

    folder = folder_for(task)
    target = task_file(hub, folder, task.id)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(task.model_dump_json(indent=2) + "\n", encoding="utf-8")
    return task
