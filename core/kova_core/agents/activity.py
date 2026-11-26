import json
import os
import re
from pathlib import Path
from typing import Any

_SENSITIVE = re.compile(
    r"(^|[\\/])\.env($|\.)|secrets\.json|providers\.json|id_rsa|id_ed25519|"
    r"\.pem$|\.key$|credentials|auth\.json|cookies|\.ssh([\\/]|$)|token",
    re.IGNORECASE,
)
_NETWORK = re.compile(
    r"\b(curl|wget|invoke-webrequest|invoke-restmethod|git\s+push|scp|sftp|ftp|"
    r"ssh|nc|ncat|telnet)\b",
    re.IGNORECASE,
)
_DRIVE_PATH = re.compile(r"(?i)\b[A-Za-z]:[\\/][^\s\"'`<>|;]*")


def _rows(raw: str) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for line in raw.splitlines():
        text = line.strip()
        if not text.startswith("{") or not text.endswith("}"):
            continue
        try:
            row = json.loads(text)
        except ValueError:
            continue
        if isinstance(row, dict):
            result.append(row)
    return result


def _short(value: Any, limit: int = 4000) -> str:
    text = str(value or "").strip()
    return text if len(text) <= limit else text[:limit] + "\n…"


def _tool_detail(tool: str, data: dict[str, Any]) -> str:
    for key in ("path", "filePath", "file_path", "command", "pattern", "query", "url", "description"):
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()[:500]
    if isinstance(data.get("paths"), list) and data["paths"]:
        return ", ".join(str(item) for item in data["paths"][:4])[:500]
    return ""


def _tool_label(tool: str) -> str:
    name = tool.lower()
    if name in {"read", "read_file"}:
        return "Read file"
    if name in {"glob", "grep", "list", "ls", "search"}:
        return "Explored"
    if name in {"bash", "shell", "run_command", "command"}:
        return "Ran command"
    if name in {"edit", "write", "write_file", "patch", "apply_patch"}:
        return "Edited file"
    if name in {"webfetch", "fetch", "web_search"}:
        return "Fetched"
    return tool or "Tool"


def _inside_project(value: str, root: Path | None) -> bool:
    if root is None:
        return True
    try:
        target = Path(value).resolve()
        return target == root or root in target.parents
    except (OSError, ValueError):
        return False


def _expand_path(value: str) -> str:
    text = value.strip().strip("'\"")
    appdata = os.environ.get("APPDATA") or os.environ.get("XDG_CONFIG_HOME") or ""
    home = str(Path.home())
    for marker in ("%APPDATA%", "$APPDATA", "${APPDATA}"):
        text = text.replace(marker, appdata)
    for marker in ("%USERPROFILE%", "$USERPROFILE", "$HOME", "${HOME}"):
        text = text.replace(marker, home)
    if text.startswith("~"):
        text = home + text[1:]
    return text


def _path_candidates(detail: str, tool: str, kind: str) -> list[str]:
    text = detail.strip()
    if not text:
        return []
    values: list[str] = []
    if kind == "file":
        values.extend(
            part.strip()
            for part in re.split(r",\s*(?=[A-Za-z]:[\\/])", text)
        )
    elif tool.lower() in {"read", "read_file"}:
        values.append(text)
    elif tool.lower() in {"glob", "grep", "list", "ls", "search"}:
        values.append(text)
    else:
        # Shell commands: quoted paths first, then variable/drive paths. The
        # scanner is best-effort; activity flags are a warning, not a sandbox.
        values.extend(
            first or second
            for first, second in re.findall(
                r'"([^"]+)"|\'([^\']+)\'', text
            )
        )
        values.extend(
            re.findall(
                r"(?i)(?:\$APPDATA|%APPDATA%|\$HOME|~)[^\s\"'`<>|;]*", text
            )
        )
        values.extend(_DRIVE_PATH.findall(text))
    result: list[str] = []
    for value in values:
        candidate = _expand_path(value)
        candidate = re.split(r"[*?\[]", candidate)[0].rstrip(".,;)")
        if not candidate:
            continue
        if re.match(r"(?i)^[A-Za-z]:[\\/]", candidate) or candidate.startswith(
            ("/", "\\")
        ):
            result.append(candidate)
    # A path with spaces is also picked up as a shorter prefix by the unquoted
    # scanner. Keep only the longest form so "Blade Evolve" is not reported as
    # the external "Blade" directory.
    cleaned: list[str] = []
    for candidate in result:
        if candidate.lower() in {item.lower() for item in cleaned}:
            continue
        if any(
            len(other) > len(candidate)
            and other.lower().startswith(candidate.lower())
            and other[len(candidate)] in " \\/"
            for other in result
        ):
            continue
        cleaned.append(candidate)
    return cleaned


def _external_detail(text: str, tool: str, kind: str, root: Path | None) -> bool:
    if not text:
        return False
    if "../" in text or "..\\" in text:
        return True
    for candidate in _path_candidates(text, tool, kind):
        if root is None or not _inside_project(candidate, root):
            return True
    return False


