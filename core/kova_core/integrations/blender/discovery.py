import json
import os
import sys
from pathlib import Path

BRIDGE_FILE = "bridge.json"
DEFAULT_HOST = "127.0.0.1"


def _is_windows() -> bool:
    return os.name == "nt"


def _platform() -> str:
    return sys.platform


def data_dir() -> Path:
    override = os.environ.get("KOVA_HUB_BLENDER_DATA")
    if override:
        return Path(override).expanduser()
    local = os.environ.get("KOVA_LOCAL_DATA_DIR")
    if local:
        return Path(local).expanduser() / "blender"
    if _is_windows():
        base = os.environ.get("LOCALAPPDATA")
        root = Path(base) if base else Path.home() / "AppData" / "Local"
        return root / "KovaHub" / "blender"
    if _platform() == "darwin":
        return Path.home() / "Library" / "Caches" / "KovaHub" / "blender"
    base = os.environ.get("XDG_CACHE_HOME")
    root = Path(base) if base else Path.home() / ".cache"
    return root / "KovaHub" / "blender"


def bridge_file() -> Path:
    return data_dir() / BRIDGE_FILE


def read_bridge() -> dict[str, object] | None:
    try:
        payload = json.loads(bridge_file().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(payload, dict):
        return None
    try:
        port = int(payload.get("port") or 0)
    except (TypeError, ValueError):
        return None
    if not 1 <= port <= 65535:
        return None
    payload["port"] = port
    payload.setdefault("host", DEFAULT_HOST)
    payload.setdefault("token", "")
    return payload
