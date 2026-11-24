import json
import os
import re
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..domain.ids import new_id
from ..domain.ledger import LedgerEvent
from ..security.paths import resolve_inside
from ..storage.ledger import append_event


def _now() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def results_file(hub: Path, task_id: str) -> Path:
    return resolve_inside(hub, Path("checks") / "tasks" / f"{task_id}.json")


def list_validation_results(hub: Path, task_id: str) -> list[dict[str, Any]]:
    path = results_file(hub, task_id)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    return [row for row in payload if isinstance(row, dict)] if isinstance(payload, list) else []


def _save_results(hub: Path, task_id: str, rows: list[dict[str, Any]]) -> None:
    path = results_file(hub, task_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(rows[-100:], ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _agent_run(hub: Path, task_id: str, run_id: str | None) -> dict[str, Any] | None:
    from ..agents.runner import get_run, list_runs

    if run_id:
        run = get_run(hub, run_id)
        if run is None or run.get("task_id") != task_id:
            raise ValueError("запуск агента не найден")
        return run
    runs = list_runs(hub, task_id, limit=20)
    for run in runs:
        if run.get("status") in {"succeeded", "failed", "cancelled", "interrupted"}:
            return run
    return runs[0] if runs else None


def run_validation(
    hub: Path,
    task,
    command_id: str | None = None,
    agent_run_id: str | None = None,
) -> list[dict[str, Any]]:
    agent_run = _agent_run(hub, task.id, agent_run_id)
    commands = [
        command
        for command in task.validation
        if command_id is None or command.id == command_id
    ]
    if not commands:
        raise ValueError("проверка не найдена")

    cwd = hub.parent
    env = os.environ.copy()
    env["KOVA_PROJECT_PATH"] = str(cwd)
    results: list[dict[str, Any]] = []

    for command in commands:
        started = time.perf_counter()
        result_id = new_id("valrun")
        output = ""
        exit_code: int | None = None
        status = "passed"
        error = ""

        try:
            process = subprocess.run(
                command.command,
                cwd=str(cwd),
                env=env,
                shell=True,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=max(30, min(7200, int(command.timeout or 300))),
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            output = ((process.stdout or "") + "\n" + (process.stderr or "")).strip()
            exit_code = process.returncode
            status = "passed" if process.returncode == 0 else "failed"
        except subprocess.TimeoutExpired as exc:
            status = "timeout"
            output = str(exc.stdout or "") + "\n" + str(exc.stderr or "")
            output = output.strip()
            error = f"превышен лимит {command.timeout} секунд"
        except (OSError, ValueError) as exc:
            status = "error"
            error = str(exc)

        duration_ms = int((time.perf_counter() - started) * 1000)
        log_path = ""
        if output:
            target = resolve_inside(hub, Path("artifacts") / "logs" / f"{result_id}.txt")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(output[:400_000], encoding="utf-8")
            log_path = target.relative_to(hub).as_posix()

        result = {
            "id": result_id,
            "task_id": task.id,
            "command_id": command.id,
            "label": command.label,
            "command": command.command,
            "status": status,
            "exit_code": exit_code,
            "duration_ms": duration_ms,
            "output": output[:40_000],
            "error": error,
            "log_path": log_path,
            "created_at": _now(),
            "agent_run_id": str(agent_run.get("id") or "") if agent_run else "",
            "agent_session_id": str(agent_run.get("session_id") or "") if agent_run else "",
            "agent_run_status": str(agent_run.get("status") or "") if agent_run else "",
        }
        results.append(result)
        append_event(
            hub,
            LedgerEvent(
                type="task.validation",
                subject=task.id,
                actor="check",
                data={
                    "result_id": result_id,
                    "command_id": command.id,
                    "label": command.label,
                    "status": status,
                    "exit_code": exit_code,
                },
            ),
        )

    rows = list_validation_results(hub, task.id)
    _save_results(hub, task.id, rows + results)
    return results


def suggest_validation(hub: Path) -> list[dict[str, str]]:
    root = hub.parent
    suggestions: list[dict[str, str]] = []
    seen: set[str] = set()

    def add(label: str, command: str, source: str) -> None:
        if command in seen:
            return
        seen.add(command)
        suggestions.append({"label": label, "command": command, "source": source})

    package = root / "package.json"
    if package.is_file():
        try:
            payload = json.loads(package.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            payload = {}
        scripts = payload.get("scripts") if isinstance(payload, dict) else {}
        scripts = scripts if isinstance(scripts, dict) else {}
        for name, label in (
            ("test", "Node tests"),
            ("lint", "Lint"),
            ("typecheck", "Typecheck"),
            ("build", "Build"),
        ):
            if name in scripts:
                command = "npm test" if name == "test" else f"npm run {name}"
                add(label, command, "package.json")
        if "typecheck" not in scripts and (root / "tsconfig.json").is_file():
            add("Typecheck", "npx tsc --noEmit", "tsconfig.json")
    elif (root / "tsconfig.json").is_file():
        add("Typecheck", "npx tsc --noEmit", "tsconfig.json")

    python_marks = [
        root / "pyproject.toml",
        root / "pytest.ini",
        root / "tox.ini",
        root / "setup.cfg",
    ]
    if any(path.is_file() for path in python_marks) or (root / "tests").is_dir():
        add("Python tests", "python -m pytest -q", "pytest")

    if (root / "Cargo.toml").is_file():
        add("Rust tests", "cargo test", "Cargo.toml")

    if (root / "go.mod").is_file():
        add("Go tests", "go test ./...", "go.mod")

    if (root / "Makefile").is_file():
        try:
            makefile = (root / "Makefile").read_text(encoding="utf-8", errors="replace")
        except OSError:
            makefile = ""
        if re.search(r"(?m)^test\s*:", makefile):
            add("Make tests", "make test", "Makefile")

    dotnet = list(root.glob("*.sln")) + list(root.glob("*.csproj"))
    if dotnet:
        add("dotnet tests", "dotnet test", dotnet[0].name)

    return suggestions
