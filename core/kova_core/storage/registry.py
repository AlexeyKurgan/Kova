import hashlib
import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path

from ..security.trash import move_project_to_trash, move_to_trash

from ..config import app_data_dir
from ..domain.enums import Engine
from ..domain.project import Project
from .hub import find_hub
from .projects import (
    clear_active_hub,
    load_project,
    open_project,
    read_active_hub,
    save_project,
)
from .summary import project_stats

REGISTRY_FILE = "projects.json"
DEFAULT_PARENT = "projects"
COVER_NAMES = ("cover.png", "cover.jpg", "cover.jpeg", "cover.webp")
COVER_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}
INVALID_FOLDER = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def projects_root() -> Path:
    return app_data_dir() / DEFAULT_PARENT


def registry_file() -> Path:
    return app_data_dir() / REGISTRY_FILE


def project_id(path: Path) -> str:
    digest = hashlib.sha1(str(path.resolve()).lower().encode("utf-8")).hexdigest()
    return f"prj_{digest[:12]}"


def _now() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def _load_meta() -> tuple[list[dict[str, object]], set[str]]:
    try:
        payload = json.loads(registry_file().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return [], set()
    rows = payload.get("projects") if isinstance(payload, dict) else None
    ignored = payload.get("ignored") if isinstance(payload, dict) else None
    clean_rows = (
        [row for row in rows if isinstance(row, dict) and row.get("path")]
        if isinstance(rows, list)
        else []
    )
    clean_ignored = {str(item).lower() for item in ignored} if isinstance(ignored, list) else set()
    return clean_rows, clean_ignored


def _load() -> list[dict[str, object]]:
    return _load_meta()[0]


def _save(rows: list[dict[str, object]], ignored: set[str] | None = None) -> None:
    if ignored is None:
        ignored = _load_meta()[1]
    path = registry_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"version": 1, "projects": rows, "ignored": sorted(ignored)}
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _find(rows: list[dict[str, object]], path: Path) -> dict[str, object] | None:
    key = str(path.resolve()).lower()
    for row in rows:
        try:
            if str(Path(str(row["path"])).resolve()).lower() == key:
                return row
        except (OSError, ValueError):
            continue
    return None


def register(path: Path, name: str | None = None, engine: Engine | None = None) -> dict[str, object]:
    root = path.resolve()
    hub = find_hub(root)
    if hub is None:
        raise FileNotFoundError(f"в папке нет проекта Kova: {root}")

    project = load_project(hub)
    rows, ignored = _load_meta()
    ignored.discard(str(root).lower())
    row = _find(rows, root)
    if row is None:
        row = {
            "id": project_id(root),
            "path": str(root),
            "name": name or project.name,
            "engine": (engine or project.engine).value,
            "cover": "",
            "created_at": _now(),
            "last_opened_at": _now(),
        }
        rows.append(row)
    else:
        row["name"] = name or project.name
        row["engine"] = (engine or project.engine).value
        row["last_opened_at"] = _now()
    _save(rows, ignored)
    return row


def ensure_registry() -> None:
    rows, ignored = _load_meta()
    before = json.dumps([rows, sorted(ignored)], sort_keys=True, default=str)
    root = projects_root()
    if root.is_dir():
        for child in sorted(root.iterdir()):
            if not child.is_dir():
                continue
            if str(child.resolve()).lower() in ignored:
                continue
            if find_hub(child) is None:
                continue
            if _find(rows, child) is None:
                try:
                    register(child)
                except (OSError, ValueError):
                    continue
    active = read_active_hub()
    if active is not None and _find(rows, active.parent) is None:
        try:
            register(active.parent)
        except (OSError, ValueError):
            pass
    rows, ignored = _load_meta()
    if json.dumps([rows, sorted(ignored)], sort_keys=True, default=str) != before:
        _save(rows, ignored)


def _cover_path(row: dict[str, object]) -> Path | None:
    root = Path(str(row["path"]))
    for name in COVER_NAMES:
        path = root / ".hub" / name
        if path.is_file():
            return path
    return None


def cover_file(project: str) -> Path | None:
    row = get_project(project)
    return _cover_path(row) if row is not None else None


def summary(row: dict[str, object]) -> dict[str, object]:
    root = Path(str(row["path"]))
    hub = find_hub(root)
    active = read_active_hub()
    exists = hub is not None
    stats: dict[str, int] = {}
    project: Project | None = None
    if hub is not None:
        try:
            stats = project_stats(hub)
        except (OSError, ValueError):
            stats = {}
        try:
            project = load_project(hub)
        except (OSError, ValueError):
            project = None
    cover = _cover_path(row)
    try:
        last_opened = str(row.get("last_opened_at") or "")
    except (TypeError, ValueError):
        last_opened = ""

    return {
        "id": str(row.get("id") or project_id(root)),
        "name": str(row.get("name") or (project.name if project else root.name)),
        "engine": str(row.get("engine") or (project.engine.value if project else "generic")),
        "path": str(root),
        "cover_url": (
            f"/projects/{row.get('id')}/cover?v={int(cover.stat().st_mtime)}"
            if cover is not None
            else ""
        ),
        "active": active is not None and hub is not None and active == hub,
        "exists": exists,
        "created_at": str(row.get("created_at") or ""),
        "last_opened_at": last_opened,
        "updated_at": project.updated_at.isoformat() if project else "",
        "tasks_total": int(stats.get("tasks_total", 0)),
        "tasks_active": int(stats.get("tasks_active", 0)),
        "tasks_done": int(stats.get("tasks_done", 0)),
        "assets_total": int(stats.get("assets_total", 0)),
    }


