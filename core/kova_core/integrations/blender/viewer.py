import os
import subprocess
from pathlib import Path

from ...security.paths import resolve_inside
from .bridge import find_blender

SCRIPT = r'''
import os
import bpy

source = os.environ["KOVA_VIEWER_SOURCE"]
target = os.environ["KOVA_VIEWER_TARGET"]
suffix = os.path.splitext(source)[1].lower()

if suffix == ".blend":
    bpy.ops.wm.open_mainfile(filepath=source)
else:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    if suffix == ".fbx":
        bpy.ops.import_scene.fbx(filepath=source)
    elif suffix == ".obj":
        try:
            bpy.ops.wm.obj_import(filepath=source)
        except Exception:
            bpy.ops.import_scene.obj(filepath=source)
    elif suffix == ".gltf":
        bpy.ops.import_scene.gltf(filepath=source)
    else:
        raise RuntimeError("unsupported format: " + suffix)

objects = [
    item for item in bpy.context.scene.objects
    if item.type not in {"CAMERA", "LIGHT"}
]
if not objects:
    raise RuntimeError("no renderable objects in asset")

bpy.ops.object.select_all(action="DESELECT")
for item in objects:
    item.select_set(True)
bpy.context.view_layer.objects.active = objects[0]

os.makedirs(os.path.dirname(target), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=target,
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_yup=True,
)
print("VIEWER_EXPORTED", target)
'''


def viewer_glb(hub: Path, asset, version=None) -> Path:
    source_path = version.path if version and version.path else asset.path
    file_hash = version.file_hash if version and version.file_hash else asset.file_hash
    key = version.id if version else (asset.current_version_id or "current")
    source = resolve_inside(hub.parent, source_path)
    if not source.is_file():
        raise FileNotFoundError(f"Файл ассета не найден: {source_path}")

    cache = resolve_inside(
        hub,
        Path("artifacts")
        / "viewer"
        / f"{asset.id}_{key}_{file_hash[:12] or 'nohash'}.glb",
    )
    if cache.is_file():
        return cache

    exe = find_blender()
    if exe is None:
        raise FileNotFoundError("Blender не найден — 3D-просмотр этого формата недоступен")

    cache.parent.mkdir(parents=True, exist_ok=True)
    script = cache.parent / f"{asset.id}_{key}_export.py"
    script.write_text(SCRIPT, encoding="utf-8")
    env = os.environ.copy()
    env["KOVA_VIEWER_SOURCE"] = str(source)
    env["KOVA_VIEWER_TARGET"] = str(cache)

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
            timeout=240,
            env=env,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("Blender не успел подготовить 3D-просмотр") from exc

    if not cache.is_file():
        output = ((process.stdout or "") + "\n" + (process.stderr or "")).strip()
        tail = "\n".join(output.splitlines()[-5:])
        raise RuntimeError(f"Не удалось подготовить 3D-просмотр: {tail}")
    script.unlink(missing_ok=True)
    return cache