def _annotate(items: list[dict[str, Any]], project_root: str | None) -> list[dict[str, Any]]:
    root = Path(project_root).resolve() if project_root else None
    for item in items:
        detail = str(item.get("detail") or "")
        tool = str(item.get("tool") or "").lower()
        flags: list[str] = []
        if _external_detail(detail, tool, str(item.get("kind") or ""), root):
            flags.append("external")
        if _SENSITIVE.search(detail):
            flags.append("sensitive")
        if tool in {"webfetch", "websearch", "fetch", "web_search"} or (
            tool in {"bash", "shell", "run_command", "command"}
            and _NETWORK.search(detail)
        ):
            flags.append("network")
        if flags:
            item["flags"] = flags
    return items


def _opencode(raw: str, final: bool) -> list[dict[str, Any]]:
    rows = _rows(raw)
    items: list[dict[str, Any]] = []
    by_id: dict[str, dict[str, Any]] = {}
    current_thought: dict[str, Any] | None = None
    thought_index = 0
    for row in rows:
        kind = str(row.get("type") or "")
        part = row.get("part") if isinstance(row.get("part"), dict) else {}
        timestamp = int(row.get("timestamp") or 0)
        if kind == "step_start":
            thought_index += 1
            current_thought = {
                "id": f"thought-{thought_index}",
                "kind": "thought",
                "label": "Thought",
                "detail": "",
                "status": "running",
                "duration_ms": 0,
                "output": "",
                "started_ms": timestamp,
            }
            items.append(current_thought)
            by_id[current_thought["id"]] = current_thought
            continue
        if kind == "step_finish":
            if current_thought is not None:
                current_thought["status"] = "done"
                if timestamp and current_thought.get("started_ms"):
                    current_thought["duration_ms"] = max(
                        0, timestamp - int(current_thought["started_ms"])
                    )
                current_thought.pop("started_ms", None)
                current_thought = None
            continue
        if kind != "tool_use":
            continue
        part_id = str(part.get("partID") or part.get("id") or "")
        tool = str(part.get("tool") or "")
        state = part.get("state") if isinstance(part.get("state"), dict) else {}
        data = state.get("input") if isinstance(state.get("input"), dict) else {}
        status = str(state.get("status") or "running")
        mapped = (
            "done"
            if status in {"completed", "success"}
            else "error"
            if status == "error"
            else "running"
        )
        item = by_id.get(part_id)
        if item is None:
            item = {
                "id": part_id or f"tool-{len(items) + 1}",
                "kind": "tool",
                "label": _tool_label(tool),
                "detail": _tool_detail(tool, data),
                "status": mapped,
                "duration_ms": 0,
                "output": _short(state.get("error") or state.get("output")),
                "tool": tool,
            }
            items.append(item)
            by_id[item["id"]] = item
        else:
            item["status"] = mapped
            item["detail"] = _tool_detail(tool, data) or item["detail"]
            item["output"] = (
                _short(state.get("error") or state.get("output")) or item["output"]
            )
    if final:
        for item in items:
            if item.get("status") == "running":
                item["status"] = "done"
            item.pop("started_ms", None)
    return items[:80]


def _codex(raw: str, final: bool) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for row in _rows(raw):
        if row.get("type") not in {"item.started", "item.completed"}:
            continue
        item = row.get("item") if isinstance(row.get("item"), dict) else {}
        kind = str(item.get("type") or "")
        status = "running" if row.get("type") == "item.started" else "done"
        if kind == "command_execution":
            exit_code = item.get("exit_code")
            if exit_code not in (None, 0):
                status = "error"
            items.append(
                {
                    "id": str(item.get("id") or f"cmd-{len(items) + 1}"),
                    "kind": "command",
                    "label": "Ran command",
                    "detail": str(item.get("command") or "")[:500],
                    "status": status,
                    "duration_ms": 0,
                    "output": _short(item.get("aggregated_output") or item.get("output")),
                    "tool": "command",
                }
            )
        elif kind == "file_change":
            paths = [
                str(change.get("path") or "")
                for change in (item.get("changes") or [])
                if isinstance(change, dict) and str(change.get("path") or "").strip()
            ]
            items.append(
                {
                    "id": str(item.get("id") or f"file-{len(items) + 1}"),
                    "kind": "file",
                    "label": "Changed file",
                    "detail": ", ".join(paths[:4])[:500],
                    "status": status,
                    "duration_ms": 0,
                    "output": "",
                    "tool": "file_change",
                }
            )
        elif kind in {"reasoning", "thinking"}:
            text = str(item.get("text") or item.get("summary") or "").strip()
            if text:
                items.append(
                    {
                        "id": str(item.get("id") or f"thought-{len(items) + 1}"),
                        "kind": "thought",
                        "label": "Thought",
                        "detail": "",
                        "status": status,
                        "duration_ms": 0,
                        "output": _short(text),
                        "tool": "reasoning",
                    }
                )
    if final:
        for item in items:
            if item.get("status") == "running":
                item["status"] = "done"
    return items[:80]


def extract_activity(
    raw: str,
    provider: dict[str, Any],
    final: bool = False,
    project_root: str | None = None,
) -> list[dict[str, Any]]:
    mode = str(provider.get("output_mode") or "auto")
    provider_id = str(provider.get("id") or "")
    if mode == "jsonl-auto" or provider_id == "opencode":
        return _annotate(_opencode(raw, final), project_root)
    if mode == "codex-jsonl" or provider_id == "codex":
        return _annotate(_codex(raw, final), project_root)
    return []
