import os
import shutil
import subprocess
from pathlib import Path

from pydantic import BaseModel

from ...domain.asset import AssetPassport
from ...domain.enums import AssetType, Engine
from ...security.paths import resolve_inside

ENGINE_NAMES = {
    Engine.generic: "Без движка",
    Engine.blender: "Blender",
    Engine.roblox: "Roblox",
    Engine.godot: "Godot",
    Engine.unity: "Unity",
    Engine.unreal: "Unreal",
    Engine.rpgmaker: "RPG Maker",
    Engine.web: "Web",
}

IMPORT_FORMATS = {
    Engine.godot: [".glb", ".gltf", ".fbx", ".png", ".webp", ".ogg", ".mp3"],
    Engine.unity: [".fbx", ".glb", ".gltf", ".png", ".wav", ".mp3"],
    Engine.unreal: [".fbx", ".glb", ".png", ".wav"],
    Engine.rpgmaker: [".png", ".ogg", ".mp3", ".wav"],
    Engine.web: [".glb", ".gltf", ".png", ".webp", ".mp3", ".ogg"],
}

IMPORT_DIRS = {
    Engine.godot: "assets/kova",
    Engine.unity: "Assets/Kova",
    Engine.unreal: "Content/Kova/Source",
    Engine.web: "public/assets",
}


class EngineInfo(BaseModel):
    engine: Engine
    name: str
    installed: bool = False
    executable: str = ""
    version: str = ""
    project_detected: bool = False
    project_file: str = ""
    import_dir: str = ""
    formats: list[str] = []
    message: str = ""


