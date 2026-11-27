import os
import shutil
import socket
from pathlib import Path

from ..domain.check import CheckResult
from ..domain.enums import CheckStatus
from ..i18n import tr
from ..security.job import ProcessJail
from ..security.trash import list_project_trash
from ..storage.projects import load_project
from ..storage.snapshots import list_snapshots


def _check(
    name: str,
    name_en: str,
    status: CheckStatus,
    message: str,
    message_en: str,
    details: dict[str, object] | None = None,
) -> CheckResult:
    return CheckResult(
        name=name,
        display_name=tr(name, name_en),
        status=status,
        message=message,
        display_message=tr(message, message_en),
        details=details or {},
    )


def run_doctor(hub: Path) -> list[CheckResult]:
    results: list[CheckResult] = []

    hub_ok = (hub / "project.json").is_file() and (hub / "tasks").is_dir()
    results.append(
        _check(
            "Структура .hub",
            ".hub structure",
            CheckStatus.passed if hub_ok else CheckStatus.failed,
            "Память проекта на месте" if hub_ok else "project.json или tasks отсутствуют",
            "Project memory is present"
            if hub_ok
            else "project.json or tasks are missing",
        )
    )

    git = shutil.which("git")
    results.append(
        _check(
            "Git",
            "Git",
            CheckStatus.passed if git else CheckStatus.warning,
            git or "git не найден в PATH — история и переносимость ограничены",
            git or "git not found in PATH — history and portability are limited",
        )
    )

    from ..integrations.blender.bridge import find_blender

    blender = find_blender()
    results.append(
        _check(
            "Blender",
            "Blender",
            CheckStatus.passed if blender else CheckStatus.warning,
            str(blender) if blender else "Blender не найден — проверки геометрии недоступны",
            str(blender)
            if blender
            else "Blender not found — geometry checks are unavailable",
        )
    )

    project = load_project(hub)
    results.append(
        _check(
            "Движок проекта",
            "Project engine",
            CheckStatus.passed,
            f"Выбран движок: {project.engine.value}",
            f"Engine selected: {project.engine.value}",
            {"engine": project.engine.value},
        )
    )

    isolation = project.isolation.value
    isolation_messages = {
        "worktree": (
            "worktree: изменения применяются вручную",
            "worktree: changes are applied manually",
        ),
        "sandbox": (
            "sandbox: агент работает в копии, изменения применяются вручную",
            "sandbox: the agent works in a copy, changes are applied manually",
        ),
        "direct": (
            "direct: агент пишет в проект напрямую; перед запуском создаётся снапшот",
            "direct: the agent writes to the project directly; a snapshot is created before each run",
        ),
    }
    isolation_ru, isolation_en = isolation_messages.get(
        isolation,
        isolation_messages["direct"],
    )
    results.append(
        _check(
            "Изоляция агентов",
            "Agent isolation",
            CheckStatus.passed
            if isolation in {"worktree", "sandbox"}
            else CheckStatus.warning,
            isolation_ru,
            isolation_en,
            {"isolation": isolation},
        )
    )
    results.append(
        _check(
            "Локальный режим",
            "Local-only mode",
            CheckStatus.passed if project.local_only else CheckStatus.warning,
            (
                "включён: внешние провайдеры заблокированы"
                if project.local_only
                else "выключен: внешние провайдеры доступны после согласия"
            ),
            (
                "on: external providers are blocked"
                if project.local_only
                else "off: external providers are available after consent"
            ),
            {"local_only": project.local_only},
        )
    )
    results.append(
        _check(
            "Сетевой щит",
            "Network guard",
            CheckStatus.passed if project.egress_guard else CheckStatus.warning,
            (
                "allowlist доменов включён для CLI-чата и задач"
                if project.egress_guard
                else "выключен: CLI-агенты могут обращаться в сеть напрямую"
            ),
            (
                "domain allowlist is on for CLI chat and tasks"
                if project.egress_guard
                else "off: CLI agents can access the network directly"
            ),
            {"egress_guard": project.egress_guard},
        )
    )
    jail = ProcessJail()
    jail_ok = jail.available
    jail.close()
    results.append(
        _check(
            "Process containment",
            "Process containment",
            CheckStatus.passed if jail_ok else CheckStatus.warning,
            (
                "Job Object: CLI и дочерние процессы завершаются вместе с Kova"
                if jail_ok
                else "Job Object недоступен: дочерние процессы могут остаться"
            ),
            (
                "Job Object: CLI and child processes terminate with Kova"
                if jail_ok
                else "Job Object unavailable: child processes may remain"
            ),
            {"job_object": jail_ok},
        )
    )
    os_sandbox = ""
    if shutil.which("docker"):
        os_sandbox = "docker"
    elif (Path(os.environ.get("WINDIR", "")) / "System32" / "WindowsSandbox.exe").is_file():
        os_sandbox = "windows-sandbox"
    results.append(
        _check(
            "OS sandbox",
            "OS sandbox",
            CheckStatus.warning,
            (
                f"{os_sandbox} найден, но не используется: провайдеры работают "
                "в sandbox-копии проекта + process containment"
                if os_sandbox
                else "не поддерживается: используется sandbox-копия проекта + process containment"
            ),
            (
                f"{os_sandbox} found but not used: providers run in a sandbox "
                "project copy + process containment"
                if os_sandbox
                else "not supported: a sandbox project copy + process containment is used"
            ),
            {"backend": os_sandbox, "supported": False},
        )
    )
    token = bool(os.environ.get("KOVA_CORE_TOKEN"))
    results.append(
        _check(
            "Токен Core API",
            "Core API token",
            CheckStatus.passed if token else CheckStatus.warning,
            (
                "задан KOVA_CORE_TOKEN"
                if token
                else "токен не задан: локальные процессы могут обращаться к core API"
            ),
            (
                "KOVA_CORE_TOKEN is set"
                if token
                else "token is not set: local processes can access the core API"
            ),
            {"token": token},
        )
    )
    trash = list_project_trash()
    results.append(
        _check(
            "Корзина проектов",
            "Project trash",
            CheckStatus.passed if not trash else CheckStatus.warning,
            (
                "пусто"
                if not trash
                else f"в корзине {len(trash)} проект(ов) — можно восстановить или очистить"
            ),
            (
                "empty"
                if not trash
                else f"{len(trash)} project(s) in trash — can be restored or cleaned"
            ),
            {"items": len(trash)},
        )
    )
    snapshots = list_snapshots(hub)
    results.append(
        _check(
            "Снапшоты",
            "Snapshots",
            CheckStatus.passed,
            f"{len(snapshots)} точ(ек) восстановления",
            f"{len(snapshots)} restore point(s)",
            {"count": len(snapshots)},
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
        _check(
            "Права на запись",
            "Write permissions",
            CheckStatus.passed if not write_errors else CheckStatus.failed,
            (
                "проект и .hub доступны для записи"
                if not write_errors
                else "; ".join(write_errors)
            ),
            (
                "project and .hub are writable"
                if not write_errors
                else "; ".join(write_errors)
            ),
            {"errors": write_errors},
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
        _check(
            "Порты Kova",
            "Kova ports",
            CheckStatus.passed if ports["8765"] == "занят" else CheckStatus.warning,
            (
                "8765: core · 47832: Blender · 48620: редактор"
                if ports["8765"] == "занят"
                else "порт 8765 свободен — core не слушает"
            ),
            (
                "8765: core · 47832: Blender · 48620: editor"
                if ports["8765"] == "занят"
                else "port 8765 is free — core is not listening"
            ),
            ports,
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
    package_message = ""
    package_message_en = ""
    if missing_packages:
        package_status = CheckStatus.failed
        package_message = "повреждены пакеты: " + ", ".join(missing_packages)
        package_message_en = "damaged packages: " + ", ".join(missing_packages)
    elif disabled_engines or engine_missing:
        package_status = CheckStatus.warning
        parts_ru: list[str] = []
        parts_en: list[str] = []
        if disabled_engines:
            parts_ru.append("выключены: " + ", ".join(disabled_engines))
            parts_en.append("disabled: " + ", ".join(disabled_engines))
        if engine_missing:
            parts_ru.append(f"нет пакета движка {project_engine_id}")
            parts_en.append(f"engine package {project_engine_id} is missing")
        package_message = "; ".join(parts_ru)
        package_message_en = "; ".join(parts_en)
    else:
        package_status = CheckStatus.passed
        package_message = f"{len(installed_packages)} установленных пакетов в порядке"
        package_message_en = f"{len(installed_packages)} installed packages are OK"
    results.append(
        _check(
            "Пакеты проекта",
            "Project packages",
            package_status,
            package_message,
            package_message_en,
            {
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
        _check(
            "Свободное место",
            "Free space",
            CheckStatus.passed if free_gb >= 1 else CheckStatus.warning,
            f"{free_gb:.1f} ГБ свободно",
            f"{free_gb:.1f} GB free",
            {"free_bytes": usage.free},
        )
    )

    return results
