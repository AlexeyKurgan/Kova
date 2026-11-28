"""Bridge discovery paths shared by the add-on and the standalone helpers.

Kept free of ``bpy`` imports so core tests and tooling can load it directly.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path


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


def discovery_path() -> Path:
    return data_dir() / "bridge.json"
