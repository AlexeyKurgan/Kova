import json
import math
import os
import traceback
from pathlib import Path

import bpy
from mathutils import Vector

ASSET = os.environ.get("KOVA_ASSET_PATH", "")
RENDER = os.environ.get("KOVA_RENDER_PATH", "")
FRAMES_DIR = os.environ.get("KOVA_RENDER_FRAMES_DIR", "")
FRAME_COUNT = max(2, min(12, int(os.environ.get("KOVA_RENDER_FRAMES") or "7")))


def emit(payload: dict) -> None:
    print("---KOVA_JSON---")
    print(json.dumps(payload, ensure_ascii=False))


def reset_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_asset(path: Path) -> None:
    suffix = path.suffix.lower()
    if suffix == ".blend":
        bpy.ops.wm.open_mainfile(filepath=str(path))
        return

    reset_scene()
    if suffix in {".glb", ".gltf"}:
        bpy.ops.import_scene.gltf(filepath=str(path))
    elif suffix == ".fbx":
        bpy.ops.import_scene.fbx(filepath=str(path))
    elif suffix == ".obj":
        try:
            bpy.ops.wm.obj_import(filepath=str(path))
        except Exception:
            bpy.ops.import_scene.obj(filepath=str(path))
    else:
        raise RuntimeError(f"Формат {suffix or 'без расширения'} не поддерживается Blender-мостом")


def collect_metrics() -> dict:
    scene = bpy.context.scene
    meshes = [obj for obj in scene.objects if obj.type == "MESH"]
    triangles = 0
    vertices = 0
    for obj in meshes:
        mesh = obj.data
        mesh.calc_loop_triangles()
        triangles += len(mesh.loop_triangles)
        vertices += len(mesh.vertices)

    materials = {
        material.name
        for obj in meshes
        for material in obj.data.materials
        if material is not None
    }
    images = [
        image
        for image in bpy.data.images
        if image.type == "IMAGE" and image.source == "FILE"
    ]
    missing_textures = []
    for image in images:
        if image.packed_file is not None:
            continue
        resolved = bpy.path.abspath(image.filepath)
        if resolved and not Path(resolved).is_file():
            missing_textures.append(image.filepath)

    armatures = [obj for obj in scene.objects if obj.type == "ARMATURE"]
    bones = sum(len(obj.data.bones) for obj in armatures)

    return {
        "objects": len(meshes),
        "triangles": triangles,
        "vertices": vertices,
        "materials": len(materials),
        "textures": len(images),
        "bones": bones,
        "animations": len(bpy.data.actions),
        "missing_textures": missing_textures,
        "scene": collect_scene(),
    }


def collect_scene() -> list[dict]:
    scene = bpy.context.scene
    rows: list[dict] = []
    for obj in list(scene.objects)[:500]:
        if obj.type not in {"MESH", "ARMATURE", "EMPTY", "LIGHT", "CAMERA"}:
            continue
        vertices = 0
        triangles = 0
        materials: list[str] = []
        if obj.type == "MESH" and obj.data is not None:
            mesh = obj.data
            mesh.calc_loop_triangles()
            vertices = len(mesh.vertices)
            triangles = len(mesh.loop_triangles)
            materials = [
                material.name
                for material in mesh.materials
                if material is not None
            ]
        rows.append(
            {
                "name": obj.name,
                "type": obj.type,
                "parent": obj.parent.name if obj.parent is not None else "",
                "vertices": vertices,
                "triangles": triangles,
                "materials": materials,
                "location": [round(value, 4) for value in obj.location],
                "rotation": [round(value, 4) for value in obj.rotation_euler],
                "scale": [round(value, 4) for value in obj.scale],
                "dimensions": [round(value, 4) for value in obj.dimensions],
            }
        )
    return rows


