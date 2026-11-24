import json
import math
import os
import traceback
from pathlib import Path

import bpy
from mathutils import Vector

ASSET = os.environ.get("KOVA_ASSET_PATH", "")
RENDER = os.environ.get("KOVA_RENDER_PATH", "")


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
    }


def render_preview(path: Path) -> str:
    scene = bpy.context.scene
    meshes = [obj for obj in scene.objects if obj.type == "MESH"]
    if not meshes:
        return ""

    mins = Vector((math.inf, math.inf, math.inf))
    maxs = Vector((-math.inf, -math.inf, -math.inf))
    for obj in meshes:
        for corner in obj.bound_box:
            point = obj.matrix_world @ Vector(corner)
            mins.x = min(mins.x, point.x)
            mins.y = min(mins.y, point.y)
            mins.z = min(mins.z, point.z)
            maxs.x = max(maxs.x, point.x)
            maxs.y = max(maxs.y, point.y)
            maxs.z = max(maxs.z, point.z)

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
    camera.data.ortho_scale = size * 1.8
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
    scene.render.filepath = str(path)
    scene.view_settings.view_transform = "Standard"

    try:
        scene.render.engine = "BLENDER_WORKBENCH"
        scene.display.shading.light = "STUDIO"
        scene.display.shading.color_type = "MATERIAL"
        scene.display.shading.show_shadows = True
        scene.display.shading.show_cavity = True
        scene.display.shading.cavity_type = "WORLD"
        scene.display.render_aa = "8"
        path.parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.render.render(write_still=True)
    except Exception:
        scene.render.engine = "CYCLES"
        scene.cycles.device = "CPU"
        scene.cycles.samples = 16
        scene.cycles.use_denoising = False
        path.parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.render.render(write_still=True)

    return str(path) if path.is_file() else ""


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
        if RENDER and metrics["objects"] > 0:
            try:
                rendered = render_preview(Path(RENDER))
            except Exception as render_error:
                metrics["render_error"] = str(render_error)

        emit(
            {
                "ok": True,
                "metrics": metrics,
                "rendered": bool(rendered),
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
