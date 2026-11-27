import threading
import time
from datetime import datetime
from pathlib import Path

from ..domain.common import utc_now
from ..domain.ledger import LedgerEvent
from ..domain.night import NightEntry, NightShiftRun
from ..storage.ledger import append_event
from ..storage.night import load_night, save_night
from ..storage.projects import read_active_hub
from ..storage.tasks import get_task
from . import runner
from .providers import get_provider

_STATE_LOCK = threading.Lock()
_STOP = threading.Event()
_THREAD: threading.Thread | None = None
_TERMINAL = {"succeeded", "failed", "cancelled", "interrupted"}


def night_running() -> bool:
    return _THREAD is not None and _THREAD.is_alive()


def stop_night_shift() -> None:
    _STOP.set()


def start_night_shift(
    hub: Path,
    provider_id: str,
    task_ids: list[str],
    stop_on_error: bool,
) -> None:
    global _THREAD
    _STOP.clear()
    thread = threading.Thread(
        target=_execute,
        args=(hub, provider_id, task_ids, stop_on_error),
        daemon=True,
        name="kova-night-shift",
    )
    with _STATE_LOCK:
        _THREAD = thread
    thread.start()


def begin_run(
    hub: Path,
    provider_id: str,
    task_ids: list[str],
    stop_on_error: bool,
) -> None:
    state = load_night(hub)
    entries = []
    for task_id in task_ids:
        task = get_task(hub, task_id)
        if task is None:
            continue
        entries.append(NightEntry(task_id=task.id, task_title=task.title))
    if not entries:
        return
    state.config.task_ids = [entry.task_id for entry in entries]
    state.config.provider_id = provider_id
    state.run = NightShiftRun(
        status="queued",
        started_at=utc_now(),
        entries=entries,
    )
    save_night(hub, state)
    start_night_shift(hub, provider_id, [entry.task_id for entry in entries], stop_on_error)


def scheduler_loop() -> None:
    last_fired = ""
    while True:
        try:
            hub = read_active_hub()
            if hub is not None:
                state = load_night(hub)
                config = state.config
                running = state.run is not None and state.run.status in {"queued", "running"}
                if config.enabled and config.task_ids and not running and not night_running():
                    now = datetime.now()
                    minute = now.strftime("%H:%M")
                    stamp = f"{now.date().isoformat()} {minute}"
                    if minute == config.start_at and stamp != last_fired:
                        provider = get_provider(config.provider_id or None)
                        if provider is not None:
                            last_fired = stamp
                            begin_run(
                                hub,
                                config.provider_id,
                                config.task_ids[: config.max_tasks],
                                config.stop_on_error,
                            )
        except Exception:
            pass
        time.sleep(20)


def _save(hub: Path, state) -> None:
    with _STATE_LOCK:
        save_night(hub, state)


def _execute(
    hub: Path,
    provider_id: str,
    task_ids: list[str],
    stop_on_error: bool,
) -> None:
    state = load_night(hub)
    run = state.run
    if run is None:
        return
    run.status = "running"
    _save(hub, state)
    failed = False
    try:
        for index, entry in enumerate(run.entries):
            if _STOP.is_set():
                run.status = "stopped"
                break
            run.current_index = index
            task = get_task(hub, entry.task_id)
            if task is None:
                entry.status = "skipped"
                entry.message = "Задача не найдена"
                _save(hub, state)
                continue
            active = [
                row
                for row in runner.list_runs(hub, task.id, limit=20)
                if row.get("status") in {"queued", "running"}
            ]
            if active:
                entry.status = "skipped"
                entry.message = "У задачи уже есть активный AI-запуск"
                _save(hub, state)
                continue
            entry.status = "running"
            _save(hub, state)
            try:
                record = runner.start_run(
                    hub,
                    task.id,
                    provider_id or None,
                    snapshot=True,
                    message="Ночная смена: выполни задачу по брифу и оставь результат в Review.",
                )
            except (FileNotFoundError, RuntimeError, OSError) as exc:
                entry.status = "failed"
                entry.message = str(exc)
                failed = True
                _save(hub, state)
                if stop_on_error:
                    break
                continue
            entry.run_id = str(record.get("id") or "")
            _save(hub, state)

            deadline = time.monotonic() + 2 * 60 * 60
            terminal = ""
            result_row = None
            while time.monotonic() < deadline:
                if _STOP.is_set():
                    run.status = "stopped"
                    break
                rows = runner.list_runs(hub, task.id, limit=50)
                result_row = next(
                    (row for row in rows if str(row.get("id")) == entry.run_id),
                    None,
                )
                terminal = str(result_row.get("status") or "") if result_row else ""
                if terminal in _TERMINAL:
                    break
                time.sleep(1)
            if run.status == "stopped":
                break
            if terminal not in _TERMINAL:
                entry.status = "failed"
                entry.message = "Запуск не завершился за 2 часа"
                failed = True
                _save(hub, state)
                if stop_on_error:
                    break
                continue
            entry.status = "succeeded" if terminal == "succeeded" else terminal
            entry.review_id = str(result_row.get("review_id") or "") if result_row else ""
            entry.message = str(
                (result_row.get("error") if result_row else "") or ""
            )[:400]
            _save(hub, state)
            if entry.status != "succeeded":
                failed = True
                if stop_on_error:
                    break
            if _STOP.is_set():
                run.status = "stopped"
                break
        if run.status != "stopped":
            run.status = "failed" if failed else "done"
    finally:
        run.finished_at = run.started_at or run.finished_at
        from ..domain.common import utc_now

        run.finished_at = utc_now()
        if run.status == "running":
            run.status = "failed"
        _save(hub, state)
        append_event(
            hub,
            LedgerEvent(
                type="night.finished",
                subject=run.id,
                data={
                    "status": run.status,
                    "tasks": len(run.entries),
                    "succeeded": sum(1 for entry in run.entries if entry.status == "succeeded"),
                    "failed": sum(1 for entry in run.entries if entry.status == "failed"),
                },
            ),
        )
