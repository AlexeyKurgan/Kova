from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .chats import list_chats
from .storage.assets import list_assets
from .storage.tasks import list_tasks


def _short(value: Any, limit: int = 240) -> str:
    text = " ".join(str(value or "").split())
    return text if len(text) <= limit else text[:limit] + "…"


def _read_jsonl(path: Path, limit: int = 500) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    rows: list[dict[str, Any]] = []
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return []
    for line in lines[-limit:]:
        text = line.strip()
        if not text:
            continue
        try:
            row = json.loads(text)
        except ValueError:
            continue
        if isinstance(row, dict):
            rows.append(row)
    return rows


def _task_results(tasks: list[Any], query: str, limit: int) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for task in tasks:
        haystack = " ".join(
            [
                task.title,
                task.goal,
                " ".join(item.text for item in task.criteria),
                task.next_step,
                " ".join(task.tags),
                task.assigned_agent or "",
            ]
        ).lower()
        if query and query not in haystack:
            continue
        snippet = task.goal or task.next_step or "; ".join(item.text for item in task.criteria)
        rows.append(
            {
                "kind": "task",
                "id": task.id,
                "title": task.title,
                "snippet": _short(snippet),
                "meta": f"{task.status.value} · {task.type.value} · {task.updated_at.isoformat(timespec='minutes')}",
                "link": task.id,
                "updated_at": task.updated_at.isoformat(),
            }
        )
    rows.sort(key=lambda row: row["updated_at"], reverse=True)
    return rows[:limit]


def _asset_results(assets: list[Any], query: str, limit: int) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for asset in assets:
        haystack = " ".join(
            [
                asset.name,
                asset.description,
                asset.path,
                asset.origin,
                asset.license,
                " ".join(asset.task_ids),
            ]
        ).lower()
        if query and query not in haystack:
            continue
        rows.append(
            {
                "kind": "asset",
                "id": asset.id,
                "title": asset.name,
                "snippet": _short(asset.description or asset.path),
                "meta": f"{asset.type.value} · {asset.engine.value} · {asset.updated_at.isoformat(timespec='minutes')}",
                "link": asset.id,
                "updated_at": asset.updated_at.isoformat(),
            }
        )
    rows.sort(key=lambda row: row["updated_at"], reverse=True)
    return rows[:limit]


def _chat_results(chats: list[dict[str, Any]], query: str, limit: int) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for chat in chats:
        haystack = f"{chat.get('title') or ''} {chat.get('last_message') or ''}".lower()
        if query and query not in haystack:
            continue
        rows.append(
            {
                "kind": "chat",
                "id": str(chat.get("id") or ""),
                "title": str(chat.get("title") or "Чат"),
                "snippet": _short(chat.get("last_message") or ""),
                "meta": f"{chat.get('message_count') or 0} сообщений · {chat.get('updated_at') or ''}",
                "link": "",
                "updated_at": str(chat.get("updated_at") or ""),
            }
        )
    rows.sort(key=lambda row: row["updated_at"], reverse=True)
    return rows[:limit]


def _event_results(rows: list[dict[str, Any]], query: str, limit: int) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for event in rows:
        payload = event.get("data") if isinstance(event.get("data"), dict) else {}
        haystack = " ".join(
            [str(event.get("type") or ""), str(event.get("actor") or ""), str(event.get("subject") or "")]
            + [str(value) for value in payload.values()]
        ).lower()
        if query and query not in haystack:
            continue
        title = str(payload.get("title") or payload.get("name") or event.get("type") or "Событие")
        subject = str(event.get("subject") or "")
        link = subject if subject.startswith(("task_", "asst_")) else ""
        result.append(
            {
                "kind": "event",
                "id": str(event.get("id") or ""),
                "title": title,
                "snippet": _short(
                    f"{event.get('type') or ''} · {event.get('actor') or ''} · "
                    f"{payload.get('path') or payload.get('title') or ''}"
                ),
                "meta": str(event.get("at") or ""),
                "link": link,
                "updated_at": str(event.get("at") or ""),
            }
        )
    return result[:limit]


def _decision_results(rows: list[dict[str, Any]], query: str, limit: int) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for row in rows:
        text = " ".join(str(value) for value in row.values())
        if query and query not in text.lower():
            continue
        result.append(
            {
                "kind": "decision",
                "id": str(row.get("id") or ""),
                "title": str(row.get("title") or row.get("decision") or "Решение"),
                "snippet": _short(row.get("text") or row.get("why") or text),
                "meta": str(row.get("at") or row.get("created_at") or ""),
                "link": "",
                "updated_at": str(row.get("at") or row.get("created_at") or ""),
            }
        )
    return result[:limit]


def search_memory(hub: Path, query: str = "", limit: int = 50) -> dict[str, Any]:
    normalized = query.strip().lower()
    per_group = max(3, min(20, limit // 4 or 8))
    tasks = list_tasks(hub)
    assets = list_assets(hub)
    chats = list_chats(hub)
    events = _read_jsonl(hub / "ledger" / "events.jsonl")
    decisions = _read_jsonl(hub / "decisions" / "decisions.jsonl")

    groups = {
        "tasks": _task_results(tasks, normalized, per_group),
        "assets": _asset_results(assets, normalized, per_group),
        "chats": _chat_results(chats, normalized, max(3, per_group // 2)),
        "events": _event_results(events, normalized, per_group),
        "decisions": _decision_results(decisions, normalized, per_group),
    }
    total = sum(len(items) for items in groups.values())
    return {
        "query": query,
        "total": total,
        "groups": groups,
        "counts": {
            "tasks": len(tasks),
            "assets": len(assets),
            "chats": len(chats),
            "events": len(events),
            "decisions": len(decisions),
        },
    }
