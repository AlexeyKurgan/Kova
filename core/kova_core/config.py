import os
import sys
from pathlib import Path


def _is_windows() -> bool:
    return os.name == "nt"


def _platform() -> str:
    return sys.platform


def _platform_data_root() -> Path:
    if _is_windows():
        base = os.environ.get("APPDATA")
        return Path(base) if base else Path.home() / "AppData" / "Roaming"
    if _platform() == "darwin":
        return Path.home() / "Library" / "Application Support"
    base = os.environ.get("XDG_DATA_HOME")
    return Path(base) if base else Path.home() / ".local" / "share"


def _platform_cache_root() -> Path:
    if _is_windows():
        base = os.environ.get("LOCALAPPDATA")
        return Path(base) if base else Path.home() / "AppData" / "Local"
    if _platform() == "darwin":
        return Path.home() / "Library" / "Caches"
    base = os.environ.get("XDG_CACHE_HOME")
    return Path(base) if base else Path.home() / ".cache"


def app_data_dir() -> Path:
    override = os.environ.get("KOVA_DATA_DIR")
    if override:
        return Path(override)
    return _platform_data_root() / "KovaHub"


def local_data_dir() -> Path:
    return _platform_cache_root() / "KovaHub"
