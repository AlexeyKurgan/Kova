import json
import re
import subprocess
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..config import app_data_dir
from .providers import _argv, resolve_command

LOCK = threading.Lock()
FILE = "capabilities.json"
TIMEOUT = 12


def _now() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def _file() -> Path:
    return app_data_dir() / FILE


def _read() -> dict[str, Any]:
    try:
        payload = json.loads(_file().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        payload = {}
    providers = payload.get("providers") if isinstance(payload, dict) else None
    return providers if isinstance(providers, dict) else {}


def _write(providers: dict[str, Any]) -> None:
    path = _file()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"version": 1, "providers": providers}, ensure_ascii=False, indent=2)
        + "\n",
        encoding="utf-8",
    )


def empty_capabilities() -> dict[str, Any]:
    return {
        "checked": False,
        "checked_at": "",
        "source": "",
        "version": "",
        "supports_model": False,
        "supports_resume": False,
        "supports_json": False,
        "supports_permissions": False,
        "supports_non_interactive": False,
        "flags": [],
        "note": "Возможности не проверялись. Нажми «Проверить».",
    }


def clear_capabilities(provider_id: str) -> None:
    with LOCK:
        rows = _read()
        if provider_id in rows:
            rows.pop(provider_id, None)
            _write(rows)


def get_capabilities(provider_id: str) -> dict[str, Any]:
    with LOCK:
        row = _read().get(provider_id)
    if not isinstance(row, dict):
        return empty_capabilities()
    return {**empty_capabilities(), **row, "checked": True}


def detect_flags(text: str) -> dict[str, Any]:
    lower = text.lower()
    flags: list[str] = []

    def found(pattern: str) -> bool:
        match = re.search(pattern, lower)
        if match:
            value = match.group(0).strip()
            if value not in flags:
                flags.append(value)
            return True
        return False

    supports_model = found(r"--model\b") or found(r"(?<!\w)-m(?!\w)")
    supports_resume = (
        found(r"--resume\b")
        or found(r"--continue\b")
        or found(r"\bresume\b")
        or found(r"\bcontinue\b")
    )
    supports_json = (
        found(r"--json\b")
        or found(r"--output-format\b")
        or found(r"--format\b")
    )
    supports_permissions = (
        found(r"--permission-mode\b")
        or found(r"--sandbox\b")
        or found(r"--dangerously-skip-permissions\b")
        or found(r"--auto\b")
    )
    supports_non_interactive = (
        found(r"--print\b")
        or found(r"--exec\b")
        or found(r"(?<!\w)-p(?!\w)")
        or found(r"\bexec\b")
        or found(r"\brun\b")
    )
    return {
        "supports_model": supports_model,
        "supports_resume": supports_resume,
        "supports_json": supports_json,
        "supports_permissions": supports_permissions,
        "supports_non_interactive": supports_non_interactive,
        "flags": flags,
    }


def probe_provider(provider: dict[str, Any]) -> dict[str, Any]:
    provider_id = str(provider.get("id") or "")
    path = str(provider.get("path") or "")
    if not path:
        resolved = resolve_command(str(provider.get("command") or ""))
        path = resolved or ""
    if not path:
        row = {
            **empty_capabilities(),
            "checked": True,
            "checked_at": _now(),
            "source": "missing",
            "version": str(provider.get("version") or ""),
            "note": "CLI не найден. Проверь команду или полный путь.",
        }
        _store(provider_id, row)
        return row

    try:
        result = subprocess.run(
            _argv(path, ["--help"]),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=TIMEOUT,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        text = ((result.stdout or "") + "\n" + (result.stderr or "")).strip()
        source = "help"
        note = "Флаги определены по выводу --help. Отсутствие флага не доказывает его отсутствие."
    except subprocess.TimeoutExpired:
        text = ""
        source = "timeout"
        note = "CLI не ответил на --help за отведённое время."
    except (OSError, ValueError) as exc:
        text = ""
        source = "error"
        note = f"Не удалось запустить --help: {exc}"

    detected = detect_flags(text) if text else {}
    row = {
        **empty_capabilities(),
        **detected,
        "checked": True,
        "checked_at": _now(),
        "source": source,
        "version": str(provider.get("version") or ""),
        "note": note,
    }
    _store(provider_id, row)
    return row


def _store(provider_id: str, row: dict[str, Any]) -> None:
    if not provider_id:
        return
    with LOCK:
        rows = _read()
        rows[provider_id] = row
        _write(rows)
