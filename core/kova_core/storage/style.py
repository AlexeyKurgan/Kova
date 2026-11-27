from pathlib import Path

from ..domain.common import utc_now
from ..domain.style import StyleBible
from ..security.paths import resolve_inside

STYLE_FILE = Path("style") / "bible.json"


def style_file(hub: Path) -> Path:
    return resolve_inside(hub, STYLE_FILE)


def load_style(hub: Path) -> StyleBible:
    path = style_file(hub)
    if not path.is_file():
        return StyleBible()
    try:
        return StyleBible.model_validate_json(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return StyleBible()


def save_style(hub: Path, bible: StyleBible) -> StyleBible:
    bible.updated_at = utc_now()
    path = style_file(hub)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(bible.model_dump_json(indent=2) + "\n", encoding="utf-8")
    return bible
