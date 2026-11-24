import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from functools import lru_cache
from pathlib import Path

from .bridge import find_blender

ADDON_MODULE = "kova_bridge"
EXTENSION_REPO = "user_default"
LEGACY_MODULES = ("kova_addon", "bm_addon")
STARTUP_NAME = "kova_bridge_autostart.py"
LEGACY_STARTUPS = ("kova_addon_autostart.py", "bm_addon_autostart.py")
SOURCE = Path(__file__).with_name("addon")
VERSION_RE = re.compile(r"ADDON_VERSION\s*=\s*\(([^)]+)\)")
MANIFEST_RE = re.compile(r'^version\s*=\s*"([^"]+)"', re.MULTILINE)


def source_version() -> str:
    try:
        text = (SOURCE / "blender_manifest.toml").read_text(encoding="utf-8")
    except OSError:
        return "?"
    match = MANIFEST_RE.search(text)
    return match.group(1) if match else "?"


def installed_version(path: Path) -> str:
    manifest = path / "blender_manifest.toml"
    if manifest.is_file():
        match = MANIFEST_RE.search(manifest.read_text(encoding="utf-8", errors="replace"))
        if match:
            return match.group(1)
    try:
        text = (path / "constants.py").read_text(encoding="utf-8")
    except OSError:
        return ""
    match = VERSION_RE.search(text)
    if not match:
        return ""
    return ".".join(part.strip() for part in match.group(1).split(",") if part.strip())


