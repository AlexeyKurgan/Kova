from pathlib import Path

from ..domain.capsule import Capsule
from ..domain.project import Project
from ..domain.task import Task
from ..integrations.blender.bridge import find_blender
from ..integrations.blender.skills import list_skills, skill_picks
from ..integrations.blender.workspace import ADAPTERS, WORKSPACE, ensure_workspace
from ..security.paths import resolve_inside

BASE_RULES = [
    "Работай только в рамках задачи и её критериев.",
    "Соблюдай ограничения и стиль проекта.",
    "Если данных не хватает — задай вопрос, а не догадывайся.",
]

BLENDER_RULES = [
    f"Один ассет = один скрипт {WORKSPACE}/ModelScripts/<Model>/<Model>.py; скрипт идемпотентный.",
    "Объекты модели называются <Model>_*, трансформы применены до экспорта.",
    "Готовность подтверждает рендер-превью и проверки, а не успешный запуск скрипта.",
]

BLENDER_TYPES = {"model", "animation", "texture", "effect", "level", "export"}


def uses_blender(task: Task) -> bool:
    return task.engine.value == "blender" or task.type.value in BLENDER_TYPES

FORBIDDEN = [
    "Менять файлы вне задачи без подтверждения человека.",
    "Удалять или перезаписывать существующие файлы без снапшота.",
    "Добавлять зависимости и секреты без явного разрешения.",
]

OUTPUT_FORMAT = (
    "Ответь списком изменённых файлов с полным содержимым или диффом, "
    "кратко опиши что сделано и что проверить дальше. Без воды."
)


def build_capsule(task: Task, project: Project) -> Capsule:
    pending = [criterion.text for criterion in task.criteria if not criterion.done]
    rules = list(BASE_RULES)
    if uses_blender(task):
        rules.extend(BLENDER_RULES)
    return Capsule(
        task_id=task.id,
        project_context=f"{project.name} · {project.engine.value}",
        engine=task.engine,
        rules=rules,
        done=[criterion.text for criterion in task.criteria if criterion.done],
        problems=pending,
        files=[artifact.path for artifact in task.artifacts],
        constraints=list(task.constraints),
        next_step=[task.next_step] if task.next_step else pending,
        output_format=OUTPUT_FORMAT,
        forbidden=list(FORBIDDEN),
        references=[reference.uri for reference in task.references],
    )


def _section(title: str, lines: list[str]) -> str:
    if not lines:
        return ""
    body = "\n".join(f"- {line}" for line in lines)
    return f"\n## {title}\n{body}\n"


def _blender_section(task: Task, project: Project, picks: list[str]) -> str:
    adapter = ADAPTERS.get(project.engine.value, "GENERIC_RULES.txt")
    catalog = {str(row["name"]): row for row in list_skills()}
    skill_lines = []
    for name in picks:
        description = str(catalog.get(name, {}).get("description", ""))
        brief = description.split(". ")[0].strip()
        suffix = f" — {brief}" if brief else ""
        skill_lines.append(f".hub/skills/blender/{name}/SKILL.md{suffix}")
    blender = find_blender()
    lines = [
        f"{WORKSPACE}/ModelScripts/<Model>/<Model>.py — исходник модели",
        f"{WORKSPACE}/Models — готовые экспорты",
        f"{WORKSPACE}/Checks — рендеры, отчёты и логи запусков",
        f"{WORKSPACE}/AGENTS.md — правила рабочей папки",
        f"{WORKSPACE}/adapters/{adapter} — правила движка",
    ]
    if blender is not None:
        lines.append(f"Blender: {blender}")
    lines.extend(
        [
            "Если у тебя есть доступ к файлам проекта — прочитай выбранные скиллы один раз перед работой.",
            *skill_lines,
        ]
    )
    return _section("Blender", lines)


def capsule_text(
    capsule: Capsule,
    task: Task,
    project: Project,
    hub: Path | None = None,
) -> str:
    criteria = "\n".join(
        f"- [{'x' if criterion.done else ' '}] {criterion.text}"
        for criterion in task.criteria
    )
    parts = [
        f"# Задача: {task.title}",
        f"Проект: {project.name} · Движок: {task.engine.value}",
        f"\n## Цель\n{task.goal or 'Не указана'}\n",
    ]
    if criteria:
        parts.append(f"\n## Критерии готовности\n{criteria}\n")
    parts.append(_section("Ограничения", capsule.constraints))
    parts.append(_section("Уже сделано", capsule.done))
    parts.append(_section("Проблемы и что осталось", capsule.problems))
    parts.append(_section("Файлы", capsule.files))
    parts.append(_section("Следующий шаг", capsule.next_step))
    parts.append(_section("Правила", capsule.rules))
    parts.append(_section("Запрещено", capsule.forbidden))
    parts.append(_section("Референсы", capsule.references))
    if hub is not None and uses_blender(task):
        ensure_workspace(hub.parent, project.engine.value)
        picks = task.skills or skill_picks(task.type.value)
        parts.append(_blender_section(task, project, picks))
    parts.append(f"\n## Формат ответа\n{capsule.output_format}\n")
    return "\n".join(part for part in parts if part)


def save_capsule(hub: Path, capsule: Capsule, text: str) -> Path:
    directory = hub / "capsules"
    directory.mkdir(parents=True, exist_ok=True)
    (directory / f"{capsule.id}.json").write_text(
        capsule.model_dump_json(indent=2) + "\n",
        encoding="utf-8",
    )
    markdown = resolve_inside(hub, Path("capsules") / f"{capsule.id}.md")
    markdown.write_text(text, encoding="utf-8")
    return markdown
