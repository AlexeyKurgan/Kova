from pathlib import Path

from ..domain.project import Project

HUB_DIR = ".hub"

HUB_STRUCTURE = (
    "style/references",
    "tasks/active",
    "tasks/done",
    "tasks/archive",
    "tasks/templates",
    "capsules",
    "artifacts/renders",
    "artifacts/sheets",
    "artifacts/diffs",
    "artifacts/logs",
    "artifacts/previews",
    "assets",
    "packages/config",
    "skills",
    "glossary",
    "decisions",
    "ledger",
    "snapshots",
    "review/inbox",
    "review/archive",
    "review/comments",
    "agents",
    ".local/secrets",
    ".local/cache",
    ".local/index",
    ".local/sandbox",
    ".local/backups",
)


def find_hub(project_dir: Path) -> Path | None:
    current = project_dir.resolve()
    for candidate in (current, *current.parents):
        hub = candidate / HUB_DIR
        if hub.is_dir():
            return hub
    return None


def create_hub(project_dir: Path, name: str | None = None) -> Path:
    root = project_dir.resolve()
    hub = root / HUB_DIR

    for relative in HUB_STRUCTURE:
        (hub / relative).mkdir(parents=True, exist_ok=True)

    project_file = hub / "project.json"
    if not project_file.exists():
        project = Project(name=name or root.name)
        project_file.write_text(
            project.model_dump_json(indent=2) + "\n",
            encoding="utf-8",
        )

    for relative in ("decisions/decisions.jsonl", "ledger/events.jsonl"):
        (hub / relative).touch(exist_ok=True)

    snapshots_index = hub / "snapshots" / "index.json"
    if not snapshots_index.exists():
        snapshots_index.write_text("{}\n", encoding="utf-8")

    return hub
