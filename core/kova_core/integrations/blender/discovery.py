import json
import os
import sys
from pathlib import Path

BRIDGE_FILE = "bridge.json"
DEFAULT_HOST = "127.0.0.1"


def data_dir() -> Path:
    override = os.environ.get("KOVA_HUB_BLENDER_DATA")
    if override:
        return Path(override).expanduser()
    if os.name == "nt":
        base = os.environ.get("LOCALAPPDATA")
        root = Path(base) if base else Path.home() / "AppData" / "Local"
        return root / "KovaHub" / "blender"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "KovaHub" / "blender"
    base = os.environ.get("XDG_DATA_HOME")
    root = Path(base) if base else Path.home() / ".local" / "share"
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
