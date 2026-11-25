import json
import os
import shutil
import subprocess
import sys
from functools import lru_cache
from pathlib import Path
from typing import Any

from ..config import app_data_dir
from ..security.secrets import delete_secret, has_secret, set_secret

CONFIG_FILE = "providers.json"

PRESETS: dict[str, dict[str, Any]] = {
    "claude": {
        "name": "Claude Code",
        "command": "claude",
        "args": ["-p", "{prompt}", "--output-format", "json", "--permission-mode", "acceptEdits"],
        "resume_args": [
            "-p",
            "{prompt}",
            "--output-format",
            "json",
            "--permission-mode",
            "acceptEdits",
            "--resume",
            "{session}",
        ],
        "session_regex": '"session_id"\s*:\s*"([^"]+)"',
        "output_mode": "claude-json",
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
            "--json",
        ],
        "chat_args": [
            "exec",
            "--skip-git-repo-check",
            "--sandbox",
            "read-only",
            "--color",
            "never",
            "--json",
        ],
        "prompt_via_stdin": True,
        "resume_args": [
            "exec",
            "resume",
            "{session}",
            "--skip-git-repo-check",
            "--sandbox",
            "workspace-write",
            "--color",
            "never",
            "--json",
        ],
        "session_regex": '"thread_id"\s*:\s*"([^"]+)"',
        "output_mode": "codex-jsonl",
        "description": "OpenAI Codex CLI, песочница workspace-write.",
        "url": "https://github.com/openai/codex",
    },
    "gemini": {
        "name": "Gemini CLI",
        "command": "gemini",
        "args": ["-p", "{prompt}"],
        "resume_args": [],
        "session_regex": "",
        "output_mode": "auto",
        "description": "Google Gemini CLI в режиме одного промпта.",
        "url": "https://github.com/google-gemini/gemini-cli",
    },
    "opencode": {
        "name": "OpenCode",
        "command": "opencode",
        "args": [
            "run",
            "--auto",
            "--format",
            "json",
            "--model",
            "{model}",
        ],
        "chat_args": [
            "run",
            "--agent",
            "plan",
            "--format",
            "json",
            "--model",
            "{model}",
        ],
        "prompt_via_stdin": True,
        "resume_args": [
            "run",
            "--auto",
            "--format",
            "json",
            "--model",
            "{model}",
            "--session",
            "{session}",
        ],
        "models_args": ["models"],
        "session_regex": '"sessionID"\s*:\s*"([^"]+)"',
        "output_mode": "jsonl-auto",
        "description": "OpenCode CLI с авто-подтверждением правок в проекте.",
        "url": "https://opencode.ai",
    },
}



