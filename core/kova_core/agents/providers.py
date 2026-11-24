import json
import os
import shutil
import subprocess
import sys
from functools import lru_cache
from pathlib import Path
from typing import Any

from ..config import app_data_dir

CONFIG_FILE = "providers.json"

PRESETS: dict[str, dict[str, Any]] = {
    "claude": {
        "name": "Claude Code",
        "command": "claude",
        "args": ["-p", "{prompt}", "--output-format", "text", "--permission-mode", "acceptEdits"],
        "description": "Anthropic Claude Code в неинтерактивном режиме.",
        "url": "https://claude.com/product/claude-code",
    },
    "codex": {
        "name": "Codex CLI",
        "command": "codex",
        "args": [
            "exec",
            "--skip-git-repo-check",
            "--sandbox",
            "workspace-write",
            "--color",
            "never",
            "{prompt}",
        ],
        "description": "OpenAI Codex CLI, песочница workspace-write.",
        "url": "https://github.com/openai/codex",
    },
    "gemini": {
        "name": "Gemini CLI",
        "command": "gemini",
        "args": ["-p", "{prompt}"],
        "description": "Google Gemini CLI в режиме одного промпта.",
        "url": "https://github.com/google-gemini/gemini-cli",
    },
    "opencode": {
        "name": "OpenCode",
        "command": "opencode",
        "args": ["run", "--auto", "{prompt}"],
        "description": "OpenCode CLI с авто-подтверждением правок в проекте.",
        "url": "https://opencode.ai",
    },
}


def config_file() -> Path:
    return app_data_dir() / CONFIG_FILE


def _read_config() -> dict[str, Any]:
    try:
        payload = json.loads(config_file().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        payload = {}
    if not isinstance(payload, dict):
        payload = {}
    providers = payload.get("providers")
    return {
        "default": str(payload.get("default") or ""),
        "providers": providers if isinstance(providers, dict) else {},
    }


def _write_config(config: dict[str, Any]) -> None:
    path = config_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"version": 1, **config}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _expand(command: str) -> str:
    return os.path.expandvars(os.path.expanduser(command.strip()))


def resolve_command(command: str) -> str | None:
    if not command:
        return None
    expanded = _expand(command)
    if any(separator in expanded for separator in ("/", "\\")):
        return expanded if Path(expanded).is_file() else None
    return shutil.which(expanded)


def _argv(path: str, args: list[str]) -> list[str]:
    if os.name == "nt" and path.lower().endswith((".cmd", ".bat")):
        shell = os.environ.get("COMSPEC") or "cmd.exe"
        return [shell, "/c", path, *args]
    return [path, *args]


@lru_cache(maxsize=32)
def _version(path: str) -> str:
    try:
        result = subprocess.run(
            _argv(path, ["--version"]),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=12,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except (OSError, subprocess.SubprocessError):
        return ""
    text = ((result.stdout or "") + "\n" + (result.stderr or "")).strip()
    return text.splitlines()[0].strip() if text else ""


def _entry(provider_id: str, base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    command = str(override.get("command") or base.get("command") or "")
    args = override.get("args") if isinstance(override.get("args"), list) else base.get("args", [])
    path = resolve_command(command)
    return {
        "id": provider_id,
        "name": str(override.get("name") or base.get("name") or provider_id),
        "kind": "cli",
        "command": command,
        "args": [str(item) for item in args],
        "enabled": bool(override.get("enabled", True)),
        "installed": path is not None,
        "path": path or "",
        "version": _version(path) if path else "",
        "builtin": provider_id in PRESETS,
        "description": str(override.get("description") or base.get("description") or ""),
        "url": str(base.get("url") or ""),
        "timeout": int(override.get("timeout") or 1800),
    }


def list_providers() -> tuple[list[dict[str, Any]], str]:
    config = _read_config()
    overrides = config["providers"]
    rows: list[dict[str, Any]] = []
    for provider_id, base in PRESETS.items():
        rows.append(_entry(provider_id, base, overrides.get(provider_id) or {}))
    for provider_id, override in overrides.items():
        if provider_id in PRESETS or not isinstance(override, dict):
            continue
        rows.append(_entry(provider_id, {"name": provider_id}, override))

    default = config["default"]
    if default and any(row["id"] == default for row in rows):
        pass
    else:
        installed = [row for row in rows if row["installed"] and row["enabled"]]
        default = installed[0]["id"] if installed else ""
    for row in rows:
        row["default"] = row["id"] == default
    return rows, default


def get_provider(provider_id: str | None = None) -> dict[str, Any] | None:
    rows, default = list_providers()
    target = provider_id or default
    if not target:
        return None
    for row in rows:
        if row["id"] == target:
            return row
    return None


def update_provider(provider_id: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    config = _read_config()
    overrides = config["providers"]
    existing = overrides.get(provider_id)
    if existing is None and provider_id not in PRESETS:
        if not payload.get("name") or not payload.get("command"):
            return None
        existing = {"name": str(payload["name"]), "command": str(payload["command"]), "args": []}
        overrides[provider_id] = existing
    if existing is None:
        existing = {}
        overrides[provider_id] = existing

    if "name" in payload and payload["name"]:
        existing["name"] = str(payload["name"])
    if "description" in payload:
        existing["description"] = str(payload["description"])
    if "command" in payload and payload["command"]:
        existing["command"] = str(payload["command"])
    if "args" in payload and isinstance(payload["args"], list):
        existing["args"] = [str(item) for item in payload["args"]]
    if "enabled" in payload:
        existing["enabled"] = bool(payload["enabled"])
    if "timeout" in payload:
        try:
            existing["timeout"] = max(60, min(7200, int(payload["timeout"])))
        except (TypeError, ValueError):
            pass
    if payload.get("set_default"):
        config["default"] = provider_id
    _write_config(config)
    return get_provider(provider_id)


def delete_provider(provider_id: str) -> bool:
    if provider_id in PRESETS:
        return False
    config = _read_config()
    providers = config["providers"]
    if provider_id not in providers:
        return False
    providers.pop(provider_id, None)
    if config["default"] == provider_id:
        config["default"] = ""
    _write_config(config)
    return True


def default_provider_id() -> str:
    return list_providers()[1]


def build_command(provider: dict[str, Any], prompt: str) -> list[str]:
    path = str(provider.get("path") or "")
    if not path or not Path(path).is_file():
        resolved = resolve_command(str(provider.get("command") or ""))
        if not resolved:
            raise FileNotFoundError(f"CLI не найден: {provider.get('command')}")
        path = resolved

    args = [str(item) for item in provider.get("args") or []]
    replaced = False
    final: list[str] = []
    for item in args:
        if "{prompt}" in item:
            final.append(item.replace("{prompt}", prompt))
            replaced = True
        else:
            final.append(item)
    if not replaced:
        final.append(prompt)
    return _argv(path, final)


def provider_env() -> dict[str, str]:
    env = os.environ.copy()
    env.setdefault("CI", "1")
    env.setdefault("NO_COLOR", "1")
    env.setdefault("TERM", "dumb")
    env.setdefault("PYTHONIOENCODING", "utf-8")
    return env


def platform_note() -> str:
    return "Windows" if os.name == "nt" else ("macOS" if sys.platform == "darwin" else "Linux")
