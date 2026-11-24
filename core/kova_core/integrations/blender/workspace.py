import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path

from .client import BridgeClient, BridgeError

WORKSPACE = "Blender"
DIRS = (
    "ModelScripts",
    "Models",
    "Drafts",
    "Checks",
    "Reference",
    "Archives",
    ".state",
)
NAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]{1,40}$")
ADAPTER_ROOT = Path(__file__).with_name("adapters")
TEMPLATE_ROOT = Path(__file__).with_name("templates")
SKILLS_ROOT = Path(__file__).with_name("skills")
VIEW_SCRIPT = Path(__file__).with_name("view_model.py")
SKILLS_VERSION = "2026-11-16"

ADAPTERS = {
    "roblox": "ROBLOX_RULES.txt",
    "godot": "GODOT_RULES.txt",
    "unity": "UNITY_RULES.txt",
    "unreal": "UNREAL_RULES.txt",
}


def workspace_root(project_dir: Path) -> Path:
    return project_dir.resolve() / WORKSPACE


def _marker(project_dir: Path) -> Path:
    return workspace_root(project_dir) / ".kova.blender.json"


def _write_if_missing(path: Path, text: str) -> None:
    if path.exists():
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8", newline="\n")


def contract(engine: str) -> str:
    adapter = ADAPTERS.get(engine, "GENERIC_RULES.txt")
    return f"""# Blender workspace

This folder belongs to the project. Kova Hub runs model scripts inside the live Blender
through its local bridge; do not open sockets or copy bridge code into the project.

## Layout

- `ModelScripts/<Model>/<Model>.py` - the model source of truth.
- `Models/` - finished exports.
- `Drafts/` - experiments and work in progress.
- `Checks/` - renders, QA reports and run logs.
- `Reference/` - source images and notes.
- `Archives/` - archived experiments.
- `adapters/{adapter}` - engine rules for this project.

## Model contract

1. One model = one folder `ModelScripts/<Model>/` with `<Model>.py` as the entry script.
2. The script is idempotent: remove `<Model>_*` objects first, then rebuild.
3. Every object created by the model starts with `<Model>_`.
4. Apply rotation and scale before export; avoid negative and non-uniform scale.
5. Keep model code in the model script. Do not edit game code or project docs during an asset pass.
6. Respect the engine rules in `adapters/`: scale, naming and polygon budget.
7. Print a short report with object names and polygon counts. Call `report(data)` to save
   structured output next to the script.
8. A successful script is not a finished model. Render a preview and check the result.
9. Keep experiments in `Drafts/` and review artifacts in `Checks/`.
10. Read the bundled skills before modeling and before delivery.

## Skills

The project skills are installed at `.hub/skills/blender/` next to this folder. Read
`blender-core/SKILL.md` first, then the task-specific skill, then `blender-asset-qa/SKILL.md`
before calling the asset finished.
"""


def install_skills(project_dir: Path) -> Path:
    target = project_dir.resolve() / ".hub" / "skills" / "blender"
    marker = target / ".version"
    try:
        if marker.read_text(encoding="utf-8").strip() == SKILLS_VERSION:
            return target
    except OSError:
        pass

    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(
        SKILLS_ROOT,
        target,
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
    )
    marker.write_text(SKILLS_VERSION + "\n", encoding="utf-8")
    return target


def ensure_workspace(project_dir: Path, engine: str = "generic") -> Path:
    root = workspace_root(project_dir)
    for name in DIRS:
        (root / name).mkdir(parents=True, exist_ok=True)

    marker = _marker(project_dir)
    if not marker.exists():
        payload = {
            "version": 1,
            "project": project_dir.name,
            "engine": engine,
            "created": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        }
        marker.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    adapter_name = ADAPTERS.get(engine, "GENERIC_RULES.txt")
    source = ADAPTER_ROOT / adapter_name
    if source.is_file():
        _write_if_missing(root / "adapters" / adapter_name, source.read_text(encoding="utf-8"))

    _write_if_missing(root / "AGENTS.md", contract(engine))
    install_skills(project_dir)
    return root


def _scripts(root: Path) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    base = root / "ModelScripts"
    if not base.is_dir():
        return rows
    for folder in sorted(item for item in base.iterdir() if item.is_dir()):
        scripts = sorted(folder.glob("*.py"))
        if not scripts:
            continue
        primary = folder / f"{folder.name}.py"
        if not primary.is_file():
            primary = scripts[0]
        rows.append(
            {
                "name": folder.name,
                "script": primary.relative_to(root).as_posix(),
                "updated_at": datetime.fromtimestamp(
                    primary.stat().st_mtime, tz=timezone.utc
                ).isoformat(),
            }
        )
    return rows


def workspace_info(project_dir: Path) -> dict[str, object]:
    root = workspace_root(project_dir)
    exists = (root / "AGENTS.md").is_file()
    models = sorted(
        item.relative_to(root).as_posix()
        for item in (root / "Models").glob("*")
        if item.is_file()
    ) if (root / "Models").is_dir() else []
    checks = sorted(
        item.name
        for item in (root / "Checks").glob("*.png")
    ) if (root / "Checks").is_dir() else []
    return {
        "exists": exists,
        "root": str(root),
        "path": WORKSPACE,
        "models": models,
        "scripts": _scripts(root) if exists else [],
        "checks": checks[-12:],
    }


