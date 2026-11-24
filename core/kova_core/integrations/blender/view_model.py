#! /usr/bin/env python3
"""
Called by the bridge:
    python bridge/blender_bridge.py view --model BladeTest --name BladeTest_front --view front

What it does:
  * finds <Model>_* objects;
  * creates a working camera (_cam_<Model>, excluded from export) and frames the bounds;
  * adds/configures lights and a neutral background for a readable render;
  * prints a report: object names, dimensions in metres and studs, polygon counts.
The bridge performs the render (blender_bridge.py view --render): scene.render.filepath + render.
"""

import bpy
from mathutils import Vector

MODEL = "__MODEL__"
VIEW = "__VIEW__"  # "front" | "side" | "iso" | "top"
CAMERA_PREFIX = "_cam_" + MODEL
LIGHT_PREFIX = "_light_" + MODEL
GROUND_PREFIX = "_ground_" + MODEL

# In Blender 1 unit = 1 m; Roblox studs = m * 20.
STUDS_PER_METER = 20

VIEW_DIRS = {
    "front": Vector((0.0, -1.0, 0.12)),
    "side": Vector((1.0, 0.0, 0.12)),
    "iso": Vector((1.0, -1.0, 0.75)),
    "top": Vector((0.001, -0.001, 1.0)),
}


def objects_of_model():
    return [o for o in bpy.data.objects if o.name.startswith(MODEL + "_") and o.type == "MESH"]


def bounds_of(objs):
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for obj in objs:
        for corner in obj.bound_box:
            p = obj.matrix_world @ Vector(corner)
            lo.x = min(lo.x, p.x)
            lo.y = min(lo.y, p.y)
            lo.z = min(lo.z, p.z)
            hi.x = max(hi.x, p.x)
            hi.y = max(hi.y, p.y)
            hi.z = max(hi.z, p.z)
    center = (lo + hi) / 2.0
    length = max((hi - lo).length, 0.05)
    return center, length, (hi - lo)


def ensure_lighting(center, size):
    """Workbench ignores lights, but EEVEE/Cycles (if the engine changes) do not."""
    for obj in [o for o in bpy.data.objects if o.name.startswith(LIGHT_PREFIX)]:
        bpy.data.objects.remove(obj, do_unlink=True)

    key = bpy.data.objects.new(LIGHT_PREFIX + "key", bpy.data.lights.new(LIGHT_PREFIX + "key", "AREA"))
    key.data.energy = max(8.0, 110.0 * size * size)
    key.data.size = size * 2.0
    key.location = center + Vector((size * 1.6, -size * 1.6, size * 2.2))
    key.rotation_euler = (center - key.location).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.collection.objects.link(key)

    fill = bpy.data.objects.new(LIGHT_PREFIX + "fill", bpy.data.lights.new(LIGHT_PREFIX + "fill", "AREA"))
    fill.data.energy = max(3.0, 35.0 * size * size)
    fill.data.size = size * 2.5
    fill.location = center + Vector((-size * 2.0, -size * 0.5, size * 1.0))
    fill.rotation_euler = (center - fill.location).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.collection.objects.link(fill)

    if "World" not in bpy.data.worlds:
        bpy.data.worlds.new("World")
    world = bpy.data.worlds["World"]
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (0.16, 0.16, 0.18, 1.0)
        bg.inputs[1].default_value = 1.0
    bpy.context.scene.world = world


def make_camera(center, size):
    for obj in [o for o in bpy.data.objects if o.name.startswith(CAMERA_PREFIX)]:
        bpy.data.objects.remove(obj, do_unlink=True)

    cam_data = bpy.data.cameras.new(CAMERA_PREFIX + "data")
    cam = bpy.data.objects.new(CAMERA_PREFIX, cam_data)
    bpy.context.scene.collection.objects.link(cam)

    direction = VIEW_DIRS.get(VIEW, VIEW_DIRS["iso"]).normalized()
    distance = max(size, 0.05) * (2.4 if VIEW in ("front", "side") else 2.8)
    cam.location = center + direction * distance
    cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam_data.lens = 50

    scene = bpy.context.scene
    scene.camera = cam
    scene.render.resolution_x = 1200
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    try:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    except Exception:
        try:
            scene.render.engine = "BLENDER_EEVEE"
        except Exception:
            pass
    if hasattr(scene, "display"):
        scene.display.shading.light = "STUDIO"
        scene.display.shading.color_type = "MATERIAL"
        scene.display.shading.show_object_outline = True
        scene.display.shading.show_cavity = True


def ensure_ground(center, size):
    """Shadow ground under the model for silhouette readability."""
    for obj in [o for o in bpy.data.objects if o.name.startswith(GROUND_PREFIX)]:
        bpy.data.objects.remove(obj, do_unlink=True)
    mesh = bpy.data.meshes.new(GROUND_PREFIX + "mesh")
    ground = bpy.data.objects.new(GROUND_PREFIX, mesh)
    base_z = center.z - size * 0.55
    mesh.from_pydata(
        [(-size * 0.8, -size * 0.8, 0.0), (size * 0.8, -size * 0.8, 0.0),
         (size * 0.8, size * 0.8, 0.0), (-size * 0.8, size * 0.8, 0.0)],
        [], [(0, 1, 2, 3)])
    mat = bpy.data.materials.get(GROUND_PREFIX + "mat") or bpy.data.materials.new(GROUND_PREFIX + "mat")
    mat.diffuse_color = (0.24, 0.24, 0.27, 1.0)
    mesh.materials.append(mat)
    ground.location = (center.x, center.y, base_z)
    if VIEW == "top":
        ground.hide_render = True
    bpy.context.scene.collection.objects.link(ground)
    return ground


def main():
    objs = objects_of_model()
    if not objs:
        raise RuntimeError("no " + MODEL + "_* objects — run the model script first")
    center, size, dims = bounds_of(objs)
    make_camera(center, size)
    ensure_lighting(center, size)
    ensure_ground(center, size)

    polys = sum(len(o.data.polygons) for o in objs)
    print("[%s] VIEW=%s objects=%d polys=%d size=(%.3f, %.3f, %.3f) m = (%.1f, %.1f, %.1f) studs" % (
        MODEL, VIEW, len(objs), polys, dims.x, dims.y, dims.z,
        dims.x * STUDS_PER_METER, dims.y * STUDS_PER_METER, dims.z * STUDS_PER_METER))
    for obj in objs:
        print("  - %s polys=%d" % (obj.name, len(obj.data.polygons)))

    payload = {
        "model": MODEL,
        "view": VIEW,
        "objects": [o.name for o in objs],
        "polygons": polys,
        "size_m": [round(dims.x, 4), round(dims.y, 4), round(dims.z, 4)],
        "size_studs": [round(dims.x * STUDS_PER_METER, 2), round(dims.y * STUDS_PER_METER, 2), round(dims.z * STUDS_PER_METER, 2)],
    }
    try:
        report(payload)  # provided by the bridge bootstrap
    except NameError:
        pass
    # Ask Blender to redraw the viewport before the screenshot.
    try:
        bpy.ops.wm.redraw_timer(type="DRAW_WIN_SWAP", iterations=2)
    except Exception:
        pass


main()