API_CATALOG: dict[str, dict[str, Any]] = {
    "openai": {
        "name": "OpenAI",
        "style": "openai",
        "api_url": "https://api.openai.com/v1/chat/completions",
        "description": "GPT-модели через OpenAI API.",
        "brand": "openai",
        "available": True,
    },
    "anthropic": {
        "name": "Anthropic",
        "style": "anthropic",
        "api_url": "https://api.anthropic.com/v1/messages",
        "description": "Claude через Anthropic Messages API.",
        "brand": "claude",
        "available": True,
    },
    "google": {
        "name": "Google AI Studio",
        "style": "google",
        "api_url": "https://generativelanguage.googleapis.com/v1beta",
        "description": "Gemini через Google AI Studio API.",
        "brand": "gemini",
        "available": True,
    },
    "openrouter": {
        "name": "OpenRouter",
        "style": "openai",
        "api_url": "https://openrouter.ai/api/v1/chat/completions",
        "description": "Единый API ко многим моделям.",
        "brand": "openrouter",
        "available": True,
    },
    "deepseek": {
        "name": "DeepSeek",
        "style": "openai",
        "api_url": "https://api.deepseek.com/v1/chat/completions",
        "description": "DeepSeek через OpenAI-совместимый API.",
        "brand": "deepseek",
        "available": True,
    },
    "xai": {
        "name": "xAI",
        "style": "openai",
        "api_url": "https://api.x.ai/v1/chat/completions",
        "description": "Grok через xAI API.",
        "brand": "xai",
        "available": True,
    },
    "zai": {
        "name": "Z.AI",
        "style": "openai",
        "api_url": "https://api.z.ai/api/paas/v4/chat/completions",
        "description": "Z.AI через OpenAI-совместимый API.",
        "brand": "zai",
        "available": True,
    },
    "azure": {
        "name": "Azure OpenAI",
        "style": "azure",
        "api_url": "",
        "description": "Deployment name, resource URL и api-key.",
        "brand": "azure",
        "available": True,
    },
    "bedrock": {
        "name": "AWS Bedrock",
        "style": "bedrock",
        "api_url": "",
        "description": "Claude через AWS SigV4. Нужны AWS credentials и регион.",
        "brand": "aws",
        "available": True,
    },
    "vertex": {
        "name": "Google Vertex AI",
        "style": "vertex",
        "api_url": "",
        "description": "Gemini через Vertex. Нужны project, region и access token.",
        "brand": "google",
        "available": True,
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
    kind = str(override.get("kind") or base.get("kind") or "cli")
    command = str(override.get("command") or base.get("command") or "")
    args = override.get("args") if isinstance(override.get("args"), list) else base.get("args", [])
    path = resolve_command(command) if command else None
    api_url = str(override.get("api_url") or base.get("api_url") or "")
    api_model = str(override.get("api_model") or base.get("api_model") or "")
    api_style = str(override.get("api_style") or base.get("api_style") or "openai")
    catalog_id = str(override.get("catalog_id") or base.get("catalog_id") or "")
    if not api_style and catalog_id in API_CATALOG:
        api_style = str(API_CATALOG[catalog_id].get("style") or "openai")
    key_ready = has_secret(provider_id)
    local_api = is_local_url(api_url)
    gcp_project = str(override.get("gcp_project") or base.get("gcp_project") or "")
    gcp_region = str(override.get("gcp_region") or base.get("gcp_region") or "us-central1")
    aws_region = str(override.get("aws_region") or base.get("aws_region") or "us-east-1")
    if kind == "api":
        if api_style == "vertex":
            installed = bool(api_model and gcp_project)
        elif api_style == "bedrock":
            installed = bool(api_model and aws_region)
        else:
            installed = bool(api_url and api_model and (key_ready or local_api))
    else:
        installed = path is not None
    return {
        "id": provider_id,
        "name": str(override.get("name") or base.get("name") or provider_id),
        "kind": kind,
        "command": command,
        "args": [str(item) for item in args],
        "enabled": bool(override.get("enabled", True)),
        "installed": installed,
        "path": path or "",
        "api_url": api_url,
        "api_model": api_model,
        "api_style": api_style,
        "api_max_tokens": int(override.get("api_max_tokens") or 4096),
        "catalog_id": catalog_id,
        "gcp_project": gcp_project,
        "gcp_region": gcp_region,
        "aws_region": aws_region,
        "has_key": key_ready,
        "local_api": local_api,
        "version": _version(path) if path else "",
        "builtin": provider_id in PRESETS,
        "description": str(override.get("description") or base.get("description") or ""),
        "url": str(base.get("url") or ""),
        "timeout": int(override.get("timeout") or 1800),
        "models": [
            str(item)
            for item in (override.get("models") or base.get("models") or [])
            if str(item).strip()
        ][:500],
        "default_model": str(override.get("default_model") or base.get("default_model") or ""),
        "read_only_args": [
            str(item)
            for item in (override.get("read_only_args") or [])
            if str(item).strip()
        ],
        "resume_args": [
            str(item)
            for item in (override.get("resume_args") or base.get("resume_args") or [])
        ],
        "models_args": [
            str(item)
            for item in (override.get("models_args") or base.get("models_args") or [])
        ],
        "session_regex": str(
            override.get("session_regex") or base.get("session_regex") or ""
        ),
        "output_mode": str(
            override.get("output_mode") or base.get("output_mode") or "auto"
        ),
        "chat_args": [
            str(item)
            for item in (override.get("chat_args") or base.get("chat_args") or [])
        ],
        "prompt_via_stdin": bool(
            override.get("prompt_via_stdin", base.get("prompt_via_stdin", False))
        ),
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
        kind = str(payload.get("kind") or "cli")
        if not payload.get("name"):
            return None
        if kind != "api" and not payload.get("command"):
            return None
        existing = {
            "name": str(payload["name"]),
            "kind": kind,
            "command": str(payload.get("command") or ""),
            "args": [],
        }
        overrides[provider_id] = existing
    if existing is None:
        existing = {}
        overrides[provider_id] = existing

    if "kind" in payload and payload["kind"] in {"cli", "api"}:
        existing["kind"] = str(payload["kind"])
    if "name" in payload and payload["name"]:
        existing["name"] = str(payload["name"])
    if "description" in payload:
        existing["description"] = str(payload["description"])
    if "command" in payload and payload["command"]:
        existing["command"] = str(payload["command"])
    if "api_url" in payload:
        existing["api_url"] = str(payload["api_url"] or "")
    if "api_model" in payload:
        existing["api_model"] = str(payload["api_model"] or "")
    if "api_style" in payload and payload["api_style"] in {
        "openai",
        "anthropic",
        "google",
        "azure",
        "vertex",
        "bedrock",
    }:
        existing["api_style"] = str(payload["api_style"])
    if "api_max_tokens" in payload:
        try:
            existing["api_max_tokens"] = max(256, min(200_000, int(payload["api_max_tokens"])))
        except (TypeError, ValueError):
            pass
    if "catalog_id" in payload:
        existing["catalog_id"] = str(payload["catalog_id"] or "")
    if "gcp_project" in payload:
        existing["gcp_project"] = str(payload["gcp_project"] or "")
    if "gcp_region" in payload:
        existing["gcp_region"] = str(payload["gcp_region"] or "us-central1")
    if "aws_region" in payload:
        existing["aws_region"] = str(payload["aws_region"] or "us-east-1")
    if "api_key" in payload:
        value = str(payload.get("api_key") or "")
        if value:
            set_secret(provider_id, value)
        elif payload.get("delete_key"):
            delete_secret(provider_id)
    if payload.get("delete_key"):
        delete_secret(provider_id)
    if "args" in payload and isinstance(payload["args"], list):
        existing["args"] = [str(item) for item in payload["args"]]
    if "enabled" in payload:
        existing["enabled"] = bool(payload["enabled"])
    if "timeout" in payload:
        try:
            existing["timeout"] = max(60, min(7200, int(payload["timeout"])))
        except (TypeError, ValueError):
            pass
    if "models" in payload and isinstance(payload["models"], list):
        existing["models"] = [str(item).strip() for item in payload["models"] if str(item).strip()][:500]
    if "default_model" in payload:
        existing["default_model"] = str(payload["default_model"] or "")[:200]
    if "models_args" in payload and isinstance(payload["models_args"], list):
        existing["models_args"] = [str(item) for item in payload["models_args"]][:20]
    if "read_only_args" in payload and isinstance(payload["read_only_args"], list):
        existing["read_only_args"] = [str(item) for item in payload["read_only_args"]][:40]
    if "resume_args" in payload and isinstance(payload["resume_args"], list):
        existing["resume_args"] = [str(item) for item in payload["resume_args"]][:40]
    if "session_regex" in payload:
        existing["session_regex"] = str(payload["session_regex"] or "")
    if "output_mode" in payload:
        existing["output_mode"] = str(payload["output_mode"] or "auto")
    if payload.get("set_default"):
        config["default"] = provider_id
    _write_config(config)
    return get_provider(provider_id)


def delete_provider(provider_id: str) -> bool:
    if provider_id in PRESETS:
        return False
    delete_secret(provider_id)
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


def build_command(
    provider: dict[str, Any],
    prompt: str,
    model: str = "",
    read_only: bool = False,
    prompt_via_stdin: bool = False,
) -> list[str]:
    path = str(provider.get("path") or "")
    if not path or not Path(path).is_file():
        resolved = resolve_command(str(provider.get("command") or ""))
        if not resolved:
            raise FileNotFoundError(f"CLI не найден: {provider.get('command')}")
        path = resolved

    if read_only:
        args = [str(item) for item in provider.get("read_only_args") or []]
        if not args:
            raise RuntimeError(
                "для провайдера не настроены аргументы режима «только чтение»"
            )
    else:
        args = [str(item) for item in provider.get("args") or []]
    replaced = False
    final: list[str] = []
    for item in args:
        if "{model}" in item:
            item = item.replace("{model}", model)
        if "{prompt}" in item:
            final.append(item.replace("{prompt}", prompt))
            replaced = True
        else:
            final.append(item)
    if not replaced and not prompt_via_stdin:
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


def build_resume_command(
    provider: dict[str, Any],
    prompt: str,
    session_id: str,
    model: str = "",
    read_only: bool = False,
    prompt_via_stdin: bool = False,
) -> list[str]:
    resume_args = [str(item) for item in provider.get("resume_args") or []]
    if not resume_args:
        raise RuntimeError("для провайдера не настроены аргументы resume")
    if not session_id:
        raise RuntimeError("у сессии нет идентификатора CLI")
    source = resume_args
    if read_only:
        source = [str(item) for item in provider.get("read_only_args") or []]
        if not source:
            raise RuntimeError("для провайдера не настроены аргументы «только чтение»")
        source = [item.replace("{session}", session_id) for item in source]
    return build_command(
        {**provider, "args": source},
        prompt,
        model,
        read_only=False,
        prompt_via_stdin=prompt_via_stdin,
    )


def catalog() -> list[dict[str, Any]]:
    rows, _default = list_providers()
    connected = {
        str(row.get("catalog_id")): row for row in rows if row.get("catalog_id")
    }
    result = []
    for catalog_id, base in API_CATALOG.items():
        provider = connected.get(catalog_id)
        result.append(
            {
                "id": catalog_id,
                "name": base["name"],
                "style": base["style"],
                "api_url": base["api_url"],
                "description": base["description"],
                "brand": base["brand"],
                "available": bool(base["available"]),
                "connected": bool(provider and provider.get("installed")),
                "configured": bool(provider),
                "provider_id": str(provider.get("id") or "") if provider else "",
                "models_count": len(provider.get("models") or []) if provider else 0,
            }
        )
    return result


def is_local_url(url: str) -> bool:
    from urllib.parse import urlparse

    host = (urlparse(url).hostname or "").lower()
    return host in {"localhost", "127.0.0.1", "::1"}


def discover_models(provider: dict[str, Any]) -> list[str]:
    import http.client
    import ssl
    from urllib.parse import urlparse

    from ..security.secrets import get_secret

    if provider.get("kind") == "api":
        from urllib.parse import parse_qs, urlencode

        style = str(provider.get("api_style") or "openai")
        raw = str(provider.get("api_url") or "")
        parsed = urlparse(raw)
        path = parsed.path or "/v1/chat/completions"
        headers = {"Accept": "application/json"}
        key = get_secret(str(provider.get("id") or ""))
        params = {name: values[0] for name, values in parse_qs(parsed.query).items()}

        if style == "anthropic":
            base = path.rstrip("/")
            if base.endswith("/messages"):
                base = base[: -len("/messages")]
            path = base.rstrip("/") + "/models"
            if key:
                headers["x-api-key"] = key
            headers["anthropic-version"] = "2023-06-01"
        elif style in {"vertex", "bedrock", "azure"}:
            raise RuntimeError(
                "для этого провайдера список моделей не поддерживается — укажи модель вручную"
            )
        elif style == "google":
            base = path.rstrip("/")
            if "/models" in base:
                base = base.split("/models")[0]
            path = base.rstrip("/") + "/models"
            if key:
                params["key"] = key
        else:
            for suffix in ("/chat/completions", "/completions"):
                if path.endswith(suffix):
                    path = path[: -len(suffix)] + "/models"
                    break
            else:
                path = path.rstrip("/") + "/models"
            if key:
                headers["Authorization"] = f"Bearer {key}"

        if params:
            path += "?" + urlencode(params)
        host = parsed.hostname or ""
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        connection: http.client.HTTPConnection
        if parsed.scheme == "https":
            connection = http.client.HTTPSConnection(
                host, port, timeout=20, context=ssl.create_default_context()
            )
        else:
            connection = http.client.HTTPConnection(host, port, timeout=20)
        try:
            connection.request("GET", path, headers=headers)
            response = connection.getresponse()
            body = response.read(2_000_000).decode("utf-8", errors="replace")
        finally:
            connection.close()
        if response.status >= 400:
            raise RuntimeError(f"API вернул {response.status}: {body.strip()[:300]}")
        try:
            payload = json.loads(body)
        except ValueError as exc:
            raise RuntimeError("API вернул не JSON") from exc
        if isinstance(payload, dict):
            rows = payload.get("data") or payload.get("models") or []
        else:
            rows = payload
        if not isinstance(rows, list):
            raise RuntimeError("в ответе нет списка моделей")
        models = []
        for row in rows:
            if not isinstance(row, dict):
                if isinstance(row, str) and row.strip():
                    models.append(row.strip())
                continue
            methods = row.get("supportedGenerationMethods")
            if isinstance(methods, list) and "generateContent" not in methods:
                continue
            value = row.get("id") or row.get("name")
            if isinstance(value, str) and value.strip():
                value = value.strip()
                if value.startswith("models/"):
                    value = value[len("models/") :]
                models.append(value)
        return sorted(dict.fromkeys(models))[:500]

    models_args = [str(item) for item in provider.get("models_args") or []]
    if not models_args:
        raise RuntimeError("для этого CLI не настроена команда списка моделей")
    path = str(provider.get("path") or "")
    if not path:
        resolved = resolve_command(str(provider.get("command") or ""))
        if not resolved:
            raise FileNotFoundError("CLI не найден")
        path = resolved
    result = subprocess.run(
        _argv(path, models_args),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=60,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    text = (result.stdout or "") + "\n" + (result.stderr or "")
    models = []
    for line in text.splitlines():
        value = line.strip()
        if not value or value.startswith(("#", ">", "-", "Usage", "Error")):
            continue
        if " " in value:
            continue
        if "/" not in value and ":" not in value and len(value) < 3:
            continue
        models.append(value)
    if result.returncode != 0 and not models:
        raise RuntimeError(text.strip().splitlines()[-1][:300] if text.strip() else "CLI вернул ошибку")
    return sorted(dict.fromkeys(models))[:500]