def _run_version(exe: str, args: list[str]) -> str:
    try:
        result = subprocess.run(
            [exe, *args],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=20,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except (OSError, subprocess.SubprocessError):
        return ""
    return (result.stdout or result.stderr or "").splitlines()[0].strip()


def _first_file(patterns: list[str]) -> str:
    for pattern in patterns:
        matches = sorted(Path().glob(pattern), reverse=True)
        if matches:
            return str(matches[0])
    return ""


def _find_godot() -> str:
    override = os.environ.get("KOVA_GODOT")
    if override and Path(override).is_file():
        return override
    for command in ("godot", "godot4", "godot.exe"):
        found = shutil.which(command)
        if found:
            return found
    bases = [os.environ.get("ProgramFiles", ""), os.environ.get("LOCALAPPDATA", "")]
    for base in bases:
        if not base:
            continue
        root = Path(base)
        for pattern in ("Godot/Godot*.exe", "Programs/Godot/Godot*.exe"):
            rows = sorted(root.glob(pattern), reverse=True)
            if rows:
                return str(rows[0])
    return ""


def _find_unity() -> str:
    override = os.environ.get("KOVA_UNITY")
    if override and Path(override).is_file():
        return override
    for base in (Path("C:/Program Files"), Path("C:/Program Files (x86)")):
        for pattern in ("Unity/Hub/Editor/*/Editor/Unity.exe", "Unity*/Editor/Unity.exe"):
            rows = sorted(base.glob(pattern), reverse=True)
            if rows:
                return str(rows[0])
    return ""


def _find_unreal() -> str:
    override = os.environ.get("KOVA_UNREAL")
    if override and Path(override).is_file():
        return override
    base = Path("C:/Program Files/Epic Games")
    for pattern in (
        "UE_*/Engine/Binaries/Win64/UnrealEditor.exe",
        "UE_*/Engine/Binaries/Win64/UnrealEditor-Cmd.exe",
    ):
        if base.is_dir():
            rows = sorted(base.glob(pattern), reverse=True)
            if rows:
                return str(rows[0])
    return ""


def _project_file(root: Path, engine: Engine) -> Path | None:
    if engine == Engine.godot:
        candidate = root / "project.godot"
        return candidate if candidate.is_file() else None
    if engine == Engine.unity:
        candidate = root / "ProjectSettings" / "ProjectVersion.txt"
        return candidate if candidate.is_file() else None
    if engine == Engine.unreal:
        rows = sorted(root.glob("*.uproject"))
        return rows[0] if rows else None
    if engine == Engine.rpgmaker:
        for name in ("game.rmmzproject", "Game.rmmzproject", "data/System.json"):
            candidate = root / name
            if candidate.is_file():
                return candidate
        return None
    if engine == Engine.web:
        for name in ("package.json", "index.html", "vite.config.ts", "vite.config.js"):
            candidate = root / name
            if candidate.is_file():
                return candidate
        return None
    return None


def detect_engine(engine: Engine, root: Path) -> EngineInfo:
    name = ENGINE_NAMES.get(engine, engine.value)
    if engine in (Engine.generic, Engine.blender, Engine.roblox):
        return EngineInfo(
            engine=engine,
            name=name,
            installed=True,
            message="Используется существующий мост Kova.",
        )

    executable = ""
    version = ""
    if engine == Engine.godot:
        executable = _find_godot()
        if executable:
            version = _run_version(executable, ["--version"])
    elif engine == Engine.unity:
        executable = _find_unity()
    elif engine == Engine.unreal:
        executable = _find_unreal()
        if executable:
            version = Path(executable).parents[3].name if len(Path(executable).parents) > 3 else ""
    elif engine == Engine.web:
        executable = shutil.which("node") or shutil.which("node.exe") or ""
        if executable:
            version = _run_version(executable, ["--version"])

    project = _project_file(root, engine)
    if engine == Engine.unity and project is not None:
        try:
            version = project.read_text(encoding="utf-8", errors="replace").splitlines()[0].strip()
        except OSError:
            pass
    if engine == Engine.rpgmaker:
        installed = project is not None
    elif engine == Engine.web:
        installed = bool(executable) or project is not None
    else:
        installed = bool(executable)

    import_dir = IMPORT_DIRS.get(engine, "")
    if engine == Engine.rpgmaker:
        import_dir = "img/pictures"
    messages = []
    if not installed:
        messages.append(f"{name} не найден на компьютере")
    if project is None:
        messages.append(f"В проекте нет файла {name}")
    if installed and project is not None:
        messages.append("Готов к импорту")
    return EngineInfo(
        engine=engine,
        name=name,
        installed=installed,
        executable=executable,
        version=version,
        project_detected=project is not None,
        project_file=str(project) if project is not None else "",
        import_dir=import_dir,
        formats=IMPORT_FORMATS.get(engine, []),
        message=" · ".join(messages),
    )


def _target_dir(engine: Engine, asset: AssetPassport) -> Path:
    if engine == Engine.rpgmaker:
        if asset.type == AssetType.texture:
            return Path("img") / "pictures"
        if asset.type == AssetType.audio:
            return Path("audio") / "se"
        return Path("data") / "kova"
    return Path(IMPORT_DIRS.get(engine, "assets/kova"))


def import_asset_to_engine(
    engine: Engine,
    root: Path,
    hub: Path,
    asset: AssetPassport,
) -> dict[str, object]:
    info = detect_engine(engine, root)
    if not info.installed:
        raise RuntimeError(info.message or f"{info.name} не найден")
    if not info.project_detected:
        raise RuntimeError(info.message or f"Проект {info.name} не найден")

    source = resolve_inside(hub.parent, asset.path)
    if not source.is_file():
        raise FileNotFoundError(f"файл ассета не найден: {asset.path}")
    suffix = source.suffix.lower()
    if suffix not in info.formats:
        raise RuntimeError(
            f"{suffix or 'без расширения'} не поддерживается для {info.name}: "
            + ", ".join(info.formats)
        )

    relative_dir = _target_dir(engine, asset)
    target_dir = resolve_inside(root, relative_dir)
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / source.name
    counter = 1
    while target.exists() and target.read_bytes() != source.read_bytes():
        target = target_dir / f"{source.stem}_{counter}{source.suffix}"
        counter += 1
    shutil.copy2(source, target)
    return {
        "engine": engine.value,
        "target": str(target),
        "relative": target.relative_to(root).as_posix(),
        "size": target.stat().st_size,
    }
