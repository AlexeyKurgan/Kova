from pathlib import Path

from ..domain.ids import new_id
from ..security.paths import resolve_inside


def save_response(hub: Path, text: str) -> tuple[str, str]:
    artifact_id = new_id("art")
    relative = Path("artifacts") / "logs" / f"{artifact_id}.md"
    target = resolve_inside(hub, relative)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8")
    return artifact_id, relative.as_posix()


def read_artifact(hub: Path, relative: str) -> str:
    return resolve_inside(hub, relative).read_text(encoding="utf-8")
