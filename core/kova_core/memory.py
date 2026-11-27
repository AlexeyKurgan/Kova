from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from .chats import list_chats
from .storage.assets import list_assets
from .storage.tasks import list_tasks


STOPWORDS = {
    "где", "что", "как", "этот", "эта", "эти", "это", "для", "или", "при",
    "про", "без", "под", "над", "из", "на", "в", "во", "и", "а", "но",
    "используется", "использовать", "почему", "какие", "какой", "какая",
    "какие", "от", "до", "по", "ли", "же", "бы",
    "the", "and", "for", "with", "from", "this", "that", "what", "where",
}

SYNONYMS = {
    "материал": {"material", "materials", "материалы", "материала"},
    "текстура": {"texture", "textures", "текстуры", "текстуры"},
    "ассет": {"asset", "assets", "ассеты", "ресурс"},
    "задача": {"task", "tasks", "задачи", "задачу"},
    "проверка": {"check", "checks", "validation", "проверки", "тест"},
    "ошибка": {"error", "failed", "failure", "ошибки", "баг"},
    "пивот": {"pivot", "origin", "пивот"},
    "анимация": {"animation", "animations", "анимации"},
    "звук": {"audio", "sound", "звуки", "аудио"},
    "сцена": {"scene", "level", "сцены", "уровень"},
    "персонаж": {"character", "rig", "персонажи"},
    "меч": {"sword", "blade", "мечи"},
    "снапшот": {"snapshot", "snapshots", "снапшоты", "откат"},
    "решение": {"decision", "decisions", "решения"},
}


def _terms(query: str) -> list[str]:
    words = re.findall(r"[a-zа-яё0-9]{2,}", query.lower())
    return [word for word in dict.fromkeys(words) if word not in STOPWORDS]


def _match(haystack: str, query: str) -> tuple[bool, int]:
    if not query:
        return True, 0
    if query in haystack:
        return True, 100
    terms = _terms(query)
    if not terms:
        return True, 0
    score = 0
    for term in terms:
        variants = {term, *SYNONYMS.get(term, set())}
        if any(variant in haystack for variant in variants):
            score += 8
        else:
            return False, 0
    return True, score


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
        matched, score = _match(haystack, query)
        if not matched:
            continue
        snippet = task.goal or task.next_step or "; ".join(item.text for item in task.criteria)
        rows.append(
            {
                "score": score,
                "kind": "task",
                "id": task.id,
                "title": task.title,
                "snippet": _short(snippet),
                "meta": f"{task.status.value} · {task.type.value} · {task.updated_at.isoformat(timespec='minutes')}",
                "link": task.id,
                "updated_at": task.updated_at.isoformat(),
            }
        )
    rows.sort(key=lambda row: (row.get("score", 0), row["updated_at"]), reverse=True)
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
        matched, score = _match(haystack, query)
        if not matched:
            continue
        rows.append(
            {
                "score": score,
                "kind": "asset",
                "id": asset.id,
                "title": asset.name,
                "snippet": _short(asset.description or asset.path),
                "meta": f"{asset.type.value} · {asset.engine.value} · {asset.updated_at.isoformat(timespec='minutes')}",
                "link": asset.id,
                "updated_at": asset.updated_at.isoformat(),
            }
        )
    rows.sort(key=lambda row: (row.get("score", 0), row["updated_at"]), reverse=True)
    return rows[:limit]


def _chat_results(chats: list[dict[str, Any]], query: str, limit: int) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for chat in chats:
        haystack = f"{chat.get('title') or ''} {chat.get('last_message') or ''}".lower()
        matched, score = _match(haystack, query)
        if not matched:
            continue
        rows.append(
            {
                "score": score,
                "kind": "chat",
                "id": str(chat.get("id") or ""),
                "title": str(chat.get("title") or "Чат"),
                "snippet": _short(chat.get("last_message") or ""),
                "meta": f"{chat.get('message_count') or 0} сообщений · {chat.get('updated_at') or ''}",
                "link": "",
                "updated_at": str(chat.get("updated_at") or ""),
            }
        )
    rows.sort(key=lambda row: (row.get("score", 0), row["updated_at"]), reverse=True)
    return rows[:limit]


