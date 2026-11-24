import re
from pathlib import Path

SKILLS_DIR = Path(__file__).with_name("skills")
NAME_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,64}$")


def _meta(text: str) -> dict[str, str]:
    meta: dict[str, str] = {}
    if not text.startswith("---"):
        return meta
    parts = text.split("---", 2)
    if len(parts) < 3:
        return meta
    for line in parts[1].splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        meta[key.strip()] = value.strip().strip("'\"")
    return meta


def list_skills() -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    if not SKILLS_DIR.is_dir():
        return rows
    for folder in sorted(item for item in SKILLS_DIR.iterdir() if item.is_dir()):
        skill_md = folder / "SKILL.md"
        if not skill_md.is_file():
            continue
        text = skill_md.read_text(encoding="utf-8", errors="replace")
        meta = _meta(text)
        files = [
            item.relative_to(folder).as_posix()
            for item in folder.rglob("*")
            if item.is_file() and item.name != "SKILL.md"
        ]
        group, label = _group(folder.name)
        rows.append(
            {
                "name": meta.get("name", folder.name),
                "description": meta.get("description", ""),
                "path": folder.name,
                "group": group,
                "group_label": label,
                "scripts": [item for item in files if item.endswith(".py")],
                "files": files,
            }
        )
    return rows


GROUP_LABELS = {
    "core": "База",
    "modeling": "Моделирование",
    "materials": "Материалы и текстуры",
    "rig": "Риг и анимация",
    "fx": "Свет, эффекты, рендер",
    "pipeline": "Пайплайн и проверки",
    "other": "Дополнительно",
}

SKILL_GROUP = {
    "blender-core": "core",
    "blender-hardsurface-modeling": "modeling",
    "blender-sculpting": "modeling",
    "blender-environment-kits": "modeling",
    "blender-clothing": "modeling",
    "blender-hair-grooming": "modeling",
    "blender-retopology-uv": "modeling",
    "blender-pbr-materials": "materials",
    "blender-texturing": "materials",
    "blender-texture-baking": "materials",
    "blender-stylized-npr": "materials",
    "blender-character-rigging": "rig",
    "blender-animation": "rig",
    "blender-facial-shapekeys": "rig",
    "blender-geometry-nodes": "fx",
    "blender-simulation": "fx",
    "blender-weather-fx": "fx",
    "blender-time-of-day": "fx",
    "blender-lighting-lookdev": "fx",
    "blender-rendering": "fx",
    "blender-export-pipelines": "pipeline",
    "blender-game-optimization": "pipeline",
    "blender-asset-qa": "pipeline",
    "blender-pipeline-automation": "pipeline",
    "blender-workflow-recipes": "pipeline",
    "blender-scene-setup": "pipeline",
    "blender-addon-development": "other",
    "blender-video-editing": "other",
}


def _group(name: str) -> tuple[str, str]:
    group = SKILL_GROUP.get(name, "other")
    return group, GROUP_LABELS[group]


PICKS = {
    "model": ["blender-core", "blender-hardsurface-modeling", "blender-retopology-uv", "blender-pbr-materials"],
    "animation": ["blender-core", "blender-animation", "blender-character-rigging"],
    "texture": ["blender-core", "blender-texturing", "blender-pbr-materials", "blender-texture-baking"],
    "effect": ["blender-core", "blender-geometry-nodes", "blender-simulation", "blender-weather-fx"],
    "level": ["blender-core", "blender-environment-kits", "blender-scene-setup", "blender-lighting-lookdev"],
    "export": ["blender-core", "blender-export-pipelines", "blender-game-optimization"],
}


def skill_picks(task_type: str) -> list[str]:
    picks = PICKS.get(task_type, ["blender-core", "blender-hardsurface-modeling"])
    result = list(dict.fromkeys([*picks, "blender-asset-qa"]))
    available = {row["path"] for row in list_skills()}
    return [name for name in result if name in available]


def get_skill(name: str) -> dict[str, object] | None:
    if not NAME_RE.fullmatch(name):
        return None
    folder = SKILLS_DIR / name
    source = folder / "SKILL.md"
    if not source.is_file():
        return None
    text = source.read_text(encoding="utf-8", errors="replace")
    meta = _meta(text)
    files = [
        item.relative_to(folder).as_posix()
        for item in folder.rglob("*")
        if item.is_file() and item.name != "SKILL.md"
    ]
    group, label = _group(folder.name)
    return {
        "name": meta.get("name", folder.name),
        "description": meta.get("description", ""),
        "path": folder.name,
        "group": group,
        "group_label": label,
        "content": text,
        "files": files,
    }
