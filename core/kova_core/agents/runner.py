import json
import os
import subprocess
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..domain.enums import TaskStatus
from ..domain.ids import new_id
from ..domain.ledger import LedgerEvent
from ..storage.capsules import build_capsule, capsule_text, save_capsule
from ..storage.ledger import append_event
from ..storage.projects import load_project
from ..storage.responses import record_response
from ..storage.snapshots import create_snapshot
from ..storage.tasks import get_task, save_task
from .providers import build_command, get_provider, provider_env

RUNS: dict[str, dict[str, Any]] = {}
PROCESSES: dict[str, subprocess.Popen[str]] = {}
LOCK = threading.Lock()


def _now() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def runs_dir(hub: Path) -> Path:
    return hub / "agents" / "runs"


def _file(hub: Path, run_id: str) -> Path:
    return runs_dir(hub) / f"{run_id}.json"


def _save(hub: Path, record: dict[str, Any]) -> None:
    path = _file(hub, str(record["id"]))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(record, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _update(hub: Path, run_id: str, **changes: Any) -> dict[str, Any] | None:
    with LOCK:
        record = RUNS.get(run_id)
        if record is None:
            try:
                record = json.loads(_file(hub, run_id).read_text(encoding="utf-8"))
            except (OSError, ValueError):
                return None
        record.update(changes)
        RUNS[run_id] = record
    _save(hub, record)
    return record


def get_run(hub: Path, run_id: str) -> dict[str, Any] | None:
    with LOCK:
        if run_id in RUNS:
            return dict(RUNS[run_id])
    try:
        payload = json.loads(_file(hub, run_id).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return payload if isinstance(payload, dict) else None


def list_runs(hub: Path, task_id: str | None = None, limit: int = 50) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    directory = runs_dir(hub)
    if directory.is_dir():
        for path in directory.glob("run_*.json"):
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if not isinstance(payload, dict):
                continue
            if task_id and payload.get("task_id") != task_id:
                continue
            rows.append(payload)
    rows.sort(key=lambda row: str(row.get("started_at") or ""), reverse=True)
    return rows[:limit]


def _prompt_for(hub: Path, task, provider: dict[str, Any]) -> str:
    project = load_project(hub)
    capsule = build_capsule(task, project)
    text = capsule_text(capsule, task, project, hub)
    save_capsule(hub, capsule, text)
    root = hub.parent
    header = (
        "Ты — AI-агент внутри Kova Hub.\n"
        f"Рабочая папка проекта: {root}\n"
        f"Провайдер: {provider.get('name')} ({provider.get('id')})\n"
        "\n"
        "Работай только внутри папки проекта. Если в задаче есть Blender-скиллы, "
        "прочитай указанные SKILL.md один раз перед работой. Изменяй файлы напрямую, "
        "не спрашивай подтверждения на каждое действие, но не выходи за рамки задачи. "
        "В конце выведи краткий отчёт: что изменено, что проверено и что осталось.\n"
        "\n"
        "## Kova API (локально)\n"
        "- GET http://127.0.0.1:8765/blender/status — установлен ли Blender и подключён ли мост.\n"
        "- POST http://127.0.0.1:8765/blender/build с JSON {\"model\":\"<Model>\",\"view\":\"iso\"} — "
        "запустить скрипт модели, QA и рендер. Возвращает output, qa и preview.\n"
        "- POST http://127.0.0.1:8765/blender/run с JSON {\"model\":\"<Model>\"} — только запуск скрипта.\n"
        "Пример: curl -s -X POST http://127.0.0.1:8765/blender/build "
        "-H \"Content-Type: application/json\" -d \"{\\\"model\\\":\\\"Sword\\\"}\"\n"
        "\n"
    )
    return header + text


def _kill(process: subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/PID", str(process.pid), "/T", "/F"],
            capture_output=True,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    else:
        process.terminate()


def _execute(hub: Path, run_id: str, provider: dict[str, Any], argv: list[str], cwd: Path) -> None:
    _update(hub, run_id, status="running", started_at=_now())
    timeout = int(provider.get("timeout") or 1800)
    env = provider_env()
    env["KOVA_PROJECT_PATH"] = str(cwd)
    env["KOVA_RUN_ID"] = run_id
    try:
        process = subprocess.Popen(
            argv,
            cwd=str(cwd),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=env,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        with LOCK:
            PROCESSES[run_id] = process
        try:
            output, _ = process.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            _kill(process)
            output, _ = process.communicate()
            _finish(
                hub,
                run_id,
                status="failed",
                output=output or "",
                exit_code=None,
                error=f"превышен лимит {timeout} секунд",
            )
            return

        current = get_run(hub, run_id) or {}
        if current.get("cancel_requested"):
            _finish(
                hub,
                run_id,
                status="cancelled",
                output=output or "",
                exit_code=process.returncode,
                error="запуск отменён",
            )
            return

        if process.returncode == 0:
            _finish(
                hub,
                run_id,
                status="succeeded",
                output=output or "",
                exit_code=0,
            )
        else:
            _finish(
                hub,
                run_id,
                status="failed",
                output=output or "",
                exit_code=process.returncode,
                error=f"CLI завершился с кодом {process.returncode}",
            )
    except (OSError, ValueError) as exc:
        _finish(hub, run_id, status="failed", output="", exit_code=None, error=str(exc))
    finally:
        with LOCK:
            PROCESSES.pop(run_id, None)


def _finish(
    hub: Path,
    run_id: str,
    status: str,
    output: str,
    exit_code: int | None,
    error: str = "",
) -> None:
    record = get_run(hub, run_id) or {}
    finished = _now()
    limit = 400_000
    clipped = output if len(output) <= limit else output[:limit] + "\n\n[вывод обрезан]"
    log_path = ""
    artifact_path = ""
    review_id = ""
    if clipped.strip():
        target = hub / "artifacts" / "logs" / f"{run_id}.txt"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(clipped, encoding="utf-8")
        log_path = target.relative_to(hub).as_posix()

    if status == "succeeded" and clipped.strip():
        result = record_response(
            hub,
            str(record.get("task_id")),
            clipped,
            event_type="ai.run.finished",
            actor=str(record.get("provider_name") or "AI"),
            data={
                "run_id": run_id,
                "provider": record.get("provider_id"),
                "exit_code": exit_code,
            },
        )
        if result is not None:
            _, review, relative = result
            artifact_path = relative
            review_id = review.id

    if status != "succeeded" or not review_id:
        append_event(
            hub,
            LedgerEvent(
                type="ai.run.finished" if status == "succeeded" else "ai.run.failed",
                subject=str(record.get("task_id") or ""),
                actor=str(record.get("provider_name") or "AI"),
                data={
                    "run_id": run_id,
                    "status": status,
                    "exit_code": exit_code,
                    "review_id": review_id,
                },
            ),
        )
    _update(
        hub,
        run_id,
        status=status,
        output=clipped,
        exit_code=exit_code,
        error=error,
        finished_at=finished,
        log_path=log_path,
        artifact_path=artifact_path,
        review_id=review_id,
    )


def start_run(
    hub: Path,
    task_id: str,
    provider_id: str | None = None,
    snapshot: bool = True,
) -> dict[str, Any]:
    task = get_task(hub, task_id)
    if task is None:
        raise FileNotFoundError("task not found")
    provider = get_provider(provider_id)
    if provider is None:
        raise RuntimeError("AI-провайдер не найден")
    if not provider.get("installed"):
        raise FileNotFoundError(
            f"{provider.get('name')}: CLI не найден. Укажи путь в разделе «Агенты»."
        )
    if not provider.get("enabled", True):
        raise RuntimeError(f"{provider.get('name')} выключен")

    if task.status not in {TaskStatus.archived, TaskStatus.done}:
        task.status = TaskStatus.working
        save_task(hub, task)

    prompt = _prompt_for(hub, task, provider)
    argv = build_command(provider, prompt)
    run_id = new_id("run")
    snapshot_id = ""
    snapshot_error = ""
    if snapshot:
        try:
            snap = create_snapshot(
                hub,
                f"before AI run: {task.title}",
                created_by="kova",
            )
            snapshot_id = snap.id
        except (OSError, ValueError) as exc:
            snapshot_error = str(exc)

    record: dict[str, Any] = {
        "id": run_id,
        "task_id": task.id,
        "task_title": task.title,
        "provider_id": provider["id"],
        "provider_name": provider["name"],
        "status": "queued",
        "created_at": _now(),
        "started_at": "",
        "finished_at": "",
        "exit_code": None,
        "output": "",
        "error": "",
        "log_path": "",
        "artifact_path": "",
        "review_id": "",
        "snapshot_id": snapshot_id,
        "snapshot_error": snapshot_error,
        "command": provider.get("command"),
        "args": provider.get("args"),
    }
    with LOCK:
        RUNS[run_id] = record
    _save(hub, record)
    append_event(
        hub,
        LedgerEvent(
            type="ai.run.started",
            subject=task.id,
            actor=provider["name"],
            data={"run_id": run_id, "provider": provider["id"]},
        ),
    )
    thread = threading.Thread(
        target=_execute,
        args=(hub, run_id, provider, argv, hub.parent),
        daemon=True,
        name=f"kova-run-{run_id}",
    )
    thread.start()
    return get_run(hub, run_id) or record


def cancel_run(hub: Path, run_id: str) -> dict[str, Any] | None:
    record = get_run(hub, run_id)
    if record is None:
        return None
    if record.get("status") not in {"queued", "running"}:
        return record
    _update(hub, run_id, cancel_requested=True)
    with LOCK:
        process = PROCESSES.get(run_id)
    if process is not None:
        _kill(process)
    return get_run(hub, run_id)