def list_projects() -> list[dict[str, object]]:
    ensure_registry()
    rows = _load()
    rows.sort(key=lambda row: str(row.get("last_opened_at") or ""), reverse=True)
    return [summary(row) for row in rows]


def get_project(project: str) -> dict[str, object] | None:
    for row in _load():
        if row.get("id") == project:
            return row
    return None


def folder_name(name: str) -> str:
    cleaned = INVALID_FOLDER.sub("-", name).strip(" .-")
    return cleaned or "Kova Project"


def default_parent() -> Path:
    return projects_root()


def create_project(name: str, engine: Engine, parent: Path | None = None) -> dict[str, object]:
    base = (parent or default_parent()).expanduser().resolve()
    target = base / folder_name(name)
    if target.exists() and any(target.iterdir()):
        raise FileExistsError(f"папка уже существует: {target}")
    target.mkdir(parents=True, exist_ok=True)
    project, hub = open_project(target, name.strip() or target.name, engine)
    row = register(hub.parent, project.name, project.engine)
    return summary(row)


def open_project_by_id(project: str) -> dict[str, object] | None:
    row = get_project(project)
    if row is None:
        return None
    root = Path(str(row["path"]))
    if find_hub(root) is None:
        return None
    project_data, hub = open_project(
        root,
        str(row.get("name") or root.name),
        Engine(str(row.get("engine") or "generic")),
    )
    row = register(hub.parent, project_data.name, project_data.engine)
    return summary(row)


def update_project(
    project: str,
    name: str | None = None,
    engine: Engine | None = None,
) -> dict[str, object] | None:
    row = get_project(project)
    if row is None:
        return None
    root = Path(str(row["path"]))
    hub = find_hub(root)
    if hub is None:
        return None
    data = load_project(hub)
    if name is not None and name.strip():
        data.name = name.strip()
    if engine is not None:
        data.engine = engine
    save_project(hub, data)
    row["name"] = data.name
    row["engine"] = data.engine.value
    rows = _load()
    for index, item in enumerate(rows):
        if item.get("id") == project:
            rows[index] = row
    _save(rows)
    return summary(row)


def set_cover(project: str, source: Path) -> dict[str, object] | None:
    row = get_project(project)
    if row is None:
        return None
    suffix = source.suffix.lower()
    if suffix not in COVER_SUFFIXES:
        raise ValueError("обложка: png, jpg, jpeg или webp")
    if not source.is_file():
        raise FileNotFoundError(f"файл не найден: {source}")
    root = Path(str(row["path"]))
    hub = root / ".hub"
    if not hub.is_dir():
        return None
    for existing in COVER_NAMES:
        (hub / existing).unlink(missing_ok=True)
    target = hub / f"cover{suffix}"
    shutil.copy2(source, target)
    return summary(row)


def duplicate_project(
    project: str,
    name: str,
    parent: Path | None = None,
) -> dict[str, object] | None:
    row = get_project(project)
    if row is None:
        return None
    source = Path(str(row["path"]))
    if not source.is_dir():
        return None
    base = (parent or default_parent()).expanduser().resolve()
    target = base / folder_name(name)
    if target.exists() and any(target.iterdir()):
        raise FileExistsError(f"папка уже существует: {target}")

    def ignore(directory: str, names: list[str]) -> set[str]:
        skipped = {
            name
            for name in names
            if name in {"node_modules", "dist", ".git", "target", "__pycache__", ".pytest_cache", ".venv", "venv"}
        }
        folder = Path(directory)
        if folder.name == ".hub":
            skipped.update(name for name in (".local", "snapshots") if name in names)
        return skipped

    try:
        shutil.copytree(source, target, ignore=ignore)
        hub = find_hub(target)
        if hub is None:
            raise FileNotFoundError("скопированная папка не содержит .hub")
        data = load_project(hub)
        data.name = name.strip() or target.name
        save_project(hub, data)
        new_row = register(target, data.name, data.engine)
        return summary(new_row)
    except Exception:
        shutil.rmtree(target, ignore_errors=True)
        raise


def delete_project(project: str, delete_files: bool = False) -> bool:
    row = get_project(project)
    if row is None:
        return False
    root = Path(str(row["path"]))
    rows, ignored = _load_meta()
    rows = [item for item in rows if item.get("id") != project]
    if delete_files:
        ignored.discard(str(root.resolve()).lower())
    else:
        ignored.add(str(root.resolve()).lower())
    _save(rows, ignored)

    active = read_active_hub()
    if active is not None:
        try:
            if active.parent.resolve() == root.resolve():
                clear_active_hub()
        except OSError:
            pass

    if delete_files:
        if len(root.parts) < 3 or root == Path(root.anchor):
            raise ValueError("нельзя удалить корневую папку")
        if root.is_dir():
            move_project_to_trash(
                root,
                str(row.get("name") or root.name),
                str(row.get("engine") or ""),
            )
    return True
