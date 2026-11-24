import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..domain.ids import new_id

LOCK = threading.Lock()
TERMINAL = {"completed", "failed", "cancelled", "interrupted"}


def _now() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def sessions_dir(hub: Path) -> Path:
    return hub / "agents" / "sessions"


def _file(hub: Path, session_id: str) -> Path:
    return sessions_dir(hub) / f"{session_id}.json"


def _save(hub: Path, record: dict[str, Any]) -> None:
    path = _file(hub, str(record["id"]))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(record, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def get_session(hub: Path, session_id: str) -> dict[str, Any] | None:
    if not session_id:
        return None
    try:
        payload = json.loads(_file(hub, session_id).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return payload if isinstance(payload, dict) else None


def list_sessions(hub: Path, task_id: str | None = None) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    directory = sessions_dir(hub)
    if directory.is_dir():
        for path in directory.glob("ses_*.json"):
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if not isinstance(payload, dict):
                continue
            if task_id and payload.get("task_id") != task_id:
                continue
            rows.append(payload)
    rows.sort(key=lambda row: str(row.get("created_at") or ""), reverse=True)
    return rows


def get_or_create_session(
    hub: Path,
    task_id: str,
    task_title: str,
    provider_id: str,
    provider_name: str,
    snapshot_id: str = "",
    handoff_id: str = "",
    force_new: bool = False,
) -> dict[str, Any]:
    with LOCK:
        if not force_new:
            for row in list_sessions(hub, task_id):
                if row.get("status") == "active":
                    if snapshot_id and not row.get("snapshot_before"):
                        row["snapshot_before"] = snapshot_id
                        row["updated_at"] = _now()
                        _save(hub, row)
                    return row
        record: dict[str, Any] = {
            "id": new_id("ses"),
            "task_id": task_id,
            "task_title": task_title,
            "provider_id": provider_id,
            "provider_name": provider_name,
            "status": "active",
            "created_at": _now(),
            "updated_at": _now(),
            "finished_at": "",
            "snapshot_before": snapshot_id,
            "handoff_id": handoff_id,
            "cli_session_id": "",
            "run_ids": [],
        }
        _save(hub, record)
        return record


def attach_run(hub: Path, session_id: str, run_id: str) -> dict[str, Any] | None:
    with LOCK:
        record = get_session(hub, session_id)
        if record is None:
            return None
        run_ids = list(record.get("run_ids") or [])
        if run_id not in run_ids:
            run_ids.append(run_id)
        record["run_ids"] = run_ids
        record["updated_at"] = _now()
        _save(hub, record)
        return record


def finish_session(hub: Path, session_id: str, run_status: str) -> dict[str, Any] | None:
    if not session_id:
        return None
    status = {
        "succeeded": "completed",
        "failed": "failed",
        "cancelled": "cancelled",
        "interrupted": "interrupted",
    }.get(run_status)
    if status is None:
        return get_session(hub, session_id)
    with LOCK:
        record = get_session(hub, session_id)
        if record is None:
            return None
        if record.get("status") in TERMINAL:
            return record
        record["status"] = status
        record["finished_at"] = _now()
        record["updated_at"] = _now()
        _save(hub, record)
        return record


def interrupt_active_sessions(hub: Path, active_run_ids: set[str]) -> list[dict[str, Any]]:
    changed: list[dict[str, Any]] = []
    for row in list_sessions(hub):
        if row.get("status") != "active":
            continue
        run_ids = set(row.get("run_ids") or [])
        if run_ids & active_run_ids:
            continue
        with LOCK:
            current = get_session(hub, str(row["id"]))
            if current is None or current.get("status") != "active":
                continue
            current["status"] = "interrupted"
            current["finished_at"] = _now()
            current["updated_at"] = _now()
            _save(hub, current)
            changed.append(current)
    return changed


def set_cli_session(
    hub: Path,
    session_id: str,
    cli_session_id: str,
) -> dict[str, Any] | None:
    if not session_id or not cli_session_id:
        return get_session(hub, session_id)
    with LOCK:
        record = get_session(hub, session_id)
        if record is None:
            return None
        record["cli_session_id"] = cli_session_id
        record["updated_at"] = _now()
        _save(hub, record)
        return record


def reopen_session(hub: Path, session_id: str) -> dict[str, Any] | None:
    with LOCK:
        record = get_session(hub, session_id)
        if record is None:
            return None
        if record.get("status") == "active":
            return record
        record["status"] = "active"
        record["finished_at"] = ""
        record["updated_at"] = _now()
        _save(hub, record)
        return record
