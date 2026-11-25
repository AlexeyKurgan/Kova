import json
import re
from typing import Any

SESSION_KEYS = {
    "session_id",
    "sessionId",
    "sessionID",
    "thread_id",
    "threadId",
    "conversation_id",
    "conversationId",
}
USAGE_KEYS = {"usage", "token_usage", "tokenUsage", "stats"}


def _find_session(value: Any) -> str:
    if isinstance(value, dict):
        for key, item in value.items():
            if key in SESSION_KEYS and isinstance(item, str) and item.strip():
                return item.strip()
        for item in value.values():
            found = _find_session(item)
            if found:
                return found
    elif isinstance(value, list):
        for item in value:
            found = _find_session(item)
            if found:
                return found
    return ""


def _find_usage(value: Any) -> dict[str, Any] | None:
    if isinstance(value, dict):
        for key, item in value.items():
            if key in USAGE_KEYS and isinstance(item, dict):
                return item
        for item in value.values():
            found = _find_usage(item)
            if found:
                return found
    elif isinstance(value, list):
        for item in value:
            found = _find_usage(item)
            if found:
                return found
    return None


def _parse_json_lines(raw: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for line in raw.splitlines():
        text = line.strip()
        if not text.startswith("{") or not text.endswith("}"):
            continue
        try:
            payload = json.loads(text)
        except ValueError:
            continue
        if isinstance(payload, dict):
            rows.append(payload)
    return rows


def _codex_actions(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    actions: list[dict[str, Any]] = []
    for row in rows:
        if row.get("type") != "item.completed":
            continue
        item = row.get("item")
        if not isinstance(item, dict):
            continue
        kind = item.get("type")
        if kind == "command_execution":
            command = item.get("command")
            if isinstance(command, str) and command.strip():
                actions.append(
                    {
                        "kind": "command",
                        "value": command.strip()[:500],
                        "exit_code": item.get("exit_code"),
                    }
                )
        elif kind == "file_change":
            changes = item.get("changes")
            if isinstance(changes, list):
                for change in changes:
                    if not isinstance(change, dict):
                        continue
                    path = change.get("path")
                    if isinstance(path, str) and path.strip():
                        actions.append(
                            {
                                "kind": "file",
                                "value": path.strip()[:500],
                                "change": str(change.get("kind") or ""),
                            }
                        )
    return actions[:200]


def _codex_text(rows: list[dict[str, Any]]) -> list[str]:
    texts: list[str] = []
    for row in rows:
        if row.get("type") != "item.completed":
            continue
        item = row.get("item")
        if isinstance(item, dict) and item.get("type") == "agent_message":
            text = item.get("text")
            if isinstance(text, str) and text.strip():
                texts.append(text.strip())
    return texts


def _generic_text(rows: list[dict[str, Any]]) -> list[str]:
    texts: list[str] = []
    for row in rows:
        found = ""
        for key in ("result", "text", "content"):
            value = row.get(key)
            if isinstance(value, str) and value.strip():
                found = value.strip()
                break
        if not found:
            part = row.get("part")
            if isinstance(part, dict):
                for key in ("text", "content"):
                    value = part.get(key)
                    if isinstance(value, str) and value.strip():
                        found = value.strip()
                        break
        if found:
            texts.append(found)
    return texts


def parse_output(raw: str, provider: dict[str, Any]) -> dict[str, Any]:
    """Extract CLI session id, display text and usage without inventing values."""
    mode = str(provider.get("output_mode") or "auto")
    session_id = ""
    display = raw
    usage: dict[str, Any] | None = None
    actions: list[dict[str, Any]] = []
    parsed = False

    if mode in {"codex-jsonl", "jsonl-auto"}:
        rows = _parse_json_lines(raw)
        if rows:
            parsed = True
            for row in rows:
                found = _find_session(row)
                if found:
                    session_id = found
                    break
            if mode == "codex-jsonl":
                texts = _codex_text(rows)
                actions = _codex_actions(rows)
            else:
                texts = _generic_text(rows)
            if texts:
                display = "\n\n".join(texts)
            for row in rows:
                found_usage = _find_usage(row)
                if found_usage:
                    usage = found_usage
                    break
    elif mode == "claude-json":
        try:
            payload = json.loads(raw)
        except ValueError:
            payload = None
        if isinstance(payload, dict):
            parsed = True
            session_id = _find_session(payload)
            result = payload.get("result")
            if isinstance(result, str) and result.strip():
                display = result
            found_usage = _find_usage(payload)
            if found_usage:
                usage = found_usage
    else:
        try:
            payload = json.loads(raw)
        except ValueError:
            payload = None
        if isinstance(payload, dict):
            parsed = True
            session_id = _find_session(payload)
            for key in ("result", "text", "content"):
                value = payload.get(key)
                if isinstance(value, str) and value.strip():
                    display = value
                    break
            found_usage = _find_usage(payload)
            if found_usage:
                usage = found_usage

    if not session_id:
        pattern = str(provider.get("session_regex") or "").strip()
        if pattern:
            try:
                match = re.search(pattern, raw)
            except re.error:
                match = None
            if match:
                session_id = (match.group(1) if match.groups() else match.group(0)).strip()

    return {
        "session_id": session_id,
        "display": display,
        "usage": usage,
        "actions": actions,
        "parsed": parsed,
    }


def stream_display(raw: str, provider: dict[str, Any]) -> str:
    """Best-effort human-readable text while the process is still running."""
    mode = str(provider.get("output_mode") or "auto")
    if mode == "codex-jsonl":
        rows = _parse_json_lines(raw)
        texts = _codex_text(rows)
        return "\n\n".join(texts) if texts else raw
    if mode == "claude-json":
        try:
            payload = json.loads(raw)
        except ValueError:
            return ""
        if isinstance(payload, dict):
            result = payload.get("result")
            if isinstance(result, str):
                return result
            return ""
        return ""
    return raw
