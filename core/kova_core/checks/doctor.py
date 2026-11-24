import shutil
from pathlib import Path

from ..domain.check import CheckResult
from ..domain.enums import CheckStatus
from ..storage.projects import load_project


def run_doctor(hub: Path) -> list[CheckResult]:
    results: list[CheckResult] = []

    hub_ok = (hub / "project.json").is_file() and (hub / "tasks").is_dir()
    results.append(
        CheckResult(
            name="Структура .hub",
            status=CheckStatus.passed if hub_ok else CheckStatus.failed,
            message="Память проекта на месте" if hub_ok else "project.json или tasks отсутствуют",
        )
    )

    git = shutil.which("git")
    results.append(
        CheckResult(
            name="Git",
            status=CheckStatus.passed if git else CheckStatus.warning,
            message=git or "git не найден в PATH — история и переносимость ограничены",
        )
    )

    from ..integrations.blender.bridge import find_blender

    blender = find_blender()
    results.append(
        CheckResult(
            name="Blender",
            status=CheckStatus.passed if blender else CheckStatus.warning,
            message=str(blender) if blender else "Blender не найден — проверки геометрии недоступны",
        )
    )

    project = load_project(hub)
    results.append(
        CheckResult(
            name="Движок проекта",
            status=CheckStatus.passed,
            message=f"Выбран движок: {project.engine.value}",
            details={"engine": project.engine.value},
        )
    )

    usage = shutil.disk_usage(hub.parent)
    free_gb = usage.free / (1024**3)
    results.append(
        CheckResult(
            name="Свободное место",
            status=CheckStatus.passed if free_gb >= 1 else CheckStatus.warning,
            message=f"{free_gb:.1f} ГБ свободно",
            details={"free_bytes": usage.free},
        )
    )

    return results
