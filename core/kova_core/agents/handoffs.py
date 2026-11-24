import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..domain.ids import new_id

LOCK = threading.Lock()


def _now() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def handoffs_dir(hub: Path) -> Path:
    return hub / "agents" / "handoffs"


def _file(hub: Path, handoff_id: str) -> Path:
    return handoffs_dir(hub) / f"{handoff_id}.json"


def _save(hub: Path, record: dict[str, Any]) -> None:
    path = _file(hub, str(record["id"]))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(record, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def get_handoff(hub: Path, handoff_id: str) -> dict[str, Any] | None:
    try:
        payload = json.loads(_file(hub, handoff_id).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return payload if isinstance(payload, dict) else None


def build_handoff(
    task_id: str,
    task_title: str,
    from_session: dict[str, Any],
    from_run: dict[str, Any] | None,
    to_provider_id: str,
    to_provider_name: str,
    summary: str,
) -> dict[str, Any]:
    return {
        "id": new_id("hnd"),
        "task_id": task_id,
        "task_title": task_title,
        "from_session_id": str(from_session.get("id") or ""),
        "from_provider_id": str(from_session.get("provider_id") or ""),
        "from_provider_name": str(from_session.get("provider_name") or ""),
        "from_session_status": str(from_session.get("status") or ""),
        "from_run_id": str(from_run.get("id") or "") if from_run else "",
        "from_run_status": str(from_run.get("status") or "") if from_run else "",
        "snapshot_id": str(from_run.get("snapshot_id") or "") if from_run else "",
        "to_provider_id": to_provider_id,
        "to_provider_name": to_provider_name,
        "summary": summary,
        "created_at": _now(),
    }


def save_handoff(hub: Path, record: dict[str, Any]) -> dict[str, Any]:
    with LOCK:
        _save(hub, record)
    return record


def create_handoff(
    hub: Path,
    task_id: str,
    task_title: str,
    from_session: dict[str, Any],
    from_run: dict[str, Any] | None,
    to_provider_id: str,
    to_provider_name: str,
    summary: str,
) -> dict[str, Any]:
    record = build_handoff(
        task_id,
        task_title,
        from_session,
        from_run,
        to_provider_id,
        to_provider_name,
        summary,
    )
    return save_handoff(hub, record)


def handoff_text(record: dict[str, Any]) -> str:
    lines = [
        "\n## Передача работы",
        f"Предыдущий агент: {record.get('from_provider_name') or 'неизвестно'}",
        f"Статус предыдущей сессии: {record.get('from_session_status') or 'неизвестно'}",
    ]
    if record.get("from_run_status"):
        lines.append(f"Статус последнего запуска: {record['from_run_status']}")
    if record.get("snapshot_id"):
        lines.append(f"Снапшот перед предыдущим запуском: {record['snapshot_id']}")
    summary = str(record.get("summary") or "").strip()
    if summary:
        lines.append("Вывод предыдущего агента:")
        lines.append(summary)
    lines.append(
        "Продолжи работу с этого места. Не переписывай уже сделанное без причины."
    )
    return "\n".join(lines) + "\n"
