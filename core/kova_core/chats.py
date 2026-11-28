import base64
import json
import queue
import re
import shutil
import subprocess
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .agents.providers import build_command, get_provider, provider_env
from .agents.cli_output import parse_output, stream_display
from .agents.model_catalog import apply_effort
from .agents.activity import extract_activity
from .agents.chat_safety import harden_chat_args, prepare_chat_env
from .agents.app_guide import KOVA_APP_GUIDE
from .agents.api_provider import run_chat as run_api_chat
from .domain.ids import new_id
from .security.secrets import get_secret
from .security.egress import EgressGuard, apply_guard_env, egress_hosts
from .security.job import ProcessJail, kill_process_group, spawn_kwargs
from .storage.projects import load_project

LOCK = threading.Lock()
PROCESSES: dict[str, subprocess.Popen[str]] = {}
MAX_CONTEXT_TASKS = 40
MAX_HISTORY = 14
MAX_PROMPT_CHARS = 24_000
MAX_ACTIONS = 3
MAX_ATTACHMENTS = 4
MAX_ATTACHMENT_BYTES = 12_000_000
MAX_ATTACHMENT_TEXT = 20_000
SUBSCRIBERS: dict[str, set[queue.Queue[str]]] = {}
GLOBAL_SUBSCRIBERS: set[queue.Queue[str]] = set()


def _now() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def chats_dir(hub: Path) -> Path:
    return hub / "chats"


def _file(hub: Path, chat_id: str) -> Path:
    return chats_dir(hub) / f"{chat_id}.json"


def _save(hub: Path, chat: dict[str, Any]) -> dict[str, Any]:
    path = _file(hub, str(chat["id"]))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(chat, ensure_ascii=False, indent=2) + chr(10),
        encoding="utf-8",
    )
    _publish(str(chat["id"]))
    return chat


def _publish(chat_id: str) -> None:
    for subscriber in list(SUBSCRIBERS.get(chat_id, set())):
        try:
            subscriber.put_nowait(chat_id)
        except queue.Full:
            pass
    for subscriber in list(GLOBAL_SUBSCRIBERS):
        try:
            subscriber.put_nowait(chat_id)
        except queue.Full:
            pass


def subscribe(chat_id: str) -> queue.Queue[str]:
    subscriber: queue.Queue[str] = queue.Queue(maxsize=100)
    SUBSCRIBERS.setdefault(chat_id, set()).add(subscriber)
    return subscriber


def unsubscribe(chat_id: str, subscriber: queue.Queue[str]) -> None:
    subscribers = SUBSCRIBERS.get(chat_id)
    if subscribers is not None:
        subscribers.discard(subscriber)
        if not subscribers:
            SUBSCRIBERS.pop(chat_id, None)


def subscribe_all() -> queue.Queue[str]:
    subscriber: queue.Queue[str] = queue.Queue(maxsize=100)
    GLOBAL_SUBSCRIBERS.add(subscriber)
    return subscriber


def unsubscribe_all(subscriber: queue.Queue[str]) -> None:
    GLOBAL_SUBSCRIBERS.discard(subscriber)


def attachments_dir(hub: Path, chat_id: str) -> Path:
    return chats_dir(hub) / "attachments" / chat_id


def _attachment_kind(mime: str, name: str = "") -> str:
    value = (mime or "").lower()
    suffix = Path(name).suffix.lower()
    if value.startswith("image/") or suffix in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"}:
        return "image"
    if value.startswith("video/") or suffix in {".mp4", ".webm", ".mov", ".mkv", ".avi"}:
        return "video"
    if value.startswith("text/") or value in {"application/json", "application/xml"}:
        return "text"
    if suffix in {".txt", ".md", ".json", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".csv", ".cs", ".lua", ".py", ".ts", ".tsx", ".js", ".jsx", ".html", ".css", ".glsl", ".hlsl", ".shader", ".xml"}:
        return "text"
    return "file"


