import json
import os
import subprocess
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..domain.enums import IsolationMode, TaskStatus
from ..domain.ids import new_id
from ..domain.ledger import LedgerEvent
from ..storage.capsules import build_capsule, capsule_text, save_capsule
from ..storage.ledger import append_event
from ..storage.projects import load_project
from ..storage.responses import record_response
from ..storage.snapshots import create_snapshot, diff_snapshot
from ..storage.tasks import get_task, save_task
from .. import skills as skill_store
from . import handoffs, routing, sessions, usage as usage_report, worktrees
from .api_agent import run_agent
from .api_provider import RunCancelled
from .cli_output import parse_output, stream_display
from .providers import build_command, build_resume_command, get_provider, provider_env
from ..security.egress import EgressGuard, apply_guard_env, egress_hosts
from ..security.job import ProcessJail, kill_process_group, spawn_kwargs
from ..security.secrets import get_secret

RUNS: dict[str, dict[str, Any]] = {}
PROCESSES: dict[str, subprocess.Popen[str]] = {}
RUN_HUBS: dict[str, Path] = {}
LOCK = threading.Lock()
RECONCILED: set[str] = set()


class _Slots:
    def __init__(self) -> None:
        self.cv = threading.Condition()
        self.active: dict[str, set[str]] = {}

    def acquire(self, hub: Path, run_id: str) -> bool:
        key = str(hub)
        last_note = 0.0
        while True:
            with self.cv:
                limit = max(1, int(load_project(hub).max_parallel_runs or 1))
                active = self.active.setdefault(key, set())
                if run_id in active:
                    return True
                if len(active) < limit:
                    active.add(run_id)
                    return True
            current = get_run(hub, run_id) or {}
            if current.get("cancel_requested") or current.get("shutdown_requested"):
                return False
            now = time.monotonic()
            if now - last_note >= 1.0:
                last_note = now
                _update(hub, run_id, queue_position=self.position(hub, run_id))
            with self.cv:
                self.cv.wait(timeout=0.3)

    def release(self, hub: Path, run_id: str) -> None:
        with self.cv:
            self.active.get(str(hub), set()).discard(run_id)
            self.cv.notify_all()

    def position(self, hub: Path, run_id: str) -> int:
        key = str(hub)
        limit = max(1, int(load_project(hub).max_parallel_runs or 1))
        with self.cv:
            active = self.active.get(key, set())
            if run_id in active:
                return 0
            if len(active) < limit:
                return 0
        record = get_run(hub, run_id) or {}
        created = str(record.get("created_at") or "")
        rows = [
            row
            for row in list_runs_raw(hub)
            if row.get("status") == "queued" and row.get("id") != run_id
        ]
        rows.sort(key=lambda row: str(row.get("created_at") or ""))
        ahead = sum(1 for row in rows if str(row.get("created_at") or "") <= created)
        return ahead + 1


SLOTS = _Slots()


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


def reconcile_runs(hub: Path) -> None:
    key = str(hub)
    with LOCK:
        if key in RECONCILED:
            return
        RECONCILED.add(key)
    reason = "core перезапущен до завершения запуска"
    directory = runs_dir(hub)
    if directory.is_dir():
        for path in directory.glob("run_*.json"):
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if not isinstance(payload, dict):
                continue
            if payload.get("status") not in {"queued", "running", "waiting_approval"}:
                continue
            run_id = str(payload.get("id") or "")
            if not run_id or run_id in RUNS:
                continue
            payload["status"] = "interrupted"
            payload["finished_at"] = _now()
            payload["error"] = reason
            payload["interrupted_reason"] = reason
            _save(hub, payload)
            sessions.finish_session(hub, str(payload.get("session_id") or ""), "interrupted")
            append_event(
                hub,
                LedgerEvent(
                    type="agent.run.interrupted",
                    subject=str(payload.get("task_id") or ""),
                    actor=str(payload.get("provider_name") or "AI"),
                    data={"run_id": run_id, "session_id": payload.get("session_id") or ""},
                ),
            )
    sessions.interrupt_active_sessions(hub, set(RUNS.keys()))


