import bpy

MODEL = "__MODEL__"
PREFIX = MODEL + "_"
COLLECTION = "Models"


def purge_previous():
    for obj in [item for item in bpy.data.objects if item.name.startswith(PREFIX)]:
        data = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        if data is not None and data.users == 0:
            bpy.data.meshes.remove(data)


def collection():
    found = bpy.data.collections.get(COLLECTION)
    if found is None:
        found = bpy.data.collections.new(COLLECTION)
        bpy.context.scene.collection.children.link(found)
    return found


def material():
    found = bpy.data.materials.get(PREFIX + "Material")
    if found is None:
        found = bpy.data.materials.new(PREFIX + "Material")
        found.diffuse_color = (0.72, 0.45, 0.28, 1.0)
        found.use_nodes = True
        shader = next(
            (node for node in found.node_tree.nodes if node.type == "BSDF_PRINCIPLED"),
            None,
        )
        if shader is not None:
            shader.inputs["Base Color"].default_value = (0.72, 0.45, 0.28, 1.0)
            shader.inputs["Roughness"].default_value = 0.55
    return found


def build():
    purge_previous()
    target = collection()

    bpy.ops.mesh.primitive_cube_add(size=0.5)
    obj = bpy.context.active_object
    obj.name = PREFIX + "Body"
    for owner in list(obj.users_collection):
        owner.objects.unlink(obj)
    target.objects.link(obj)
    obj.data.materials.append(material())

    bevel = obj.modifiers.new("Bevel", "BEVEL")
    bevel.width = 0.02
    bevel.segments = 2

    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)


def main():
    build()
    polys = sum(
        len(obj.data.polygons)
        for obj in bpy.data.objects
        if obj.name.startswith(PREFIX) and obj.type == "MESH"
    )
    print(f"[{MODEL}] objects built, total polygons = {polys}")
    bpy.context.view_layer.update()


main()
