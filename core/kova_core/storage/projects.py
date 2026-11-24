import json
from pathlib import Path

from ..config import app_data_dir
from ..domain.enums import Engine
from ..domain.project import Project
from .hub import create_hub, find_hub

ACTIVE_FILE = "active-project.json"


def active_project_file() -> Path:
    return app_data_dir() / ACTIVE_FILE


def read_active_hub() -> Path | None:
    file = active_project_file()
    if not file.is_file():
        return None
    try:
        data = json.loads(file.read_text(encoding="utf-8"))
        root = Path(data["path"])
    except (KeyError, OSError, ValueError):
        return None
    return find_hub(root)


def write_active_hub(hub: Path) -> None:
    file = active_project_file()
    file.parent.mkdir(parents=True, exist_ok=True)
    payload = {"path": str(hub.parent)}
    file.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def clear_active_hub() -> None:
    active_project_file().unlink(missing_ok=True)


def load_project(hub: Path) -> Project:
    project_file = hub / "project.json"
    if project_file.is_file():
        return Project.model_validate_json(project_file.read_text(encoding="utf-8"))
    project = Project(name=hub.parent.name)
    save_project(hub, project)
    return project


def save_project(hub: Path, project: Project) -> Project:
    from ..domain.common import utc_now

    project.updated_at = utc_now()
    project_file = hub / "project.json"
    project_file.write_text(
        project.model_dump_json(indent=2) + "\n",
        encoding="utf-8",
    )
    return project


def open_project(
    project_dir: Path,
    name: str | None = None,
    engine: Engine | None = None,
) -> tuple[Project, Path]:
    root = project_dir.expanduser().resolve()
    if not root.is_dir():
        raise FileNotFoundError(f"project folder not found: {project_dir}")

    hub = find_hub(root) or create_hub(root, name)
    project = load_project(hub)
    changed = False

    if name and project.name != name:
        project.name = name
        changed = True
    if engine is not None and project.engine != engine:
        project.engine = engine
        changed = True

    if changed:
        save_project(hub, project)

    write_active_hub(hub)
    return project, hub


def demo_project() -> tuple[Project, Path]:
    root = app_data_dir() / "projects" / "Blade Evolve"
    root.mkdir(parents=True, exist_ok=True)
    return open_project(root, "Blade Evolve", Engine.roblox)
