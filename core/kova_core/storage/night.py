from pathlib import Path

from ..domain.common import utc_now
from ..domain.night import NightShiftState
from ..security.paths import resolve_inside


def night_file(hub: Path) -> Path:
    return resolve_inside(hub, Path(".local") / "night.json")


def load_night(hub: Path) -> NightShiftState:
    path = night_file(hub)
    if not path.is_file():
        return NightShiftState()
    try:
        return NightShiftState.model_validate_json(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return NightShiftState()


def save_night(hub: Path, state: NightShiftState) -> NightShiftState:
    state.updated_at = utc_now()
    path = night_file(hub)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(state.model_dump_json(indent=2) + "\n", encoding="utf-8")
    return state
