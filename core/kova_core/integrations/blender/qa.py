import json
from datetime import datetime
from pathlib import Path

from .client import BridgeClient, BridgeError
from .workspace import model_script, workspace_root

MARKER = "__KOVA_QA__"

QA_CODE = r'''
import bpy
import bmesh
import json

MODEL = __MODEL__
PREFIX = MODEL + "_"
issues = []
objects = []


def issue(severity, code, message, obj=""):
    issues.append({"severity": severity, "code": code, "message": message, "object": obj})


def object_issues(obj):
    if obj.type != "MESH" or obj.data is None:
        return
    mesh = obj.data
    bm = bmesh.new()
    try:
        bm.from_mesh(mesh)
        non_manifold = sum(1 for edge in bm.edges if not edge.is_manifold)
        boundary = sum(1 for edge in bm.edges if edge.is_boundary)
        loose = sum(1 for vert in bm.verts if not vert.link_edges)
        degenerate = sum(1 for face in bm.faces if face.calc_area() < 1e-10)
        ngons = sum(1 for face in bm.faces if len(face.verts) > 4)
        tris = sum(max(0, len(face.verts) - 2) for face in bm.faces)
    finally:
        bm.free()

    entry = {
        "name": obj.name,
        "vertices": len(mesh.vertices),
        "edges": len(mesh.edges),
        "polygons": len(mesh.polygons),
        "tris": tris,
        "ngons": ngons,
        "non_manifold": non_manifold,
        "boundary": boundary,
        "loose": loose,
        "degenerate": degenerate,
        "materials": [slot.material.name for slot in obj.material_slots if slot.material],
        "uv_layers": len(mesh.uv_layers),
        "scale": [round(float(value), 4) for value in obj.scale],
        "rotation": [round(float(value), 4) for value in obj.rotation_euler],
        "dimensions": [round(float(value), 4) for value in obj.dimensions],
    }
    objects.append(entry)

    if not entry["vertices"]:
        issue("error", "empty_mesh", "mesh has no vertices", obj.name)
    if degenerate:
        issue("error", "degenerate_faces", f"{degenerate} zero-area faces", obj.name)
    if non_manifold:
        issue("warn", "non_manifold", f"{non_manifold} non-manifold edges", obj.name)
    if boundary:
        issue("warn", "boundary_edges", f"{boundary} open boundary edges", obj.name)
    if loose:
        issue("warn", "loose_geometry", f"{loose} loose vertices", obj.name)
    if ngons:
        issue("warn", "ngons", f"{ngons} ngons (5+ sides)", obj.name)
    if not entry["materials"]:
        issue("warn", "no_materials", "object has no materials", obj.name)
    if entry["uv_layers"] == 0:
        textured = False
        for material in obj.data.materials:
            if material and material.use_nodes and material.node_tree:
                textured = any(node.type == "TEX_IMAGE" for node in material.node_tree.nodes)
        if textured:
            issue("warn", "missing_uv", "image textures require UVs", obj.name)
    if any(abs(float(value) - 1.0) > 1e-4 for value in obj.scale) or any(abs(float(value)) > 1e-4 for value in obj.rotation_euler):
        issue("warn", "unapplied_transform", "apply rotation and scale before export", obj.name)
    if any(float(value) < 0 for value in obj.scale):
        issue("error", "negative_scale", "negative object scale", obj.name)
    if max(entry["dimensions"], default=0) <= 0:
        issue("error", "zero_dimensions", "object has zero size", obj.name)


model_objects = [obj for obj in bpy.data.objects if obj.name.startswith(PREFIX)]
if not model_objects:
    issue("error", "no_model_objects", "no objects with prefix " + PREFIX)
for obj in model_objects:
    if obj.type != "MESH":
        issue("info", "non_mesh_object", f"{obj.type} object is part of the model", obj.name)
        continue
    object_issues(obj)

totals = {
    "objects": len(model_objects),
    "meshes": len(objects),
    "vertices": sum(item["vertices"] for item in objects),
    "polygons": sum(item["polygons"] for item in objects),
    "tris": sum(item["tris"] for item in objects),
    "ngons": sum(item["ngons"] for item in objects),
    "non_manifold": sum(item["non_manifold"] for item in objects),
    "boundary": sum(item["boundary"] for item in objects),
    "loose": sum(item["loose"] for item in objects),
    "degenerate": sum(item["degenerate"] for item in objects),
}
if totals["polygons"] > 10000:
    issue("warn", "poly_budget", f"{totals['polygons']} polygons; check the engine budget")
if totals["polygons"] > 50000:
    issue("error", "poly_budget_hard", f"{totals['polygons']} polygons is too high for a game asset")

report = {
    "model": MODEL,
    "generated": __TIMESTAMP__,
    "objects": objects,
    "totals": totals,
    "issues": issues,
    "ok": not any(item["severity"] == "error" for item in issues),
}
print("__KOVA_QA__" + json.dumps(report))
'''


def _markdown(report: dict) -> str:
    lines = [
        f"# QA: {report['model']}",
        "",
        f"Generated: {report['generated']}",
        "",
        "## Totals",
        "",
        "| Metric | Value |",
        "| --- | ---: |",
    ]
    for key, value in report["totals"].items():
        lines.append(f"| {key} | {value} |")
    lines.extend(["", "## Issues", ""])
    issues = report.get("issues") or []
    if not issues:
        lines.append("No issues found.")
    else:
        lines.append("| Severity | Code | Object | Message |")
        lines.append("| --- | --- | --- | --- |")
        for item in issues:
            lines.append(
                f"| {item['severity']} | {item['code']} | {item.get('object') or '-'} | {item['message']} |"
            )
    lines.append("")
    return "\n".join(lines)


def run_qa(project_dir: Path, model: str) -> dict:
    model_script(project_dir, model)
    client = BridgeClient.from_discovery(timeout=240)
    if client is None:
        raise BridgeError("Blender не подключён: открой Blender и включи аддон Kova")

    timestamp = datetime.now().astimezone().isoformat(timespec="seconds")
    code = QA_CODE.replace("__MODEL__", json.dumps(model)).replace(
        "__TIMESTAMP__", json.dumps(timestamp)
    )
    output = str(client.execute(code).get("result") or "")

    report = None
    for line in reversed(output.splitlines()):
        if line.startswith(MARKER):
            report = json.loads(line[len(MARKER) :])
            break
    if not isinstance(report, dict):
        raise RuntimeError("QA не вернула отчёт: " + output[-1200:])

    root = workspace_root(project_dir)
    checks = root / "Checks"
    checks.mkdir(parents=True, exist_ok=True)
    json_path = checks / f"{model}_qa.json"
    md_path = checks / f"{model}_qa.md"
    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    md_path.write_text(_markdown(report), encoding="utf-8", newline="\n")
    return report