def list_runs_raw(hub: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    directory = runs_dir(hub)
    if directory.is_dir():
        for path in directory.glob("run_*.json"):
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if isinstance(payload, dict):
                rows.append(payload)
    return rows


def list_runs(hub: Path, task_id: str | None = None, limit: int = 50) -> list[dict[str, Any]]:
    reconcile_runs(hub)
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


def _prompt_for(
    hub: Path,
    task,
    provider: dict[str, Any],
    message: str = "",
    handoff_text: str = "",
    root: Path | None = None,
    read_only: bool = False,
) -> str:
    project = load_project(hub)
    capsule = build_capsule(task, project)
    text = capsule_text(capsule, task, project, hub)
    save_capsule(hub, capsule, text)
    root = root or hub.parent
    header = (
        "Ты — AI-агент внутри Kova Hub.\n"
        f"Рабочая папка проекта: {root}\n"
        f"Провайдер: {provider.get('name')} ({provider.get('id')})\n"
        "\n"
        "Работай только внутри папки проекта. Если в задаче выбраны скиллы, "
        "используй их инструкции ниже. Изменяй файлы напрямую, "
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
    if read_only:
        header += (
            "Режим «только чтение»: не изменяй файлы и не запускай команды, "
            "которые что-то записывают. Верни анализ и план.\n"
        )
    prompt = header + text
    skill_text = skill_store.skill_prompt(list(task.skills or []))
    if skill_text:
        prompt += "\n" + skill_text
    if handoff_text:
        prompt += handoff_text
    if message.strip():
        prompt += "\n## Текущий запрос\n" + message.strip() + "\n"
    return prompt


def _kill(process: subprocess.Popen[str]) -> None:
    kill_process_group(process)


def _execute(
    hub: Path,
    run_id: str,
    provider: dict[str, Any],
    prompt: str,
    argv: list[str],
    cwd: Path,
) -> None:
    current = get_run(hub, run_id) or {}
    if current.get("shutdown_requested"):
        return
    if current.get("cancel_requested"):
        _finish(
            hub,
            run_id,
            status="cancelled",
            output="",
            exit_code=None,
            error="запуск отменён",
        )
        return
    if not SLOTS.acquire(hub, run_id):
        current = get_run(hub, run_id) or {}
        if not current.get("shutdown_requested"):
            _finish(
                hub,
                run_id,
                status="cancelled",
                output="",
                exit_code=None,
                error="запуск отменён",
            )
        return
    _update(
        hub,
        run_id,
        status="running",
        started_at=_now(),
        queue_position=0,
    )
    timeout = int(provider.get("timeout") or 1800)
    guard: EgressGuard | None = None
    try:
        project = load_project(hub)
    except (OSError, ValueError):
        project = None
    if project is not None and project.egress_guard:
        hosts = egress_hosts(provider)
        if hosts:
            guard = EgressGuard(hosts)
    jail = ProcessJail()
    env = provider_env()
    env["KOVA_PROJECT_PATH"] = str(cwd)
    env["KOVA_RUN_ID"] = run_id
    if guard is not None:
        env = apply_guard_env(env, guard)
    chunks: list[str] = []
    chunks_lock = threading.Lock()

    try:
        use_stdin = bool(provider.get("prompt_via_stdin"))
        process = subprocess.Popen(
            argv,
            cwd=str(cwd),
            stdin=subprocess.PIPE if use_stdin else subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=env,
            **spawn_kwargs(),
        )
        if use_stdin and process.stdin is not None:
            process.stdin.write(prompt)
            process.stdin.close()
        if jail.available:
            jail.assign(process.pid)
        with LOCK:
            PROCESSES[run_id] = process
        _update(hub, run_id, pid=process.pid)

        def drain() -> None:
            stream = process.stdout
            if stream is None:
                return
            last_flush = 0.0
            for line in stream:
                with chunks_lock:
                    chunks.append(line)
                    text = "".join(chunks)
                now = time.monotonic()
                if now - last_flush >= 0.35:
                    _update(
                        hub,
                        run_id,
                        output=stream_display(text, provider)[-400_000:],
                    )
                    last_flush = now
            with chunks_lock:
                text = "".join(chunks)
            _update(hub, run_id, output=stream_display(text, provider)[-400_000:])

        reader = threading.Thread(
            target=drain,
            daemon=True,
            name=f"kova-run-output-{run_id}",
        )
        reader.start()

        current = get_run(hub, run_id) or {}
        if current.get("cancel_requested"):
            _kill(process)
            process.wait()
            reader.join(timeout=3)
            output = "".join(chunks)
            _finish(
                hub,
                run_id,
                status="cancelled",
                output=output,
                exit_code=process.returncode,
                error="запуск отменён",
            )
            return

        try:
            process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            _kill(process)
            process.wait()
            reader.join(timeout=3)
            output = "".join(chunks)
            if (get_run(hub, run_id) or {}).get("shutdown_requested"):
                return
            _finish(
                hub,
                run_id,
                status="failed",
                output=output,
                exit_code=None,
                error=f"превышен лимит {timeout} секунд",
            )
            return

        reader.join(timeout=3)
        output = "".join(chunks)
        current = get_run(hub, run_id) or {}
        if current.get("shutdown_requested"):
            return
        if current.get("cancel_requested"):
            _finish(
                hub,
                run_id,
                status="cancelled",
                output=output,
                exit_code=process.returncode,
                error="запуск отменён",
            )
            return

        if process.returncode == 0:
            _finish(
                hub,
                run_id,
                status="succeeded",
                output=output,
                exit_code=0,
            )
        else:
            _finish(
                hub,
                run_id,
                status="failed",
                output=output,
                exit_code=process.returncode,
                error=f"CLI завершился с кодом {process.returncode}",
            )
    except (OSError, ValueError) as exc:
        if not (get_run(hub, run_id) or {}).get("shutdown_requested"):
            _finish(hub, run_id, status="failed", output="", exit_code=None, error=str(exc))
    finally:
        if guard is not None:
            try:
                _update(hub, run_id, network=guard.summary())
            except (OSError, ValueError):
                pass
            guard.stop()
        jail.close()
        SLOTS.release(hub, run_id)
        with LOCK:
            PROCESSES.pop(run_id, None)
            RUN_HUBS.pop(run_id, None)


def _approval_summary(name: str, args: dict[str, Any]) -> dict[str, Any]:
    summary: dict[str, Any] = {"tool": name}
    if args.get("path"):
        summary["path"] = str(args.get("path"))[:300]
    if args.get("command"):
        summary["command"] = str(args.get("command"))[:600]
    if name == "roblox_command":
        summary["command"] = json.dumps(args, ensure_ascii=False)[:600]
    if isinstance(args.get("content"), str):
        content = args["content"]
        summary["bytes"] = len(content.encode("utf-8"))
        summary["preview"] = content[:400]
    return summary


def _request_approval(
    hub: Path,
    run_id: str,
    name: str,
    args: dict[str, Any],
    timeout: int = 600,
) -> bool:
    current = get_run(hub, run_id) or {}
    if current.get("auto_approve"):
        return True
    approval = {
        "id": new_id("appr"),
        "tool": name,
        "args": _approval_summary(name, args),
        "status": "pending",
        "created_at": _now(),
    }
    _update(hub, run_id, status="waiting_approval", approval=approval)
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        record = get_run(hub, run_id) or {}
        if record.get("cancel_requested") or record.get("shutdown_requested"):
            _update(
                hub,
                run_id,
                status="running",
                approval={**approval, "status": "denied"},
            )
            return False
        state = str((record.get("approval") or {}).get("status") or "")
        if state in {"allowed", "denied", "allowed_all"}:
            if state == "allowed_all":
                _update(hub, run_id, auto_approve=True)
            _update(
                hub,
                run_id,
                status="running",
                approval={**approval, "status": state},
            )
            return state in {"allowed", "allowed_all"}
        time.sleep(0.25)
    _update(
        hub,
        run_id,
        status="running",
        approval={**approval, "status": "timeout"},
    )
    return False


def decide_approval(hub: Path, run_id: str, decision: str) -> dict[str, Any] | None:
    record = get_run(hub, run_id)
    if record is None:
        return None
    approval = dict(record.get("approval") or {})
    if approval.get("status") != "pending":
        return record
    status = {
        "allow": "allowed",
        "deny": "denied",
        "allow_all": "allowed_all",
    }.get(decision)
    if status is None:
        raise RuntimeError("неизвестное решение")
    approval["status"] = status
    updated = _update(hub, run_id, approval=approval)
    append_event(
        hub,
        LedgerEvent(
            type="agent.approval.decided",
            subject=str(record.get("task_id") or ""),
            actor="human",
            data={
                "run_id": run_id,
                "tool": str((approval.get("args") or {}).get("tool") or approval.get("tool") or ""),
                "decision": status,
            },
        ),
    )
    return updated


def _execute_api(
    hub: Path,
    run_id: str,
    provider: dict[str, Any],
    prompt: str,
    cwd: Path,
    tool_policy: str,
) -> None:
    current = get_run(hub, run_id) or {}
    if current.get("shutdown_requested"):
        return
    if current.get("cancel_requested"):
        _finish(
            hub,
            run_id,
            status="cancelled",
            output="",
            exit_code=None,
            error="запуск отменён",
        )
        return
    if not SLOTS.acquire(hub, run_id):
        current = get_run(hub, run_id) or {}
        if not current.get("shutdown_requested"):
            _finish(
                hub,
                run_id,
                status="cancelled",
                output="",
                exit_code=None,
                error="запуск отменён",
            )
        return
    _update(hub, run_id, status="running", started_at=_now(), queue_position=0)
    try:
        from .providers import is_local_url

        api_key = get_secret(str(provider["id"]))
        if not api_key and not is_local_url(str(provider.get("api_url") or "")):
            raise RuntimeError("API-ключ не сохранён в защищённом хранилище")

        def on_text(text: str) -> None:
            _update(hub, run_id, output=text[-400_000:])

        def should_stop() -> bool:
            return bool((get_run(hub, run_id) or {}).get("cancel_requested"))

        def approve(name: str, args: dict[str, Any]) -> bool:
            return _request_approval(hub, run_id, name, args)

        output, usage, actions = run_agent(
            provider,
            prompt,
            api_key,
            cwd,
            tool_policy,
            on_text=on_text,
            should_stop=should_stop,
            approve=approve,
        )
        if (get_run(hub, run_id) or {}).get("shutdown_requested"):
            return
        _finish(
            hub,
            run_id,
            status="succeeded",
            output=output,
            exit_code=0,
            usage=usage,
            actions=actions,
        )
    except RunCancelled:
        if (get_run(hub, run_id) or {}).get("shutdown_requested"):
            return
        output = str((get_run(hub, run_id) or {}).get("output") or "")
        _finish(
            hub,
            run_id,
            status="cancelled",
            output=output,
            exit_code=None,
            error="запуск отменён",
        )
    except Exception as exc:
        if not (get_run(hub, run_id) or {}).get("shutdown_requested"):
            _finish(
                hub,
                run_id,
                status="failed",
                output="",
                exit_code=None,
                error=str(exc)[:1000],
            )
    finally:
        SLOTS.release(hub, run_id)
        with LOCK:
            PROCESSES.pop(run_id, None)
            RUN_HUBS.pop(run_id, None)


def _finish(
    hub: Path,
    run_id: str,
    status: str,
    output: str,
    exit_code: int | None,
    error: str = "",
    interrupted_reason: str = "",
    usage: dict[str, Any] | None = None,
    actions: list[dict[str, Any]] | None = None,
    approval: dict[str, Any] | None = None,
) -> None:
    record = get_run(hub, run_id) or {}
    finished = _now()
    provider = get_provider(str(record.get("provider_id") or "")) or {}
    parsed = parse_output(output, provider)
    output = str(parsed.get("display") or output)
    cli_session_id = str(parsed.get("session_id") or record.get("cli_session_id") or "")
    if usage is None:
        usage = parsed.get("usage")
    if actions is None:
        actions = parsed.get("actions") or []
    changes: list[dict[str, object]] = []
    changes_total = 0
    changes_truncated = False
    changes_error = ""
    snapshot_id = str(record.get("snapshot_id") or "")
    if snapshot_id:
        try:
            worktree_path = str(record.get("worktree_path") or "")
            diff = diff_snapshot(
                hub,
                snapshot_id,
                patch_dir=hub / "agents" / "diffs" / run_id,
                root=Path(worktree_path) if worktree_path else None,
            )
            changes = list(diff.get("changes") or [])
            changes_total = int(diff.get("total") or len(changes))
            changes_truncated = bool(diff.get("truncated"))
        except (OSError, ValueError) as exc:
            changes_error = str(exc)
    else:
        changes_error = "Снапшот не создавался: дифф изменений недоступен."
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
        event_type = "ai.run.finished"
        if status == "interrupted":
            event_type = "agent.run.interrupted"
        elif status != "succeeded":
            event_type = "ai.run.failed"
        append_event(
            hub,
            LedgerEvent(
                type=event_type,
                subject=str(record.get("task_id") or ""),
                actor=str(record.get("provider_name") or "AI"),
                data={
                    "run_id": run_id,
                    "status": status,
                    "exit_code": exit_code,
                    "review_id": review_id,
                    "session_id": record.get("session_id") or "",
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
        interrupted_reason=interrupted_reason,
        finished_at=finished,
        log_path=log_path,
        artifact_path=artifact_path,
        review_id=review_id,
        changes=changes,
        changes_total=changes_total,
        changes_truncated=changes_truncated,
        changes_error=changes_error,
        queue_position=0,
        cli_session_id=cli_session_id,
        usage=usage,
        actions=actions,
        approval=None,
    )
    step_id = str(record.get("workflow_step_id") or "")
    if step_id:
        task = get_task(hub, str(record.get("task_id") or ""))
        if task is not None:
            step = next((item for item in task.workflow if item.id == step_id), None)
            if step is not None:
                step.run_id = run_id
                step.status = (
                    "done"
                    if status == "succeeded"
                    else "failed"
                    if status == "failed"
                    else "pending"
                )
                save_task(hub, task)
    sessions.set_cli_session(hub, str(record.get("session_id") or ""), cli_session_id)
    sessions.finish_session(hub, str(record.get("session_id") or ""), status)


def _prepare_handoff(
    hub: Path,
    task,
    provider: dict[str, Any],
    from_session_id: str,
    persist: bool = True,
) -> tuple[dict[str, Any], str]:
    source = sessions.get_session(hub, from_session_id)
    if source is None or source.get("task_id") != task.id:
        raise RuntimeError("сессия для передачи не найдена")
    source_runs = [
        run
        for run in (get_run(hub, str(run_id)) for run_id in source.get("run_ids") or [])
        if run is not None
    ]
    if any(run.get("status") in {"queued", "running"} for run in source_runs):
        raise RuntimeError("нельзя передать активную сессию")
    source_run = source_runs[-1] if source_runs else None
    summary = ""
    if source_run:
        summary = str(source_run.get("output") or source_run.get("error") or "")
    summary = summary.strip()[:6000]
    if persist:
        record = handoffs.create_handoff(
            hub,
            task.id,
            task.title,
            source,
            source_run,
            str(provider["id"]),
            str(provider["name"]),
            summary,
        )
    else:
        record = handoffs.build_handoff(
            task.id,
            task.title,
            source,
            source_run,
            str(provider["id"]),
            str(provider["name"]),
            summary,
        )
    return record, handoffs.handoff_text(record)


def preview_handoff(
    hub: Path,
    task_id: str,
    from_session_id: str,
    to_provider_id: str,
) -> dict[str, Any]:
    task = get_task(hub, task_id)
    if task is None:
        raise FileNotFoundError("task not found")
    provider = get_provider(to_provider_id)
    if provider is None:
        raise RuntimeError("AI-провайдер не найден")
    record, text = _prepare_handoff(hub, task, provider, from_session_id, persist=False)
    return {**record, "text": text}


def start_run(
    hub: Path,
    task_id: str,
    provider_id: str | None = None,
    snapshot: bool = True,
    message: str = "",
    model: str | None = None,
    handoff_from_session: str | None = None,
    read_only: bool = False,
    resume_from_session: str | None = None,
    workflow_step_id: str = "",
    role_id: str = "",
    tool_policy: str = "workspace",
) -> dict[str, Any]:
    reconcile_runs(hub)
    task = get_task(hub, task_id)
    if task is None:
        raise FileNotFoundError("task not found")
    provider = get_provider(provider_id)
    if provider is None:
        raise RuntimeError("AI-провайдер не найден")
    is_api = provider.get("kind") == "api"
    if not provider.get("installed"):
        if is_api:
            raise FileNotFoundError(
                f"{provider.get('name')}: API не настроен. Укажи endpoint, модель и ключ."
            )
        raise FileNotFoundError(
            f"{provider.get('name')}: CLI не найден. Укажи путь в разделе «Агенты»."
        )
    if not provider.get("enabled", True):
        raise RuntimeError(f"{provider.get('name')} выключен")
    if (
        not is_api
        and any("{model}" in str(item) for item in provider.get("args") or [])
        and not model
    ):
        raise RuntimeError("выберите модель для этого провайдера")
    if is_api and not provider.get("api_model"):
        raise RuntimeError("не задана API-модель")
    if is_api and tool_policy not in {"read-only", "workspace", "auto"}:
        raise RuntimeError("неизвестная политика инструментов")
    if is_api and read_only:
        tool_policy = "read-only"
    project_budget = int(load_project(hub).token_budget or 0)
    if project_budget > 0:
        summary = usage_report.usage_summary(hub, project_budget)
        if summary["exhausted"]:
            raise RuntimeError(
                f"лимит токенов исчерпан: {summary['used']} из {project_budget} "
                "(по известным запускам)"
            )
    provider_budget = int(provider.get("token_budget") or 0)
    if provider_budget > 0:
        summary = usage_report.usage_summary(hub)
        used = next(
            (row["used"] for row in summary.get("providers", []) if row.get("id") == provider["id"]),
            0,
        )
        if used >= provider_budget:
            raise RuntimeError(
                f"лимит токенов провайдера {provider.get('name')} исчерпан: "
                f"{used} из {provider_budget}"
            )

    if task.status not in {TaskStatus.archived, TaskStatus.done}:
        task.status = TaskStatus.working
        save_task(hub, task)

    workflow_step = None
    if workflow_step_id:
        workflow_step = next(
            (item for item in task.workflow if item.id == workflow_step_id),
            None,
        )
        if workflow_step is None:
            raise RuntimeError("шаг workflow не найден")
        if workflow_step.status == "done":
            raise RuntimeError("шаг уже выполнен")
        if not message.strip():
            message = workflow_step.prompt

    handoff: dict[str, Any] | None = None
    handoff_text = ""
    if handoff_from_session:
        handoff, handoff_text = _prepare_handoff(
            hub,
            task,
            provider,
            handoff_from_session,
            persist=True,
        )
        append_event(
            hub,
            LedgerEvent(
                type="agent.handoff.created",
                subject=task.id,
                actor=str(provider["name"]),
                data={
                    "handoff_id": handoff["id"],
                    "from_session": handoff.get("from_session_id"),
                    "to_provider": provider["id"],
                },
            ),
        )

    run_id = new_id("run")
    if workflow_step is not None:
        workflow_step.status = "active"
        workflow_step.run_id = run_id
        save_task(hub, task)
    project = load_project(hub)
    cwd = hub.parent
    worktree_path = ""
    isolation = "direct"
    if project.isolation == IsolationMode.worktree:
        try:
            worktree = worktrees.create_worktree(hub.parent, run_id)
        except (OSError, RuntimeError, subprocess.SubprocessError) as exc:
            raise RuntimeError(f"worktree: {exc}") from exc
        cwd = worktree
        worktree_path = str(worktree)
        isolation = "worktree"
        snapshot = True
    elif project.isolation == IsolationMode.sandbox:
        try:
            sandbox = worktrees.create_sandbox(hub.parent, run_id)
        except (OSError, RuntimeError, subprocess.SubprocessError) as exc:
            raise RuntimeError(f"sandbox: {exc}") from exc
        cwd = sandbox
        worktree_path = str(sandbox)
        isolation = "sandbox"
        snapshot = True

    role = routing.get_role(role_id) if role_id else None
    role_prefix = ""
    if role is not None:
        role_prefix = (
            "## Роль\n"
            f"{role.get('name')}\n"
            f"{role.get('prompt') or ''}\n\n"
        )
    resume_source: dict[str, Any] | None = None
    resume_cli_id = ""
    if resume_from_session:
        if is_api:
            raise RuntimeError("resume недоступен для API-провайдера")
        if handoff:
            raise RuntimeError("нельзя одновременно продолжить и передать сессию")
        resume_source = sessions.get_session(hub, resume_from_session)
        if resume_source is None or resume_source.get("task_id") != task.id:
            raise RuntimeError("сессия для продолжения не найдена")
        if str(resume_source.get("provider_id") or "") != str(provider["id"]):
            raise RuntimeError(
                "CLI-resume возможен только тем же провайдером. Для другого используй «Передать»."
            )
        resume_cli_id = str(resume_source.get("cli_session_id") or "")
        if not resume_cli_id:
            raise RuntimeError("CLI не вернул идентификатор сессии — resume недоступен")
        if not provider.get("resume_args"):
            raise RuntimeError("для провайдера не настроены аргументы resume")
        prompt = message.strip() or "Продолжи работу над задачей с того места, где остановился."
        argv = build_resume_command(
            provider,
            prompt,
            resume_cli_id,
            model or "",
            read_only=read_only,
        )
    else:
        prompt = role_prefix + _prompt_for(
            hub,
            task,
            provider,
            message,
            handoff_text,
            root=cwd,
            read_only=read_only,
        )
        if is_api:
            argv = []
            prompt += (
                "API-режим: у тебя нет доступа к файлам и терминалу. "
                "Верни план, анализ или код текстом.\n"
            )
        else:
            argv = build_command(
                provider,
                prompt,
                model or "",
                read_only=read_only,
                prompt_via_stdin=bool(provider.get("prompt_via_stdin")),
            )
    role = routing.get_role(role_id) if role_id else None
    if role is not None and not resume_from_session:
        prompt = (
            "## Роль\n"
            f"{role.get('name')}\n"
            f"{role.get('prompt') or ''}\n\n"
            + prompt
        )

    snapshot_id = ""
    snapshot_error = ""
    if snapshot:
        try:
            snap = create_snapshot(
                hub,
                f"before AI run: {task.title}",
                created_by="kova",
                root=cwd,
            )
            snapshot_id = snap.id
        except (OSError, ValueError) as exc:
            snapshot_error = str(exc)

    try:
        if resume_source is not None:
            session = sessions.reopen_session(hub, str(resume_source["id"]))
            if session is None:
                raise OSError("session not found")
        else:
            session = sessions.get_or_create_session(
                hub,
                task.id,
                task.title,
                str(provider["id"]),
                str(provider["name"]),
                snapshot_id,
                handoff_id=str(handoff["id"]) if handoff else "",
                force_new=handoff is not None,
            )
        session = sessions.attach_run(hub, str(session["id"]), run_id) or session
        session_id = str(session.get("id") or "")
    except OSError:
        session_id = ""

    record: dict[str, Any] = {
        "id": run_id,
        "task_id": task.id,
        "task_title": task.title,
        "session_id": session_id,
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
        "command": provider.get("api_url") if is_api else provider.get("command"),
        "args": [] if is_api else provider.get("args"),
        "model": model or (str(provider.get("api_model") or "") if is_api else ""),
        "handoff_id": str(handoff["id"]) if handoff else "",
        "changes": [],
        "changes_total": 0,
        "changes_truncated": False,
        "changes_error": "",
        "pid": None,
        "interrupted_reason": "",
        "queue_position": 0,
        "max_parallel_runs": 0,
        "isolation": isolation,
        "read_only": read_only,
        "tool_policy": tool_policy if is_api else "",
        "approval": None,
        "auto_approve": False,
        "resumed": resume_source is not None,
        "workflow_step_id": workflow_step_id,
        "role_id": str(role.get("id") or "") if role else "",
        "role_name": str(role.get("name") or "") if role else "",
        "resumed_from_session": str(resume_source.get("id") or "") if resume_source else "",
        "resumed_from_run": str(
            (resume_source.get("run_ids") or [""])[-1] if resume_source else ""
        ),
        "cli_session_id": resume_cli_id,
        "usage": None,
        "actions": [],
        "network": [],
        "worktree_path": worktree_path,
        "worktree_applied_at": "",
        "worktree_applied": 0,
        "worktree_deleted": 0,
    }
    with LOCK:
        RUNS[run_id] = record
        RUN_HUBS[run_id] = hub
    _save(hub, record)
    _update(
        hub,
        run_id,
        queue_position=SLOTS.position(hub, run_id),
        max_parallel_runs=max(1, int(load_project(hub).max_parallel_runs or 1)),
    )
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
        target=_execute_api if is_api else _execute,
        args=(hub, run_id, provider, prompt, cwd, tool_policy)
        if is_api
        else (hub, run_id, provider, prompt, argv, cwd),
        daemon=True,
        name=f"kova-run-{run_id}",
    )
    thread.start()
    return get_run(hub, run_id) or record


def cancel_run(hub: Path, run_id: str) -> dict[str, Any] | None:
    reconcile_runs(hub)
    record = get_run(hub, run_id)
    if record is None:
        return None
    if record.get("status") not in {"queued", "running", "waiting_approval"}:
        return record
    _update(hub, run_id, cancel_requested=True)
    with LOCK:
        process = PROCESSES.get(run_id)
    if process is not None:
        _kill(process)
    elif run_id not in RUNS:
        _finish(
            hub,
            run_id,
            status="cancelled",
            output=str(record.get("output") or ""),
            exit_code=None,
            error="процесс уже завершился",
        )
    return get_run(hub, run_id)


def shutdown_runs() -> None:
    with LOCK:
        rows = list(RUNS.items())
        active = list(PROCESSES.items())
        hubs = dict(RUN_HUBS)
    for run_id, record in rows:
        if record.get("status") not in {"queued", "running", "waiting_approval"}:
            continue
        hub = hubs.get(run_id)
        if hub is None:
            continue
        _update(hub, run_id, shutdown_requested=True)
    for run_id, process in active:
        _kill(process)
    for run_id, record in rows:
        if record.get("status") not in {"queued", "running", "waiting_approval"}:
            continue
        hub = hubs.get(run_id)
        if hub is None:
            continue
        reason = "core остановлен до завершения запуска"
        _update(
            hub,
            run_id,
            status="interrupted",
            finished_at=_now(),
            error=reason,
            interrupted_reason=reason,
        )
        sessions.finish_session(hub, str(record.get("session_id") or ""), "interrupted")
        append_event(
            hub,
            LedgerEvent(
                type="agent.run.interrupted",
                subject=str(record.get("task_id") or ""),
                actor=str(record.get("provider_name") or "AI"),
                data={"run_id": run_id, "reason": "core shutdown"},
            ),
        )


def apply_worktree_run(hub: Path, run_id: str) -> dict[str, Any]:
    record = get_run(hub, run_id)
    if record is None:
        raise FileNotFoundError("run not found")
    if record.get("status") in {"queued", "running"}:
        raise RuntimeError("запуск ещё не завершён")
    worktree_path = str(record.get("worktree_path") or "")
    if not worktree_path:
        raise RuntimeError("у запуска нет worktree")
    if record.get("worktree_applied_at"):
        raise RuntimeError("изменения уже применены")
    worktree = Path(worktree_path)
    if not worktree.is_dir():
        raise RuntimeError("папка worktree не найдена")
    try:
        create_snapshot(
            hub,
            f"before apply worktree: {record.get('task_title') or run_id}",
            created_by="kova",
        )
    except (OSError, ValueError):
        pass
    counters = worktrees.apply_changes(
        hub.parent,
        worktree,
        list(record.get("changes") or []),
    )
    conflicts = list(counters.get("conflicts") or [])
    if conflicts:
        raise RuntimeError(
            "конфликт: эти файлы изменены в проекте после запуска: "
            + ", ".join(conflicts[:8])
        )
    if str(record.get("isolation") or "") == "sandbox":
        worktrees.remove_sandbox(hub.parent, worktree)
    else:
        worktrees.remove_worktree(hub.parent, worktree)
    updated = _update(
        hub,
        run_id,
        worktree_applied_at=_now(),
        worktree_applied=int(counters["applied"]),
        worktree_deleted=int(counters["deleted"]),
    )
    append_event(
        hub,
        LedgerEvent(
            type="agent.worktree.applied",
            subject=str(record.get("task_id") or ""),
            actor=str(record.get("provider_name") or "AI"),
            data={
                "run_id": run_id,
                "applied": counters["applied"],
                "deleted": counters["deleted"],
                "skipped": counters["skipped"],
            },
        ),
    )
    return updated or record
