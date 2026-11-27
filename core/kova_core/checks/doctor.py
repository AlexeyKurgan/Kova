import os
import shutil
from pathlib import Path

from ..domain.check import CheckResult
from ..domain.enums import CheckStatus
from ..security.job import ProcessJail
from ..security.trash import list_project_trash
from ..storage.projects import load_project
from ..storage.snapshots import list_snapshots


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

    isolation = project.isolation.value
    results.append(
        CheckResult(
            name="Изоляция агентов",
            status=CheckStatus.passed
            if isolation in {"worktree", "sandbox"}
            else CheckStatus.warning,
            message=(
                "worktree: изменения применяются вручную"
                if isolation == "worktree"
                else "sandbox: агент работает в копии, изменения применяются вручную"
                if isolation == "sandbox"
                else "direct: агент пишет в проект напрямую; перед запуском создаётся снапшот"
            ),
            details={"isolation": isolation},
        )
    )
    results.append(
        CheckResult(
            name="Локальный режим",
            status=CheckStatus.passed if project.local_only else CheckStatus.warning,
            message=(
                "включён: внешние провайдеры заблокированы"
                if project.local_only
                else "выключен: внешние провайдеры доступны после согласия"
            ),
            details={"local_only": project.local_only},
        )
    )
    results.append(
        CheckResult(
            name="Сетевой щит",
            status=CheckStatus.passed if project.egress_guard else CheckStatus.warning,
            message=(
                "allowlist доменов включён для CLI-чата и задач"
                if project.egress_guard
                else "выключен: CLI-агенты могут обращаться в сеть напрямую"
            ),
            details={"egress_guard": project.egress_guard},
        )
    )
    jail = ProcessJail()
    jail_ok = jail.available
    jail.close()
    results.append(
        CheckResult(
            name="Process containment",
            status=CheckStatus.passed if jail_ok else CheckStatus.warning,
            message=(
                "Job Object: CLI и дочерние процессы завершаются вместе с Kova"
                if jail_ok
                else "Job Object недоступен: дочерние процессы могут остаться"
            ),
            details={"job_object": jail_ok},
        )
    )
    os_sandbox = ""
    if shutil.which("docker"):
        os_sandbox = "docker"
    elif (Path(os.environ.get("WINDIR", "")) / "System32" / "WindowsSandbox.exe").is_file():
        os_sandbox = "windows-sandbox"
    results.append(
        CheckResult(
            name="OS sandbox",
            status=CheckStatus.warning,
            message=(
                f"{os_sandbox} найден, но не используется: провайдеры работают "
                "в sandbox-копии проекта + process containment"
                if os_sandbox
                else "не поддерживается: используется sandbox-копия проекта + process containment"
            ),
            details={"backend": os_sandbox, "supported": False},
        )
    )
    token = bool(os.environ.get("KOVA_CORE_TOKEN"))
    results.append(
        CheckResult(
            name="Токен Core API",
            status=CheckStatus.passed if token else CheckStatus.warning,
            message=(
                "задан KOVA_CORE_TOKEN"
                if token
                else "токен не задан: локальные процессы могут обращаться к core API"
            ),
            details={"token": token},
        )
    )
    trash = list_project_trash()
    results.append(
        CheckResult(
            name="Корзина проектов",
            status=CheckStatus.passed if not trash else CheckStatus.warning,
            message=(
                "пусто"
                if not trash
                else f"в корзине {len(trash)} проект(ов) — можно восстановить или очистить"
            ),
            details={"items": len(trash)},
        )
    )
    snapshots = list_snapshots(hub)
    results.append(
        CheckResult(
            name="Снапшоты",
            status=CheckStatus.passed,
            message=f"{len(snapshots)} точ(ек) восстановления",
            details={"count": len(snapshots)},
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