def _prepare_scene(scene) -> None:
    meshes = [obj for obj in scene.objects if obj.type == "MESH"]
    if not meshes:
        raise RuntimeError("нет мешей для рендера")

    mins = Vector((math.inf, math.inf, math.inf))
    maxs = Vector((-math.inf, -math.inf, -math.inf))
    frame_start, frame_end, _fps = _animation_range()
    original_frame = scene.frame_current
    sample_frames = (
        [frame_start, (frame_start + frame_end) // 2, frame_end]
        if frame_end > frame_start
        else [original_frame]
    )
    for sample in sample_frames:
        scene.frame_set(sample)
        for obj in meshes:
            for corner in obj.bound_box:
                point = obj.matrix_world @ Vector(corner)
                mins.x = min(mins.x, point.x)
                mins.y = min(mins.y, point.y)
                mins.z = min(mins.z, point.z)
                maxs.x = max(maxs.x, point.x)
                maxs.y = max(maxs.y, point.y)
                maxs.z = max(maxs.z, point.z)
    scene.frame_set(original_frame)

    center = (mins + maxs) / 2
    dimensions = maxs - mins
    size = max(dimensions.x, dimensions.y, dimensions.z, 0.1)

    camera_data = bpy.data.cameras.new("KovaPreviewCamera")
    camera = bpy.data.objects.new("KovaPreviewCamera", camera_data)
    scene.collection.objects.link(camera)
    direction = Vector((1.0, -1.0, 0.75)).normalized()
    camera.location = center + direction * (size * 3.0)
    look = center - camera.location
    camera.rotation_euler = look.to_track_quat("-Z", "Y").to_euler()
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = size * 2.4
    scene.camera = camera

    light_data = bpy.data.lights.new("KovaPreviewLight", type="AREA")
    light_data.energy = 900
    light_data.size = max(size, 4)
    light = bpy.data.objects.new("KovaPreviewLight", light_data)
    scene.collection.objects.link(light)
    light.location = center + Vector((2.5, -3.0, 4.0)) * max(size, 1.0)
    light_look = center - light.location
    light.rotation_euler = light_look.to_track_quat("-Z", "Y").to_euler()

    world = bpy.data.worlds.new("KovaPreviewWorld")
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    if background:
        background.inputs["Color"].default_value = (0.09, 0.11, 0.14, 1.0)
        background.inputs["Strength"].default_value = 1.2
    scene.world = world

    scene.render.resolution_x = 512
    scene.render.resolution_y = 512
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.view_transform = "Standard"
    try:
        scene.render.engine = "BLENDER_WORKBENCH"
        scene.display.shading.light = "STUDIO"
        scene.display.shading.color_type = "MATERIAL"
        scene.display.shading.show_shadows = True
        scene.display.shading.show_cavity = True
        scene.display.shading.cavity_type = "WORLD"
        scene.display.render_aa = "8"
    except Exception:
        scene.render.engine = "CYCLES"
        scene.cycles.device = "CPU"
        scene.cycles.samples = 16
        scene.cycles.use_denoising = False


def _render_still(scene, path: Path) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    return str(path) if path.is_file() else ""


def render_preview(path: Path) -> str:
    scene = bpy.context.scene
    _prepare_scene(scene)
    return _render_still(scene, path)


def _animation_range() -> tuple[int, int, float]:
    scene = bpy.context.scene
    starts: list[int] = []
    ends: list[int] = []
    actions = [
        action
        for action in bpy.data.actions
        if getattr(action, "users", 0) or getattr(action, "use_fake_user", False)
    ]
    for action in actions:
        try:
            start, end = action.frame_range
        except Exception:
            continue
        starts.append(int(round(start)))
        ends.append(int(round(end)))
    if not starts and scene.frame_end > scene.frame_start:
        starts.append(int(scene.frame_start))
        ends.append(int(scene.frame_end))
    if not starts:
        return 0, 0, 0.0
    start = min(starts)
    end = max(ends)
    if end < start:
        start, end = end, start
    fps = float(scene.render.fps) / float(scene.render.fps_base or 1.0)
    return start, end, fps


def render_animation_frames(scene, directory: Path, start: int, end: int) -> list[dict[str, object]]:
    directory.mkdir(parents=True, exist_ok=True)
    if end <= start:
        picks = [start]
    else:
        picks = sorted(
            {
                int(round(start + (end - start) * index / (FRAME_COUNT - 1)))
                for index in range(FRAME_COUNT)
            }
        )
    rows: list[dict[str, object]] = []
    for frame in picks:
        scene.frame_set(frame)
        target = directory / f"frame_{frame:04d}.png"
        rendered = _render_still(scene, target)
        if rendered:
            rows.append({"frame": frame, "path": rendered})
    return rows


def main() -> None:
    try:
        if not ASSET:
            raise RuntimeError("KOVA_ASSET_PATH не задан")
        asset_path = Path(ASSET)
        if not asset_path.is_file():
            raise RuntimeError(f"Файл не найден: {ASSET}")

        import_asset(asset_path)
        metrics = collect_metrics()
        rendered = ""
        frames: list[dict[str, object]] = []
        frame_start = 0
        frame_end = 0
        fps = 0.0
        if RENDER and metrics["objects"] > 0:
            try:
                scene = bpy.context.scene
                _prepare_scene(scene)
                rendered = _render_still(scene, Path(RENDER))
                if FRAMES_DIR and (metrics.get("animations") or 0) > 0:
                    frame_start, frame_end, fps = _animation_range()
                    if frame_end >= frame_start:
                        frames = render_animation_frames(
                            scene,
                            Path(FRAMES_DIR),
                            frame_start,
                            frame_end,
                        )
            except Exception as render_error:
                metrics["render_error"] = str(render_error)

        emit(
            {
                "ok": True,
                "metrics": metrics,
                "rendered": bool(rendered),
                "frames": frames,
                "frame_start": frame_start,
                "frame_end": frame_end,
                "fps": fps,
            }
        )
    except Exception as error:
        emit(
            {
                "ok": False,
                "error": str(error),
                "trace": traceback.format_exc(),
            }
        )


main()
