import os
import shutil
import socket
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

    write_targets = [("проект", hub.parent), (".hub", hub)]
    write_errors: list[str] = []
    for label, path in write_targets:
        probe = path / f".kova-write-{os.getpid()}.tmp"
        try:
            probe.write_text("ok", encoding="utf-8")
            probe.unlink(missing_ok=True)
        except OSError as exc:
            write_errors.append(f"{label}: {exc}")
            probe.unlink(missing_ok=True)
    results.append(
        CheckResult(
            name="Права на запись",
            status=CheckStatus.passed if not write_errors else CheckStatus.failed,
            message=(
                "проект и .hub доступны для записи"
                if not write_errors
                else "; ".join(write_errors)
            ),
            details={"errors": write_errors},
        )
    )

    ports: dict[str, str] = {}
    for port in (8765, 47832, 48620):
        probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        probe.settimeout(0.3)
        busy = probe.connect_ex(("127.0.0.1", port)) == 0
        probe.close()
        ports[str(port)] = "занят" if busy else "свободен"
    results.append(
        CheckResult(
            name="Порты Kova",
            status=CheckStatus.passed if ports["8765"] == "занят" else CheckStatus.warning,
            message=(
                "8765: core · 47832: Blender · 48620: редактор"
                if ports["8765"] == "занят"
                else "порт 8765 свободен — core не слушает"
            ),
            details=ports,
        )
    )

    from ..packages import store

    package_rows = store.list_packages(hub)
    installed_packages = [row for row in package_rows if row.get("installed")]
    missing_packages = [
        row["id"]
        for row in installed_packages
        if row.get("custom")
        and not (hub / "packages" / "custom" / row["id"] / "kova-package.json").is_file()
    ]
    disabled_engines = [
        row["id"]
        for row in installed_packages
        if row.get("type") == "engine" and not row.get("enabled")
    ]
    project_engine_id = f"{project.engine.value}-core"
    engine_package = next(
        (row for row in package_rows if row["id"] == project_engine_id),
        None,
    )
    engine_missing = bool(
        engine_package and not engine_package.get("installed")
    )
    if missing_packages:
        package_status = CheckStatus.failed
        package_message = "повреждены пакеты: " + ", ".join(missing_packages)
    elif disabled_engines or engine_missing:
        package_status = CheckStatus.warning
        parts = []
        if disabled_engines:
            parts.append("выключены: " + ", ".join(disabled_engines))
        if engine_missing:
            parts.append(f"нет пакета движка {project_engine_id}")
        package_message = "; ".join(parts)
    else:
        package_status = CheckStatus.passed
        package_message = f"{len(installed_packages)} установленных пакетов в порядке"
    results.append(
        CheckResult(
            name="Пакеты проекта",
            status=package_status,
            message=package_message,
            details={
                "installed": len(installed_packages),
                "missing": missing_packages,
                "disabled_engines": disabled_engines,
                "engine_package": project_engine_id,
            },
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