def save_attachments(
    hub: Path,
    chat_id: str,
    items: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    directory = attachments_dir(hub, chat_id)
    for item in items[:MAX_ATTACHMENTS]:
        name = str(item.get("name") or "file").strip()[:160] or "file"
        mime = str(item.get("mime") or "").strip()[:120]
        raw = str(item.get("data") or "")
        if "," in raw and raw.lstrip().startswith("data:"):
            raw = raw.split(",", 1)[1]
        try:
            payload = base64.b64decode(raw, validate=False)
        except (ValueError, TypeError):
            continue
        if not payload or len(payload) > MAX_ATTACHMENT_BYTES:
            continue
        attachment_id = new_id("att")
        suffix = Path(name).suffix.lower()
        if len(suffix) > 12 or any(ch in suffix for ch in "/\\"):
            suffix = ""
        directory.mkdir(parents=True, exist_ok=True)
        target = directory / f"{attachment_id}{suffix}"
        try:
            target.write_bytes(payload)
        except OSError:
            continue
        kind = _attachment_kind(mime, name)
        text = ""
        if kind == "text":
            try:
                text = payload.decode("utf-8", errors="replace")[:MAX_ATTACHMENT_TEXT]
            except (ValueError, UnicodeError):
                text = ""
        rows.append(
            {
                "id": attachment_id,
                "name": name,
                "mime": mime,
                "kind": kind,
                "size": len(payload),
                "path": target.relative_to(hub).as_posix(),
                "text": text,
            }
        )
    return rows


def find_attachment(
    hub: Path,
    chat_id: str,
    attachment_id: str,
) -> tuple[dict[str, Any], Path] | None:
    chat = get_chat(hub, chat_id)
    if chat is None:
        return None
    for message in chat.get("messages") or []:
        for attachment in message.get("attachments") or []:
            if attachment.get("id") == attachment_id:
                path = Path(str(attachment.get("path") or ""))
                if not path.is_absolute():
                    path = hub / path
                if path.is_file() and hub.resolve() in path.resolve().parents:
                    return attachment, path
                return None
    return None


def _message_media(hub: Path, chat: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    messages = chat.get("messages") or []
    if not messages:
        return rows
    latest = messages[-1]
    for attachment in latest.get("attachments") or []:
        path = Path(str(attachment.get("path") or ""))
        if not path.is_absolute():
            path = hub / path
        if not path.is_file() or attachment.get("kind") not in {"image", "video"}:
            continue
        try:
            data = base64.b64encode(path.read_bytes()).decode("ascii")
        except OSError:
            continue
        rows.append(
            {
                "kind": attachment.get("kind"),
                "mime": attachment.get("mime") or "",
                "data": data,
            }
        )
    return rows


def list_chats(hub: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    directory = chats_dir(hub)
    if not directory.is_dir():
        return rows
    for path in directory.glob("chat_*.json"):
        try:
            chat = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if not isinstance(chat, dict):
            continue
        chat = _clean_chat(chat)
        messages = chat.get("messages") or []
        rows.append(
            {
                "id": chat.get("id"),
                "title": chat.get("title") or "Новый чат",
                "scope": chat.get("scope") or "project",
                "task_id": chat.get("task_id") or "",
                "provider_id": chat.get("provider_id") or "",
                "model": chat.get("model") or "",
                "status": chat.get("status") or "idle",
                "updated_at": chat.get("updated_at") or "",
                "message_count": len(messages),
                "last_message": str(messages[-1].get("content") or "")[:160] if messages else "",
            }
        )
    rows.sort(key=lambda row: str(row.get("updated_at") or ""), reverse=True)
    return rows


def get_chat(hub: Path, chat_id: str) -> dict[str, Any] | None:
    try:
        payload = json.loads(_file(hub, chat_id).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return _clean_chat(payload) if isinstance(payload, dict) else None


def _clean_chat(chat: dict[str, Any]) -> dict[str, Any]:
    for message in chat.get("messages") or []:
        if message.get("role") != "assistant":
            continue
        content = str(message.get("content") or "")
        stripped = content.lstrip()
        if not stripped.startswith("{") or '"type"' not in stripped:
            continue
        try:
            display = parse_output(
                content,
                {"output_mode": "jsonl-auto"},
            ).get("display") or ""
        except Exception:
            display = ""
        if display.strip() and display.strip() != content.strip():
            message["content"] = display.strip()
    return chat


def create_chat(
    hub: Path,
    title: str = "",
    scope: str = "project",
    task_id: str = "",
    provider_id: str = "",
    model: str = "",
    effort: str = "auto",
    task_ids: list[str] | None = None,
) -> dict[str, Any]:
    chat = {
        "id": new_id("chat"),
        "title": title.strip() or "Новый чат",
        "scope": "task" if scope == "task" and task_id else "project",
        "task_id": task_id if scope == "task" else "",
        "task_ids": list(task_ids or ([task_id] if scope == "task" and task_id else [])),
        "provider_id": provider_id,
        "model": model,
        "effort": effort if effort in {"auto", "low", "medium", "high"} else "auto",
        "external_paths": [],
        "status": "idle",
        "streaming_output": "",
        "activity": [],
        "run_started_at": "",
        "error": "",
        "messages": [],
        "created_at": _now(),
        "updated_at": _now(),
    }
    with LOCK:
        _save(hub, chat)
    return chat


def update_chat(hub: Path, chat_id: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    with LOCK:
        chat = get_chat(hub, chat_id)
        if chat is None:
            return None
        for key in ("title", "provider_id", "model", "scope", "task_id", "effort", "task_ids"):
            if key in payload:
                chat[key] = payload[key]
        if "external_paths" in payload:
            paths: list[str] = []
            for raw in (payload.get("external_paths") or [])[:8]:
                text = str(raw).strip().strip('"')
                if not text:
                    continue
                candidate = Path(text).expanduser()
                if not candidate.is_absolute():
                    continue
                try:
                    resolved = candidate.resolve()
                except (OSError, ValueError):
                    continue
                if resolved.is_dir() and str(resolved) not in paths:
                    paths.append(str(resolved))
            chat["external_paths"] = paths
        if "task_ids" in payload and isinstance(chat.get("task_ids"), list):
            chat["task_ids"] = [str(item) for item in chat["task_ids"] if str(item).strip()]
        elif "task_id" in payload:
            task_id = str(chat.get("task_id") or "")
            chat["task_ids"] = [task_id] if task_id else []
        if chat.get("scope") != "task":
            chat["task_id"] = ""
            chat["task_ids"] = []
        chat["updated_at"] = _now()
        _save(hub, chat)
        return chat


def delete_chat(hub: Path, chat_id: str) -> bool:
    with LOCK:
        chat = get_chat(hub, chat_id)
        if chat is None:
            return False
        _file(hub, chat_id).unlink(missing_ok=True)
        shutil.rmtree(attachments_dir(hub, chat_id), ignore_errors=True)
        _publish(chat_id)
        return True


def _append(chat: dict[str, Any], role: str, content: str, **extra: Any) -> dict[str, Any]:
    message = {
        "id": new_id("msg"),
        "role": role,
        "content": content,
        "created_at": _now(),
        **extra,
    }
    chat.setdefault("messages", []).append(message)
    chat["updated_at"] = _now()
    return message


def _task_context(hub: Path, chat: dict[str, Any]) -> str:
    from .storage.assets import list_assets
    from .storage.projects import load_project
    from .storage.tasks import get_task, list_tasks

    project = load_project(hub)
    rows = list_tasks(hub)
    lines = [
        f"Проект: {project.name}",
        f"Движок: {project.engine.value}",
        "",
        "Задачи:",
    ]
    upcoming: list[str] = []
    for task in rows[:MAX_CONTEXT_TASKS]:
        done = sum(1 for item in task.criteria if item.done)
        line = (
            f"- {task.title} [{task.status.value}] · {task.type.value} · "
            f"критерии {done}/{len(task.criteria)} · {task.goal[:180]}"
        )
        if task.next_step:
            line += f" · следующий шаг: {task.next_step[:140]}"
            upcoming.append(f"{task.title}: {task.next_step[:140]}")
        lines.append(line)
    if not rows:
        lines.append("- задач пока нет")
    if upcoming:
        lines += ["", "Ближайшие шаги:"]
        lines += [f"- {item}" for item in upcoming[:8]]
    assets = list_assets(hub)
    lines.append("")
    lines.append(f"Ассеты: {len(assets)}")
    for asset in assets[:12]:
        lines.append(f"- {asset.name} · {asset.type.value} · {asset.engine.value}")
    if chat.get("scope") == "task":
        selected_ids = [
            str(item)
            for item in (chat.get("task_ids") or [])
            if str(item).strip()
        ]
        if not selected_ids and chat.get("task_id"):
            selected_ids = [str(chat["task_id"])]
        for task_id in selected_ids[:8]:
            task = get_task(hub, task_id)
            if task is None:
                continue
            lines += [
                "",
                f"Выбранная задача: {task.title}",
                f"Тип: {task.type.value} · движок: {task.engine.value}",
                f"Цель: {task.goal}",
                f"Статус: {task.status.value}",
                "Критерии:",
            ]
            for criterion in task.criteria:
                lines.append(f"- [{'x' if criterion.done else ' '}] {criterion.text}")
            if task.constraints:
                lines.append("Ограничения:")
                lines += [f"- {item}" for item in task.constraints]
            if task.skills:
                lines.append(f"Скиллы: {', '.join(task.skills)}")
            if task.next_step:
                lines.append(f"Следующий шаг: {task.next_step}")
    return "\n".join(lines)


def _history(chat: dict[str, Any], budget: int) -> str:
    blocks: list[str] = []
    used = 0
    tail = (chat.get("messages") or [])[-MAX_HISTORY:]
    for index, message in enumerate(reversed(tail)):
        role = "Пользователь" if message.get("role") == "user" else "Ассистент"
        content = str(message.get("raw_content") or message.get("content") or "")
        for attachment in message.get("attachments") or []:
            content += (
                chr(10)
                + f"[Вложение: {attachment.get('name')} "
                + f"({attachment.get('mime')}) · {attachment.get('path')}]"
            )
            text = str(attachment.get("text") or "")
            if text:
                content += chr(10) + text[:8_000]
        content = content[:12_000] if index == 0 else content[:2_000]
        block = f"{role}: {content}"
        if used + len(block) + 2 > budget:
            if index == 0:
                room = budget - used - len(role) - 2
                if room > 0:
                    blocks.append(f"{role}: {content[:room]}")
            break
        blocks.append(block)
        used += len(block) + 2
    return (chr(10) * 2).join(reversed(blocks))


def _actions_hint() -> str:
    fence = chr(96) * 3
    nl = chr(10)
    return (
        " Если пользователь просит создать или обновить задачу, либо запустить агента, "
        "предложи действие отдельным блоком в конце ответа:" + nl + nl
        + fence + "kova-action" + nl
        + '{"action":"create_task","title":"...","goal":"...","criteria":["..."]}' + nl
        + fence + nl + nl
        + "Доступные действия: create_task (title, goal, criteria, type), "
        + "update_task (task_id, status, next_step, goal), "
        + "start_agent_run (task_id, provider_id, message, model), "
        + "update_project_settings (isolation: direct|worktree|sandbox, "
        + "max_parallel_runs: 1-4, token_budget: 0+, local_only: true|false, "
        + "egress_guard: true|false)." + nl
        + "Если пользователь просит настроить проект или изменить настройки, предложи "
        + "update_project_settings отдельным блоком. Не утверждай, что настройка уже изменена: "
        + "Kova применит её только после подтверждения пользователя."
    )


def _parse_actions(text: str) -> tuple[str, list[dict[str, Any]]]:
    actions: list[dict[str, Any]] = []
    pattern = re.compile(r"```kova-action\s*(\{.*?\})\s*```", re.DOTALL)
    for match in pattern.finditer(text):
        if len(actions) >= MAX_ACTIONS:
            break
        try:
            payload = json.loads(match.group(1))
        except ValueError:
            continue
        if not isinstance(payload, dict):
            continue
        kind = str(payload.get("action") or "").strip()
        if kind not in {"create_task", "update_task", "start_agent_run", "update_project_settings"}:
            continue
        if kind == "create_task":
            title = str(payload.get("title") or "").strip()[:200]
            if not title:
                continue
            data: dict[str, Any] = {
                "title": title,
                "goal": str(payload.get("goal") or "").strip()[:4000],
                "criteria": [
                    str(item).strip()[:300]
                    for item in (payload.get("criteria") or [])
                    if str(item).strip()
                ][:20],
                "type": str(payload.get("type") or "code").strip(),
            }
        elif kind == "update_task":
            task_id = str(payload.get("task_id") or "").strip()
            if not task_id:
                continue
            data = {"task_id": task_id}
            for key in ("title", "goal", "next_step", "status"):
                value = payload.get(key)
                if isinstance(value, str) and value.strip():
                    data[key] = value.strip()[:4000]
        elif kind == "update_project_settings":
            data = {}
            isolation = str(payload.get("isolation") or "").strip()
            if isolation in {"direct", "worktree", "sandbox"}:
                data["isolation"] = isolation
            for key, low, high in (
                ("max_parallel_runs", 1, 4),
                ("token_budget", 0, 100_000_000),
            ):
                if payload.get(key) is not None:
                    try:
                        data[key] = max(low, min(high, int(payload[key])))
                    except (TypeError, ValueError):
                        pass
            for key in ("local_only", "egress_guard"):
                if isinstance(payload.get(key), bool):
                    data[key] = bool(payload[key])
            if not data:
                continue
        else:
            task_id = str(payload.get("task_id") or "").strip()
            if not task_id:
                continue
            data = {
                "task_id": task_id,
                "provider_id": str(payload.get("provider_id") or "").strip(),
                "message": str(payload.get("message") or "").strip()[:8000],
                "model": str(payload.get("model") or "").strip(),
            }
        actions.append(
            {
                "id": new_id("act"),
                "type": kind,
                "payload": data,
                "status": "pending",
                "result": {},
                "error": "",
            }
        )
    clean = pattern.sub("", text).strip()
    return clean, actions


def _effort_hint(chat: dict[str, Any]) -> str:
    effort = str(chat.get("effort") or "auto")
    if effort in {"none", "minimal", "low"}:
        return "Отвечай максимально кратко и по делу, без длинных вступлений. "
    if effort == "medium":
        return "Давай сбалансированный ответ: вывод, краткое объяснение и следующий шаг. "
    if effort == "high":
        return (
            "Анализируй глубоко: проверяй допущения, рассматривай альтернативы, "
            "явно указывай риски и неуверенность. "
        )
    if effort in {"xhigh", "max"}:
        return (
            "Работай с максимальной глубиной: проверяй допущения, рассматривай альтернативы, "
            "явно указывай риски, ограничения и неуверенность. "
        )
    return ""


def _external_paths_hint(chat: dict[str, Any]) -> str:
    paths = [
        str(item).strip()
        for item in (chat.get("external_paths") or [])
        if str(item).strip()
    ][:8]
    if not paths:
        return (
            "Можно читать только папку проекта. Не читай другие проекты, AppData, "
            "домашнюю папку и системные каталоги. "
        )
    return (
        "Пользователь явно разрешил чтение этих внешних папок (только чтение): "
        + "; ".join(paths)
        + ". Другие внешние пути читать нельзя. "
    )


def _settings_context(hub: Path, chat: dict[str, Any]) -> str:
    project = load_project(hub)
    providers, default_provider = get_providers_with_default()
    lines = [
        "## Текущие настройки Kova",
        f"Изоляция запусков: {project.isolation.value}",
        f"Параллельных запусков: {project.max_parallel_runs}",
        f"Локальный режим: {'включён' if project.local_only else 'выключен'}",
        f"Сетевой щит: {'включён' if project.egress_guard else 'выключен'}",
        f"Лимит токенов: {project.token_budget} (0 = без лимита)",
        f"Провайдер по умолчанию: {default_provider or 'не выбран'}",
        "Провайдеры: "
        + (
            ", ".join(
                f"{item.get('name')}{' (основной)' if item.get('default') else ''}"
                for item in providers
                if item.get("installed") and item.get("enabled")
            )
            or "нет доступных"
        ),
        f"Провайдер этого чата: {chat.get('provider_id') or 'не выбран'}; "
        f"модель: {chat.get('model') or 'не выбрана'}",
        f"Внешние папки чата: {', '.join(chat.get('external_paths') or []) or 'нет'}",
    ]
    try:
        from .checks.doctor import run_doctor

        warnings = [
            f"{item.name}: {item.message}"
            for item in run_doctor(hub)
            if item.status.value == "warning"
        ]
    except (OSError, ValueError):
        warnings = []
    if warnings:
        lines.append("Предупреждения Doctor: " + "; ".join(warnings[:8]))
    return chr(10).join(lines)


def get_providers_with_default() -> tuple[list[dict[str, Any]], str]:
    try:
        from .agents.providers import list_providers

        rows, default = list_providers()
        return rows, default
    except (OSError, ValueError):
        return [], ""


def _prompt(hub: Path, chat: dict[str, Any]) -> tuple[str, str]:
    system = (
        "Ты — Kova, локальный ассистент проекта. Отвечай по делу, опираясь на контекст ниже. "
        "Оформляй ответы структурно: короткие заголовки, списки и таблицы для сравнений; "
        "важное выделяй **жирным**, предупреждения — цитатой вида `> **Важно:** ...`. "
        "Не перегружай ответ форматированием. "
        "Если данных не хватает — скажи, чего не хватает, и предложи следующий шаг. "
        "Не утверждай, что изменил файлы или создал задачу, если это не сделано. "
        "Используй только факты из контекста. Не выдумывай задачи, ассеты, запуски и цифры; "
        "если данных нет — так и скажи. "
        "Создание задач, запуск агентов и изменения файлов выполняются только через Kova с подтверждением. "
        "В чате у тебя только чтение. Не меняй файлы, не запускай команды и не ходи в интернет. "
        + _external_paths_hint(chat)
        + "Если для ответа нужен другой внешний путь или действие — скажи об этом и предложи отдельную задачу."
        + _actions_hint()
    )
    system += (
        chr(10) * 2
        + "## Справка по Kova"
        + chr(10)
        + "Если вопрос о самом приложении, его меню, настройках, запуске или безопасности — "
        + "отвечай по этой справке, а не по внутренней структуре .hub."
        + chr(10)
        + KOVA_APP_GUIDE
    )
    context = _task_context(hub, chat) + chr(10) * 2 + _settings_context(hub, chat)
    budget = max(4_000, MAX_PROMPT_CHARS - len(context) - len(system) - 400)
    history = _history(chat, budget)
    nl = chr(10)
    request_text = ""
    for message in reversed(chat.get("messages") or []):
        if message.get("role") == "user":
            request_text = str(message.get("content") or "")
            break
    prompt = (
        "## Контекст проекта" + nl + context + nl + nl
        + "## История чата" + nl + (history or "пусто") + nl + nl
        + "## Текущий запрос" + nl + (request_text or "пусто") + nl
    )
    return system, prompt


def _egress_network(activity: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    rows: dict[str, dict[str, Any]] = {}
    for item in activity or []:
        if str(item.get("tool") or "") != "network":
            continue
        host = str(item.get("host") or item.get("detail") or "").split(":")[0]
        if not host:
            continue
        row = rows.setdefault(
            host,
            {"host": host, "count": 0, "allowed": item.get("status") != "error"},
        )
        row["count"] += 1
        if item.get("status") == "error":
            row["allowed"] = False
    return sorted(rows.values(), key=lambda item: item["host"])


def _build_egress(
    chat: dict[str, Any],
    provider: dict[str, Any] | None,
    activity: list[dict[str, Any]] | None,
) -> dict[str, Any]:
    files: dict[str, int] = {}
    for item in activity or []:
        tool = str(item.get("tool") or "").lower()
        detail = str(item.get("detail") or "").strip()
        if tool not in {"read", "read_file"} or not detail:
            continue
        size = len(str(item.get("output") or "").encode("utf-8"))
        files[detail] = max(files.get(detail, 0), size)
    attachments: list[dict[str, Any]] = []
    request_bytes = 0
    for message in reversed(chat.get("messages") or []):
        if message.get("role") != "user":
            continue
        request_bytes = len(str(message.get("content") or "").encode("utf-8"))
        attachments = list(message.get("attachments") or [])
        break
    data = {
        "provider_id": str((provider or {}).get("id") or ""),
        "provider_name": str((provider or {}).get("name") or "AI"),
        "remote": _provider_is_remote(provider) if provider else True,
        "files": [
            {"path": path, "bytes": size}
            for path, size in list(files.items())[:40]
        ],
        "file_bytes": sum(files.values()),
        "attachments": len(attachments),
        "attachment_bytes": sum(int(item.get("size") or 0) for item in attachments),
        "request_bytes": request_bytes,
        "network": _egress_network(activity),
    }
    return data


def _finish(
    hub: Path,
    chat_id: str,
    output: str,
    error: str = "",
    activity: list[dict[str, Any]] | None = None,
) -> None:
    with LOCK:
        chat = get_chat(hub, chat_id)
        if chat is None:
            return
        provider = get_provider(str(chat.get("provider_id") or ""))
        egress = _build_egress(chat, provider, activity)
        if output.strip():
            clean, actions = _parse_actions(output.strip())
            _append(
                chat,
                "assistant",
                clean or "Подготовил действие — подтверди его в сообщении.",
                raw_content=output.strip(),
                actions=actions,
                activity=activity or [],
                egress=egress,
            )
        elif error:
            _append(
                chat,
                "assistant",
                f"Ошибка: {error}",
                activity=activity or [],
                egress=egress,
            )
        else:
            _append(
                chat,
                "assistant",
                "CLI завершился без текстового ответа.",
                activity=activity or [],
                egress=egress,
            )
        chat["status"] = "failed" if error else "idle"
        chat["error"] = error
        chat["streaming_output"] = ""
        chat["activity"] = []
        chat["run_started_at"] = ""
        chat["updated_at"] = _now()
        _save(hub, chat)


def _network_activity(guard: EgressGuard) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for index, event in enumerate(guard.summary()):
        host = str(event.get("host") or "")
        port = int(event.get("port") or 443)
        allowed = bool(event.get("allowed"))
        rows.append(
            {
                "id": f"net-{index}",
                "kind": "network",
                "label": "Сеть: " + host,
                "detail": f"{host}:{port}",
                "host": host,
                "status": "done" if allowed else "error",
                "duration_ms": 0,
                "output": "" if allowed else "заблокировано egress allowlist",
                "tool": "network",
                **({"flags": ["network"]} if not allowed else {}),
            }
        )
    return rows


def _run_cli(
    hub: Path,
    chat_id: str,
    provider: dict[str, Any],
    prompt: str,
    model: str,
    effort: str = "auto",
) -> None:
    timeout = int(provider.get("timeout") or 1800)
    chunks: list[str] = []
    guard: EgressGuard | None = None
    jail = ProcessJail()
    try:
        use_stdin = bool(provider.get("prompt_via_stdin"))
        chat_args = list(provider.get("chat_args") or [])
        if not chat_args:
            chat_args = list(provider.get("read_only_args") or [])
        if not chat_args:
            raise RuntimeError(
                "для этого CLI не настроен безопасный режим чата: задай аргументы "
                "«только чтение» в настройках провайдера"
            )
        chat_state = get_chat(hub, chat_id) or {}
        external_paths = [
            str(item)
            for item in chat_state.get("external_paths") or []
            if str(item).strip()
        ]
        chat_args = harden_chat_args(provider, chat_args, external_paths)
        try:
            project = load_project(hub)
        except (OSError, ValueError):
            project = None
        if project is not None and project.egress_guard:
            hosts = egress_hosts(provider)
            if hosts:
                guard = EgressGuard(hosts)
        if effort and effort != "auto":
            if provider.get("id") == "claude" and effort in {
                "low",
                "medium",
                "high",
                "xhigh",
                "max",
            }:
                chat_args += ["--effort", effort]
            elif provider.get("id") == "codex" and effort in {
                "low",
                "medium",
                "high",
                "xhigh",
            }:
                chat_args += ["-c", f'model_reasoning_effort="{effort}"']
        chat_provider = {**provider, "args": chat_args}
        model_for_cli = apply_effort(provider, model, effort)
        argv = build_command(
            chat_provider,
            prompt,
            model_for_cli,
            prompt_via_stdin=use_stdin,
        )
        process = subprocess.Popen(
            argv,
            cwd=str(hub.parent),
            stdin=subprocess.PIPE if use_stdin else subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=apply_guard_env(
                prepare_chat_env(
                    provider,
                    provider_env(),
                    str(hub.parent),
                    external_paths,
                ),
                guard,
            ) if guard else prepare_chat_env(
                provider,
                provider_env(),
                str(hub.parent),
                external_paths,
            ),
            **spawn_kwargs(),
        )
        if use_stdin and process.stdin is not None:
            process.stdin.write(prompt)
            process.stdin.close()
        if jail.available:
            jail.assign(process.pid)
        with LOCK:
            PROCESSES[chat_id] = process

        def drain() -> None:
            stream = process.stdout
            if stream is None:
                return
            for line in stream:
                with LOCK:
                    chunks.append(line)
                    chat = get_chat(hub, chat_id)
                    if chat is not None:
                        raw_output = "".join(chunks)
                        chat["activity"] = extract_activity(
                            raw_output, provider, project_root=str(hub.parent)
                        )
                        chat["streaming_output"] = stream_display(
                            raw_output, provider
                        )[-80_000:]
                        chat["updated_at"] = _now()
                        _save(hub, chat)

        reader = threading.Thread(target=drain, daemon=True)
        reader.start()
        process.wait(timeout=timeout)
        reader.join(timeout=3)
        output = "".join(chunks)
        display = parse_output(output, provider).get("display") or output
        activity = extract_activity(
            output, provider, final=True, project_root=str(hub.parent)
        )
        if guard is not None:
            activity.extend(_network_activity(guard))
            guard.stop()
            guard = None
        error = "" if process.returncode == 0 else f"CLI завершился с кодом {process.returncode}"
        _finish(hub, chat_id, display, error, activity)
    except subprocess.TimeoutExpired:
        _kill(chat_id)
        _finish(hub, chat_id, "".join(chunks), f"превышен лимит {timeout} секунд")
    except (OSError, ValueError) as exc:
        _finish(hub, chat_id, "".join(chunks), str(exc))
    finally:
        if guard is not None:
            guard.stop()
        jail.close()
        with LOCK:
            PROCESSES.pop(chat_id, None)


def _run_api(
    hub: Path,
    chat_id: str,
    provider: dict[str, Any],
    prompt: str,
    model: str,
    system: str,
    media: list[dict[str, Any]] | None = None,
) -> None:
    key = get_secret(str(provider["id"]))
    if not key and not str(provider.get("local_api")):
        _finish(hub, chat_id, "", "API-ключ не сохранён")
        return

    def on_text(text: str) -> None:
        with LOCK:
            chat = get_chat(hub, chat_id)
            if chat is None:
                return
            chat["streaming_output"] = text[-80_000:]
            chat["updated_at"] = _now()
            _save(hub, chat)

    try:
        output, _usage = run_api_chat(
            provider,
            prompt,
            key,
            on_text=on_text,
            system=system,
            media=media or [],
        )
        _finish(hub, chat_id, output)
    except Exception as exc:
        _finish(hub, chat_id, "", str(exc)[:1000])


def send_message(
    hub: Path,
    chat_id: str,
    text: str,
    attachments: list[dict[str, Any]] | None = None,
) -> dict[str, Any] | None:
    with LOCK:
        chat = get_chat(hub, chat_id)
        if chat is None:
            return None
        if chat.get("status") == "running":
            raise RuntimeError("чат уже отвечает")
        provider = get_provider(str(chat.get("provider_id") or ""))
        saved = save_attachments(hub, chat_id, attachments or [])
        content = text.strip()
        if not content and saved:
            content = "Посмотри вложения: " + ", ".join(
                str(item.get("name") or "файл") for item in saved
            )
        if provider is not None:
            project = load_project(hub)
            if project.local_only and _provider_is_remote(provider):
                _append(chat, "user", content, attachments=saved)
                _append(
                    chat,
                    "assistant",
                    "Включён режим «только локальные модели». Этот провайдер отправляет "
                    "данные в интернет, поэтому запрос не отправлен. Переключись на локальный "
                    "API или выключи режим в Агентах.",
                )
                chat["status"] = "idle"
                chat["error"] = "local-only"
                chat["updated_at"] = _now()
                _save(hub, chat)
                return chat
            if _provider_is_remote(provider) and str(provider.get("id") or "") not in project.remote_consents:
                _append(chat, "user", content, attachments=saved)
                _append(
                    chat,
                    "assistant",
                    "Нужно подтвердить отправку данных провайдеру «"
                    + str(provider.get("name") or provider.get("id") or "AI")
                    + "». Это внешний провайдер: текст запроса и файлы, которые "
                    "прочитает агент, будут отправлены ему. Подтверди отправку в интерфейсе чата.",
                )
                chat["status"] = "idle"
                chat["error"] = "consent-required"
                chat["updated_at"] = _now()
                _save(hub, chat)
                return chat
        _append(chat, "user", content, attachments=saved)
        chat["status"] = "running"
        chat["run_started_at"] = _now()
        chat["activity"] = []
        chat["error"] = ""
        chat["streaming_output"] = ""
        if chat.get("title") in {"", "Новый чат"}:
            title_source = content or (saved[0].get("name") if saved else "")
            chat["title"] = str(title_source).strip().splitlines()[0][:80] or "Новый чат"
        _save(hub, chat)
        model = str(chat.get("model") or "")
        system, prompt = _prompt(hub, chat)
        media = _message_media(hub, chat)

    if provider is None:
        _finish(hub, chat_id, "", "AI-провайдер не найден")
        return get_chat(hub, chat_id)
    if not provider.get("installed"):
        _finish(hub, chat_id, "", "CLI или API-провайдер не настроен")
        return get_chat(hub, chat_id)

    if not model:
        model = str(provider.get("default_model") or "")
        if not model and provider.get("models"):
            model = str(provider["models"][0])
        if model:
            with LOCK:
                current = get_chat(hub, chat_id)
                if current is not None and not current.get("model"):
                    current["model"] = model
                    _save(hub, current)
    if not model and (
        provider.get("kind") == "api"
        or any(
            "{model}" in str(arg)
            for arg in (provider.get("chat_args") or provider.get("args") or [])
        )
    ):
        _finish(hub, chat_id, "", "Выбери модель для чата")
        return get_chat(hub, chat_id)

    if provider.get("kind") == "api":
        target = _run_api
        args = (hub, chat_id, provider, prompt, model, system, media)
    else:
        target = _run_cli
        args = (
            hub,
            chat_id,
            provider,
            system + chr(10) * 2 + prompt,
            model,
            str(chat.get("effort") or "auto"),
        )
    thread = threading.Thread(target=target, args=args, daemon=True)
    thread.start()
    return get_chat(hub, chat_id)


def _provider_is_remote(provider: dict[str, Any]) -> bool:
    if str(provider.get("kind") or "cli") == "api":
        return not bool(provider.get("local_api"))
    return True


def _kill(chat_id: str) -> None:
    with LOCK:
        process = PROCESSES.get(chat_id)
    if process is not None:
        kill_process_group(process)


def cancel_chat(hub: Path, chat_id: str) -> dict[str, Any] | None:
    chat = get_chat(hub, chat_id)
    if chat is None:
        return None
    _kill(chat_id)
    _finish(hub, chat_id, "", "ответ остановлен")
    return get_chat(hub, chat_id)


def _execute_action(hub: Path, action: dict[str, Any]) -> dict[str, Any]:
    from .domain.enums import TaskStatus, TaskType
    from .domain.ledger import LedgerEvent
    from .domain.task import Criterion, Task
    from .storage.ledger import append_event
    from .storage.projects import load_project, save_project
    from .storage.tasks import get_task, save_task

    kind = str(action.get("type") or "")
    payload = action.get("payload") or {}

    if kind == "create_task":
        project = load_project(hub)
        task = Task(
            title=str(payload.get("title") or "Задача из чата")[:200],
            type=TaskType(str(payload.get("type") or "code")),
            engine=project.engine,
            goal=str(payload.get("goal") or ""),
            criteria=[
                Criterion(text=str(item))
                for item in (payload.get("criteria") or [])
                if str(item).strip()
            ][:20],
        )
        saved = save_task(hub, task)
        append_event(
            hub,
            LedgerEvent(
                type="task.created",
                subject=saved.id,
                actor="Kova Chat",
                data={"title": saved.title},
            ),
        )
        return {"task_id": saved.id, "title": saved.title, "status": saved.status.value}

    if kind == "update_task":
        task = get_task(hub, str(payload.get("task_id") or ""))
        if task is None:
            raise RuntimeError("задача не найдена")
        previous = task.status
        if payload.get("title"):
            task.title = str(payload["title"])[:200]
        if payload.get("goal"):
            task.goal = str(payload["goal"])
        if payload.get("next_step"):
            task.next_step = str(payload["next_step"])
        if payload.get("status"):
            task.status = TaskStatus(str(payload["status"]))
        saved = save_task(hub, task)
        if saved.status is not previous:
            append_event(
                hub,
                LedgerEvent(
                    type="task.status",
                    subject=saved.id,
                    actor="Kova Chat",
                    data={"from": previous.value, "to": saved.status.value},
                ),
            )
        return {
            "task_id": saved.id,
            "title": saved.title,
            "status": saved.status.value,
            "previous_status": previous.value,
        }

    if kind == "update_project_settings":
        project = load_project(hub)
        changed: dict[str, Any] = {}
        if payload.get("isolation") in {"direct", "worktree", "sandbox"}:
            from .domain.enums import IsolationMode

            project.isolation = IsolationMode(str(payload["isolation"]))
            changed["isolation"] = project.isolation.value
        if payload.get("max_parallel_runs") is not None:
            project.max_parallel_runs = max(
                1, min(4, int(payload["max_parallel_runs"]))
            )
            changed["max_parallel_runs"] = project.max_parallel_runs
        if payload.get("token_budget") is not None:
            project.token_budget = max(0, min(100_000_000, int(payload["token_budget"])))
            changed["token_budget"] = project.token_budget
        if isinstance(payload.get("local_only"), bool):
            project.local_only = bool(payload["local_only"])
            changed["local_only"] = project.local_only
        if isinstance(payload.get("egress_guard"), bool):
            project.egress_guard = bool(payload["egress_guard"])
            changed["egress_guard"] = project.egress_guard
        if not changed:
            raise RuntimeError("нет допустимых настроек")
        save_project(hub, project)
        append_event(
            hub,
            LedgerEvent(
                type="project.settings.updated",
                subject="project",
                actor="Kova Chat",
                data=changed,
            ),
        )
        return {"settings": changed}

    if kind == "start_agent_run":
        from .agents import runner

        record = runner.start_run(
            hub,
            str(payload.get("task_id") or ""),
            provider_id=str(payload.get("provider_id") or "") or None,
            message=str(payload.get("message") or ""),
            model=str(payload.get("model") or "") or None,
        )
        return {
            "task_id": record.get("task_id"),
            "run_id": record.get("id"),
            "status": record.get("status"),
        }

    raise RuntimeError("неизвестное действие")


def decide_action(
    hub: Path,
    chat_id: str,
    action_id: str,
    decision: str,
) -> dict[str, Any] | None:
    with LOCK:
        chat = get_chat(hub, chat_id)
        if chat is None:
            return None
        target: dict[str, Any] | None = None
        for message in chat.get("messages") or []:
            for action in message.get("actions") or []:
                if action.get("id") == action_id:
                    target = action
                    break
            if target is not None:
                break
        if target is None:
            raise KeyError("action not found")
        if target.get("status") != "pending":
            raise RuntimeError("действие уже обработано")
        if decision == "reject":
            target["status"] = "rejected"
            chat["updated_at"] = _now()
            _save(hub, chat)
            return chat
        target["status"] = "approved"
        chat["updated_at"] = _now()
        _save(hub, chat)

    try:
        result = _execute_action(hub, target)
        status = "approved"
        error = ""
    except Exception as exc:  # noqa: BLE001 - surfaced to the user
        result = {}
        status = "failed"
        error = str(exc)[:1000]

    with LOCK:
        chat = get_chat(hub, chat_id)
        if chat is None:
            return None
        for message in chat.get("messages") or []:
            for action in message.get("actions") or []:
                if action.get("id") == action_id:
                    action["status"] = status
                    action["result"] = result
                    action["error"] = error
        chat["updated_at"] = _now()
        _save(hub, chat)
        return chat
