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


def ensure_cli_path() -> None:
    """GUI apps on macOS/Linux often start with a minimal PATH.

    Add the usual user tool locations so CLI providers, Git and engines are
    discoverable when Kova is launched from Finder or a desktop launcher.
    """
    if _is_windows():
        return
    home = Path.home()
    extras = [
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
        "/usr/local/bin",
        "/usr/local/sbin",
        "/snap/bin",
        str(home / ".local" / "bin"),
        str(home / ".cargo" / "bin"),
        str(home / ".bun" / "bin"),
        str(home / "Library" / "pnpm"),
    ]
    current = [part for part in os.environ.get("PATH", "").split(os.pathsep) if part]
    missing = [path for path in extras if path not in current and Path(path).is_dir()]
    if missing:
        os.environ["PATH"] = os.pathsep.join(current + missing)


def app_data_dir() -> Path:
    override = os.environ.get("KOVA_DATA_DIR")
    if override:
        return Path(override)
    return _platform_data_root() / "KovaHub"


def local_data_dir() -> Path:
    override = os.environ.get("KOVA_LOCAL_DATA_DIR")
    if override:
        return Path(override)
    return _platform_cache_root() / "KovaHub"
