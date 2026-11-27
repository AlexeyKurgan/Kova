import hashlib
import os
import shutil
import subprocess
from functools import lru_cache
from pathlib import Path

from ...domain.asset import AssetMetrics, AssetPassport, AssetPreviewFrame, SceneObject
from ...security.paths import resolve_inside

MARKER = "---KOVA_JSON---"


def find_blender() -> Path | None:
    candidates: list[Path] = []
    override = os.environ.get("KOVA_BLENDER")
    if override:
        candidates.append(Path(override))

    which = shutil.which("blender")
    if which:
        candidates.append(Path(which))

    bases = [
        Path(base)
        for base in (os.environ.get("ProgramFiles"), os.environ.get("LOCALAPPDATA"))
        if base
    ]
    for base in bases:
        for root in (
            base / "Blender Foundation",
            base / "Programs" / "Blender Foundation",
        ):
            if root.is_dir():
                candidates.extend(sorted(root.glob("Blender */blender.exe"), reverse=True))

    for candidate in candidates:
        if candidate.is_file():
            return candidate
    return None


@lru_cache(maxsize=8)
def _version(exe: str) -> str:
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
    return (result.stdout or "").splitlines()[0].strip() if result.stdout else ""


def blender_status() -> dict[str, object]:
    exe = find_blender()
    if exe is None:
        return {"installed": False, "path": "", "version": ""}
    return {"installed": True, "path": str(exe), "version": _version(str(exe))}


def blender_running() -> bool:
    if os.name == "nt":
        try:
            result = subprocess.run(
                ["tasklist", "/FI", "IMAGENAME eq blender.exe", "/NH"],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=10,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        except (OSError, subprocess.SubprocessError):
            return False
        return "blender.exe" in (result.stdout or "").lower()

    try:
        result = subprocess.run(
            ["pgrep", "-x", "blender"],
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return result.returncode == 0


def launch_blender(file_path: Path | None = None) -> int:
    exe = find_blender()
    if exe is None:
        raise FileNotFoundError("Blender не найден на компьютере")

    args = [str(exe)]
    if file_path is not None:
        args.append(str(file_path))

    flags = 0
    if os.name == "nt":
        flags = 0x00000008 | 0x00000200

    process = subprocess.Popen(
        args,
        cwd=str(file_path.parent) if file_path is not None else None,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        close_fds=True,
        creationflags=flags,
    )
    return process.pid


def inspect_asset(hub: Path, asset: AssetPassport) -> dict[str, object]:
    exe = find_blender()
    if exe is None:
        raise FileNotFoundError("Blender не найден на компьютере")

    asset_path = resolve_inside(hub.parent, asset.path)
    if not asset_path.is_file():
        raise FileNotFoundError(f"Файл ассета не найден: {asset.path}")

    suffix = f"_{asset.current_version_id}" if asset.current_version_id else ""
    preview = resolve_inside(
        hub,
        Path("artifacts") / "previews" / f"{asset.id}{suffix}.png",
    )
    preview.parent.mkdir(parents=True, exist_ok=True)
    preview.unlink(missing_ok=True)
    frames_dir = resolve_inside(
        hub,
        Path("artifacts") / "previews" / f"{asset.id}{suffix}_frames",
    )
    if frames_dir.is_dir():
        shutil.rmtree(frames_dir, ignore_errors=True)

    script = Path(__file__).with_name("inspect_asset.py")
    env = os.environ.copy()
    env["KOVA_ASSET_PATH"] = str(asset_path)
    env["KOVA_RENDER_PATH"] = str(preview)
    env["KOVA_RENDER_FRAMES_DIR"] = str(frames_dir)
    env["KOVA_RENDER_FRAMES"] = "7"

    try:
        process = subprocess.run(
            [
                str(exe),
                "--background",
                "--factory-startup",
                "--python",
                str(script),
            ],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=300,
            env=env,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("Blender не уложился в 4 минуты") from exc

    output = (process.stdout or "") + "\n" + (process.stderr or "")
    payload: dict[str, object] | None = None
    for line in output.splitlines():
        if line.strip() == MARKER:
            continue
        if line.lstrip().startswith("{"):
            try:
                import json

                data = json.loads(line)
            except ValueError:
                continue
            if isinstance(data, dict) and "ok" in data:
                payload = data

    if payload is None:
        raise RuntimeError(
            "Blender не вернул результат. Проверь, что файл открывается вручную."
        )
    if not payload.get("ok"):
        raise RuntimeError(str(payload.get("error") or "Blender не смог открыть файл"))

    metrics = payload.get("metrics") or {}
    asset.metrics = AssetMetrics(
        objects=int(metrics.get("objects") or 0),
        triangles=int(metrics.get("triangles") or 0),
        vertices=int(metrics.get("vertices") or 0),
        materials=int(metrics.get("materials") or 0),
        textures=int(metrics.get("textures") or 0),
        bones=int(metrics.get("bones") or 0),
        animations=int(metrics.get("animations") or 0),
    )
    scene_rows = metrics.get("scene") or []
    asset.scene = [
        SceneObject(
            name=str(row.get("name") or ""),
            type=str(row.get("type") or ""),
            parent=str(row.get("parent") or ""),
            vertices=int(row.get("vertices") or 0),
            triangles=int(row.get("triangles") or 0),
            materials=[str(item) for item in (row.get("materials") or [])],
            location=[float(item) for item in (row.get("location") or [])],
            rotation=[float(item) for item in (row.get("rotation") or [])],
            scale=[float(item) for item in (row.get("scale") or [])],
            dimensions=[float(item) for item in (row.get("dimensions") or [])],
        )
        for row in scene_rows[:500]
        if isinstance(row, dict)
    ]
    asset.preview = (
        preview.relative_to(hub).as_posix() if preview.is_file() else ""
    )
    frame_rows = payload.get("frames") or []
    frames: list[AssetPreviewFrame] = []
    if isinstance(frame_rows, list):
        for row in frame_rows:
            if not isinstance(row, dict):
                continue
            try:
                frame_path = Path(str(row.get("path") or "")).resolve()
                relative = frame_path.relative_to(hub.resolve()).as_posix()
                frame_number = int(row.get("frame") or 0)
            except (OSError, ValueError):
                continue
            if frame_path.is_file():
                frames.append(AssetPreviewFrame(frame=frame_number, path=relative))
    asset.preview_frames = sorted(frames, key=lambda item: item.frame)
    try:
        asset.frame_start = int(payload.get("frame_start") or 0)
        asset.frame_end = int(payload.get("frame_end") or 0)
        asset.fps = float(payload.get("fps") or 0)
    except (TypeError, ValueError):
        asset.frame_start = 0
        asset.frame_end = 0
        asset.fps = 0

    return {
        "metrics": dict(metrics),
        "preview": asset.preview,
        "frames": len(asset.preview_frames),
        "objects": int(metrics.get("objects") or 0),
        "missing_textures": list(metrics.get("missing_textures") or []),
    }
