"""Small demo model for Kova Studio: a stylized sword.

Copy this file into ModelScripts/DemoSword/DemoSword.py, then:

    kova.run DemoSword
    kova.render DemoSword
    kova.qa DemoSword
    kova.card DemoSword
    kova.export DemoSword
"""

import bpy
import bmesh
from mathutils import Vector

PREFIX = "DemoSword"


def _material(name, color, metallic, roughness):
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1.0)
    mat.metallic = metallic
    mat.roughness = roughness
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    return mat


def _mesh(name, build, mat):
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    build(bm)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    mesh.materials.append(mat)
    return obj


def _box(size, location, bevel=0.0):
    def build(bm):
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
        if bevel > 0:
            bmesh.ops.bevel(
                bm,
                geom=list(bm.edges),
                offset=bevel,
                segments=2,
                affect="EDGES",
            )
        bmesh.ops.translate(bm, vec=Vector(location), verts=bm.verts)

    return build


def _cone(radius, depth, location, segments=16):
    def build(bm):
        bmesh.ops.create_cone(
            bm,
            cap_ends=True,
            cap_tris=True,
            segments=segments,
            radius1=radius,
            radius2=radius,
            depth=depth,
        )
        bmesh.ops.translate(bm, vec=Vector(location), verts=bm.verts)

    return build


def _tip(radius, depth, location):
    def build(bm):
        bmesh.ops.create_cone(
            bm,
            cap_ends=True,
            cap_tris=True,
            segments=4,
            radius1=radius,
            radius2=0.0,
            depth=depth,
        )
        bmesh.ops.translate(bm, vec=Vector(location), verts=bm.verts)

    return build


def clear():
    for obj in list(bpy.data.objects):
        if obj.name.startswith(PREFIX + "_"):
            bpy.data.objects.remove(obj, do_unlink=True)
    for mat in list(bpy.data.materials):
        if mat.name.startswith(PREFIX + "_"):
            bpy.data.materials.remove(mat)


def build():
    clear()
    steel = _material(PREFIX + "_Steel", (0.16, 0.18, 0.22), 0.9, 0.28)
    gold = _material(PREFIX + "_Gold", (0.72, 0.48, 0.16), 1.0, 0.3)
    leather = _material(PREFIX + "_Leather", (0.14, 0.06, 0.035), 0.0, 0.82)

    _mesh(PREFIX + "_Blade", _box((0.12, 0.026, 1.22), (0, 0, 0.88), 0.008), steel)
    _mesh(PREFIX + "_Tip", _tip(0.06, 0.22, (0, 0, 1.60)), steel)
    _mesh(PREFIX + "_Guard", _box((0.38, 0.07, 0.06), (0, 0, 0.20), 0.012), gold)
    _mesh(PREFIX + "_Grip", _cone(0.055, 0.34, (0, 0, -0.03)), leather)
    _mesh(PREFIX + "_Pommel", _box((0.11, 0.11, 0.10), (0, 0, -0.24), 0.018), gold)
    _mesh(PREFIX + "_Gem", _box((0.05, 0.075, 0.05), (0, 0, 0.20), 0.01), gold)

    print(f"{PREFIX}: {len([o for o in bpy.data.objects if o.name.startswith(PREFIX + '_')])} parts")


build()