@lru_cache(maxsize=4)
def _blender_version(exe: str) -> str:
    try:
        result = subprocess.run(
            [exe, "--version"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=30,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except (OSError, subprocess.SubprocessError):
        return ""
    match = re.search(r"Blender\s+(\d+\.\d+)", result.stdout or "")
    return match.group(1) if match else ""


def _user_bases() -> list[Path]:
    if os.name == "nt":
        appdata = os.environ.get("APPDATA")
        if appdata:
            return [Path(appdata) / "Blender Foundation" / "Blender"]
        return [Path.home() / "AppData" / "Roaming" / "Blender Foundation" / "Blender"]
    if sys.platform == "darwin":
        return [Path.home() / "Library" / "Application Support" / "Blender"]
    return [Path.home() / ".config" / "blender"]


def script_dirs() -> list[Path]:
    override = os.environ.get("KOVA_BLENDER_SCRIPTS")
    if override:
        return [Path(part).expanduser() for part in override.split(os.pathsep) if part.strip()]

    exe = find_blender()
    version = _blender_version(str(exe)) if exe else ""
    if version:
        return [base / version / "scripts" for base in _user_bases()]

    for base in _user_bases():
        try:
            versions = sorted(
                (child for child in base.iterdir() if child.is_dir() and re.match(r"^\d+\.\d+", child.name)),
                key=lambda child: child.name,
                reverse=True,
            )
        except OSError:
            continue
        if versions:
            return [versions[0] / "scripts"]
    return []


def extension_dirs() -> list[Path]:
    override = os.environ.get("KOVA_BLENDER_EXTENSIONS")
    if override:
        return [Path(part).expanduser() for part in override.split(os.pathsep) if part.strip()]

    exe = find_blender()
    version = _blender_version(str(exe)) if exe else ""
    if version:
        return [base / version / "extensions" / EXTENSION_REPO for base in _user_bases()]
    return []


def autostart_source() -> str:
    return (
        '"""Installed by Kova Hub. Enables the local Blender bridge add-on at startup."""\n'
        "import addon_utils\n"
        "\n"
        "\n"
        "def register():\n"
        "    try:\n"
        f'        addon_utils.enable("{ADDON_MODULE}", default_set=True, persistent=True)\n'
        "    except Exception as exc:\n"
        '        print("[Kova Bridge] autostart failed: %s" % exc)\n'
        "\n"
        "\n"
        "def unregister():\n"
        "    pass\n"
    )


def _legacy_state() -> list[tuple[str, str]]:
    rows: list[tuple[str, str]] = []
    for scripts in script_dirs():
        target = scripts / "addons" / ADDON_MODULE
        if (target / "__init__.py").is_file():
            rows.append((str(target), installed_version(target)))
    return rows


def _extension_state() -> list[tuple[str, str]]:
    rows: list[tuple[str, str]] = []
    for repo in extension_dirs():
        target = repo / ADDON_MODULE
        if (target / "__init__.py").is_file():
            rows.append((str(target), installed_version(target)))
    return rows


def addon_state() -> dict[str, object]:
    rows = _extension_state() or _legacy_state()
    current = source_version()
    installed = bool(rows)
    version = rows[0][1] if rows else ""
    return {
        "installed": installed,
        "version": version,
        "path": rows[0][0] if rows else "",
        "available_version": current,
        "outdated": installed and version != current,
        "mode": "extension" if _extension_state() else "legacy" if rows else "",
    }


def _remove_legacy():
    for scripts in script_dirs():
        for legacy in LEGACY_MODULES:
            stale = scripts / "addons" / legacy
            if stale.is_dir():
                shutil.rmtree(stale, ignore_errors=True)
        for name in (*LEGACY_STARTUPS, STARTUP_NAME):
            stale = scripts / "startup" / name
            if stale.is_file():
                stale.unlink(missing_ok=True)


def install_legacy() -> dict[str, object]:
    if not (SOURCE / "__init__.py").is_file():
        raise RuntimeError("исходники аддона не найдены в установке Kova")

    installed: list[str] = []
    for scripts in script_dirs():
        target = scripts / "addons" / ADDON_MODULE
        if target.exists():
            shutil.rmtree(target)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(
            SOURCE,
            target,
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "blender_manifest.toml"),
        )
        startup = scripts / "startup" / STARTUP_NAME
        startup.parent.mkdir(parents=True, exist_ok=True)
        startup.write_text(autostart_source(), encoding="utf-8", newline="\n")
        installed.append(str(target))

    if not installed:
        raise RuntimeError("не найдена папка Blender для установки аддона")

    return {**addon_state(), "paths": installed, "mode": "legacy"}


def _build_package(target: Path) -> Path:
    path = target / f"{ADDON_MODULE}-{source_version()}.zip"
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for item in SOURCE.rglob("*"):
            if not item.is_file() or "__pycache__" in item.parts or item.suffix == ".pyc":
                continue
            archive.write(item, item.relative_to(SOURCE).as_posix())
    return path


def install_extension(exe: Path | None = None) -> dict[str, object]:
    exe = exe or find_blender()
    if exe is None:
        raise RuntimeError("Blender не найден на компьютере")

    with tempfile.TemporaryDirectory(prefix="kova-blender-") as temp:
        package = _build_package(Path(temp))
        command = [
            str(exe),
            "--command",
            "extension",
            "install-file",
            str(package),
            "--repo",
            EXTENSION_REPO,
            "--enable",
        ]
        try:
            result = subprocess.run(
                command,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=180,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        except (OSError, subprocess.SubprocessError) as exc:
            raise RuntimeError(f"не удалось установить аддон: {exc}") from exc

    output = ((result.stdout or "") + "\n" + (result.stderr or "")).strip()
    failed = result.returncode != 0 or bool(re.search(r"^ERROR\b", output, re.MULTILINE))
    if failed:
        errors = [line for line in output.splitlines() if line.startswith("ERROR")] or output.splitlines()
        raise RuntimeError("Blender не установил аддон: " + " · ".join(errors[-3:]))

    _remove_legacy()
    return {**addon_state(), "paths": [row[0] for row in _extension_state()], "mode": "extension"}


def install_addon() -> dict[str, object]:
    exe = find_blender()
    if exe is None:
        raise RuntimeError("Blender не найден на компьютере")
    version = _blender_version(str(exe))
    major, minor = (version.split(".") + ["0"])[:2] if version else ("0", "0")
    if (int(major), int(minor)) >= (4, 2):
        return install_extension(exe)
    return install_legacy()


def ensure_addon() -> dict[str, object]:
    state = addon_state()
    if state["installed"] and not state["outdated"]:
        return state
    return install_addon()


def uninstall_addon() -> list[str]:
    removed: list[str] = []
    for repo in extension_dirs():
        target = repo / ADDON_MODULE
        if target.exists():
            shutil.rmtree(target, ignore_errors=True)
            removed.append(str(target))
    for scripts in script_dirs():
        target = scripts / "addons" / ADDON_MODULE
        startup = scripts / "startup" / STARTUP_NAME
        for path in (target, startup):
            if path.exists():
                if path.is_dir():
                    shutil.rmtree(path, ignore_errors=True)
                else:
                    path.unlink(missing_ok=True)
                removed.append(str(path))
    return removed