def _event_results(rows: list[dict[str, Any]], query: str, limit: int) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for event in rows:
        payload = event.get("data") if isinstance(event.get("data"), dict) else {}
        haystack = " ".join(
            [str(event.get("type") or ""), str(event.get("actor") or ""), str(event.get("subject") or "")]
            + [str(value) for value in payload.values()]
        ).lower()
        matched, score = _match(haystack, query)
        if not matched:
            continue
        title = str(payload.get("title") or payload.get("name") or event.get("type") or "Событие")
        subject = str(event.get("subject") or "")
        link = subject if subject.startswith(("task_", "asst_")) else ""
        result.append(
            {
                "score": score,
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
        matched, score = _match(text.lower(), query)
        if not matched:
            continue
        result.append(
            {
                "score": score,
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


MONTHS_SHORT = [
    "янв", "фев", "мар", "апр", "май", "июн",
    "июл", "авг", "сен", "окт", "ноя", "дек",
]


def _parse_dt(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        current = value
    else:
        text = str(value or "").strip()
        if not text:
            return None
        try:
            current = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            return None
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    return current.astimezone()


def _month_start(value: datetime, months_back: int = 0) -> datetime:
    month_index = value.year * 12 + (value.month - 1) - months_back
    return value.replace(
        year=month_index // 12,
        month=month_index % 12 + 1,
        day=1,
        hour=0,
        minute=0,
        second=0,
        microsecond=0,
    )


def memory_timeline(
    hub: Path,
    granularity: str = "day",
    tasks: list[Any] | None = None,
    assets: list[Any] | None = None,
    chats: list[dict[str, Any]] | None = None,
    events: list[dict[str, Any]] | None = None,
    decisions: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    granularity = granularity if granularity in {"hour", "day", "month", "year"} else "day"
    tasks = tasks if tasks is not None else list_tasks(hub)
    assets = assets if assets is not None else list_assets(hub)
    chats = chats if chats is not None else list_chats(hub)
    events = events if events is not None else _read_jsonl(hub / "ledger" / "events.jsonl")
    decisions = decisions if decisions is not None else _read_jsonl(hub / "decisions" / "decisions.jsonl")

    items: list[tuple[datetime, str]] = []
    for task in tasks:
        parsed = _parse_dt(task.updated_at)
        if parsed:
            items.append((parsed, "task"))
    for asset in assets:
        parsed = _parse_dt(asset.updated_at)
        if parsed:
            items.append((parsed, "asset"))
    for chat in chats:
        parsed = _parse_dt(chat.get("updated_at"))
        if parsed:
            items.append((parsed, "chat"))
    for event in events:
        parsed = _parse_dt(event.get("at"))
        if parsed:
            items.append((parsed, "event"))
    for decision in decisions:
        parsed = _parse_dt(decision.get("at") or decision.get("created_at"))
        if parsed:
            items.append((parsed, "decision"))

    now = datetime.now().astimezone()
    starts: list[datetime] = []
    labels: list[str] = []
    if granularity == "hour":
        base = now.replace(minute=0, second=0, microsecond=0)
        starts = [base - timedelta(hours=23 - index) for index in range(24)]
        labels = [value.strftime("%H:00") for value in starts]
    elif granularity == "month":
        starts = [_month_start(now, 11 - index) for index in range(12)]
        labels = [f"{MONTHS_SHORT[value.month - 1]} {str(value.year)[2:]}" for value in starts]
    elif granularity == "year":
        base = now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
        starts = [base.replace(year=base.year - (4 - index)) for index in range(5)]
        labels = [str(value.year) for value in starts]
    else:
        base = now.replace(hour=0, minute=0, second=0, microsecond=0)
        starts = [base - timedelta(days=13 - index) for index in range(14)]
        labels = [f"{value.day} {MONTHS_SHORT[value.month - 1]}" for value in starts]

    buckets = [
        {
            "label": label,
            "total": 0,
            "task": 0,
            "asset": 0,
            "chat": 0,
            "event": 0,
            "decision": 0,
        }
        for label in labels
    ]
    start = starts[0]
    for stamp, kind in items:
        if stamp < start:
            continue
        if granularity == "hour":
            index = int((stamp - start).total_seconds() // 3600)
        elif granularity == "month":
            index = (stamp.year - start.year) * 12 + stamp.month - start.month
        elif granularity == "year":
            index = stamp.year - start.year
        else:
            index = (stamp.date() - start.date()).days
        if 0 <= index < len(buckets):
            buckets[index]["total"] += 1
            buckets[index][kind] += 1

    return {
        "granularity": granularity,
        "buckets": buckets,
        "total": sum(bucket["total"] for bucket in buckets),
        "max": max((bucket["total"] for bucket in buckets), default=0),
    }


def search_memory(
    hub: Path,
    query: str = "",
    limit: int = 50,
    granularity: str = "day",
) -> dict[str, Any]:
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
        "timeline": memory_timeline(
            hub, granularity, tasks=tasks, assets=assets, chats=chats, events=events, decisions=decisions
        ),
        "counts": {
            "tasks": len(tasks),
            "assets": len(assets),
            "chats": len(chats),
            "events": len(events),
            "decisions": len(decisions),
        },
    }