def model_script(project_dir: Path, name: str) -> Path:
    if not NAME_RE.fullmatch(name):
        raise ValueError("имя модели: латиница, цифры и подчёркивание, начиная с буквы")
    root = workspace_root(project_dir)
    folder = root / "ModelScripts" / name
    for candidate in (folder / f"{name}.py", *sorted(folder.glob("*.py"))):
        if candidate.is_file():
            return candidate
    raise FileNotFoundError(f"скрипт модели не найден: {name}")


def create_model(project_dir: Path, name: str, engine: str = "generic") -> dict[str, object]:
    if not NAME_RE.fullmatch(name):
        raise ValueError("имя модели: латиница, цифры и подчёркивание, начиная с буквы")
    root = ensure_workspace(project_dir, engine)
    folder = root / "ModelScripts" / name
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / f"{name}.py"
    if not target.exists():
        template = (TEMPLATE_ROOT / "model_template.py").read_text(encoding="utf-8")
        target.write_text(template.replace("__MODEL__", name), encoding="utf-8", newline="\n")
    return {"name": name, "script": target.relative_to(root).as_posix()}


def _bootstrap(model_dir: Path) -> str:
    return (
        "import json as _kova_json, os as _kova_os\n"
        f"MODEL_DIR = {str(model_dir)!r}\n"
        "_kova_os.makedirs(MODEL_DIR, exist_ok=True) if MODEL_DIR else None\n"
        "__file__ = _kova_os.path.join(MODEL_DIR, 'model.py')\n"
        "def report(data):\n"
        "    path = _kova_os.path.join(MODEL_DIR, 'report.json')\n"
        "    with open(path, 'w', encoding='utf-8') as handle:\n"
        "        _kova_json.dump(data, handle, ensure_ascii=False, indent=2)\n"
        "    return data\n"
    )


def _client() -> BridgeClient:
    client = BridgeClient.from_discovery(timeout=240)
    if client is None:
        raise BridgeError("Blender не подключён: открой Blender и включи аддон Kova")
    return client


def run_model(project_dir: Path, name: str) -> dict[str, object]:
    script = model_script(project_dir, name)
    root = workspace_root(project_dir)
    output = _client().execute(_bootstrap(script.parent) + "\n" + script.read_text(encoding="utf-8"))
    text = str(output.get("result") or "")
    log = root / "Checks" / f"{name}_run.log"
    log.parent.mkdir(parents=True, exist_ok=True)
    log.write_text(text, encoding="utf-8", newline="\n")
    return {
        "model": name,
        "output": text,
        "log": log.relative_to(root).as_posix(),
        "script": script.relative_to(root).as_posix(),
    }


def render_model(project_dir: Path, name: str, view: str = "iso") -> dict[str, object]:
    script = model_script(project_dir, name)
    root = workspace_root(project_dir)
    if view not in {"front", "side", "iso", "top"}:
        raise ValueError("вид: front, side, iso или top")

    setup = VIEW_SCRIPT.read_text(encoding="utf-8")
    setup = setup.replace("__MODEL__", name).replace("__VIEW__", view)

    target = root / "Checks" / f"{name}_{view}.png"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.unlink(missing_ok=True)

    client = _client()
    render = (
        setup
        + "\n\nimport bpy as _bpy\n"
        "_scene = _bpy.context.scene\n"
        f"_prefix = {name + '_'!r}\n"
        f"_light_prefix = {'_light_' + name!r}\n"
        f"_ground_prefix = {'_ground_' + name!r}\n"
        "_hidden = []\n"
        "for _obj in _bpy.data.objects:\n"
        "    if _obj.hide_render:\n"
        "        continue\n"
        "    if _obj.type == 'MESH' and (_obj.name.startswith(_prefix) or _obj.name.startswith(_ground_prefix)):\n"
        "        continue\n"
        "    if _obj.type == 'LIGHT' and _obj.name.startswith(_light_prefix):\n"
        "        continue\n"
        "    if _obj.type not in {'MESH', 'LIGHT'}:\n"
        "        continue\n"
        "    _obj.hide_render = True\n"
        "    _hidden.append(_obj)\n"
        "_scene.render.image_settings.file_format = 'PNG'\n"
        f"_scene.render.filepath = {target.as_posix()!r}\n"
        "try:\n"
        "    _bpy.ops.render.render(write_still=True)\n"
        "    print('RENDERED', _scene.render.filepath)\n"
        "finally:\n"
        "    for _obj in _hidden:\n"
        "        _obj.hide_render = False\n"
    )
    output = client.execute(_bootstrap(script.parent) + "\n" + render)

    if not target.is_file():
        raise BridgeError("Blender не сохранил рендер")
    return {
        "model": name,
        "view": view,
        "render": target.relative_to(root).as_posix(),
        "output": str(output.get("result") or ""),
    }
