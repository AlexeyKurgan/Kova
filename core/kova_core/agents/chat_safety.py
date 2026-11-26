import json
import re
from pathlib import Path
from typing import Any

# OpenCode chat is deliberately stricter than task runs:
# - reads are limited to the project (external paths are rejected because a
#   non-interactive run cannot answer permission prompts);
# - edits, shell commands, web access, subagents and the Blender MCP are off;
# - common credential files are never sent to the model.
OPENCODE_CHAT_PERMISSIONS: list[dict[str, str]] = [
    {"action": "external_directory", "resource": "*", "effect": "ask"},
    {"action": "edit", "resource": "*", "effect": "deny"},
    {"action": "shell", "resource": "*", "effect": "deny"},
    {"action": "webfetch", "resource": "*", "effect": "deny"},
    {"action": "websearch", "resource": "*", "effect": "deny"},
    {"action": "subagent", "resource": "*", "effect": "deny"},
    {"action": "execute", "resource": "*", "effect": "deny"},
    {"action": "automation_*", "resource": "*", "effect": "deny"},
    {"action": "automation.create", "resource": "*", "effect": "deny"},
    {"action": "opencode_*", "resource": "*", "effect": "deny"},
    {"action": "generate_image", "resource": "*", "effect": "deny"},
    {"action": "generate_video", "resource": "*", "effect": "deny"},
    {"action": "blender_*", "resource": "*", "effect": "deny"},
    {"action": "read", "resource": "*.env", "effect": "deny"},
    {"action": "read", "resource": "*.env.*", "effect": "deny"},
    {"action": "read", "resource": "*secrets.json", "effect": "deny"},
    {"action": "read", "resource": "*providers.json", "effect": "deny"},
    {"action": "read", "resource": "*id_rsa*", "effect": "deny"},
    {"action": "read", "resource": "*id_ed25519*", "effect": "deny"},
    {"action": "read", "resource": "*.pem", "effect": "deny"},
    {"action": "read", "resource": "*.key", "effect": "deny"},
    {"action": "read", "resource": "*credentials*", "effect": "deny"},
    {"action": "read", "resource": "*auth.json", "effect": "deny"},
    {"action": "read", "resource": "*cookies*", "effect": "deny"},
    # Keep examples readable; this must stay after the deny rules because the
    # last matching rule wins.
    {"action": "read", "resource": "*.env.example", "effect": "allow"},
]


def opencode_chat_config(external_paths: list[str] | None = None) -> dict[str, Any]:
    rules = [
        {"action": "external_directory", "resource": "*", "effect": "ask"},
        {"action": "edit", "resource": "*", "effect": "deny"},
        {"action": "shell", "resource": "*", "effect": "deny"},
        {"action": "webfetch", "resource": "*", "effect": "deny"},
        {"action": "websearch", "resource": "*", "effect": "deny"},
        {"action": "subagent", "resource": "*", "effect": "deny"},
        {"action": "execute", "resource": "*", "effect": "deny"},
        {"action": "automation_*", "resource": "*", "effect": "deny"},
        {"action": "automation.create", "resource": "*", "effect": "deny"},
        {"action": "opencode_*", "resource": "*", "effect": "deny"},
        {"action": "generate_image", "resource": "*", "effect": "deny"},
        {"action": "generate_video", "resource": "*", "effect": "deny"},
        {"action": "blender_*", "resource": "*", "effect": "deny"},
    ]
    for raw in external_paths or []:
        path = str(Path(raw).resolve()).replace("\\", "/").rstrip("/")
        if not path:
            continue
        rules.extend(
            [
                {"action": "external_directory", "resource": path, "effect": "allow"},
                {"action": "external_directory", "resource": path + "/*", "effect": "allow"},
                {"action": "read", "resource": path, "effect": "allow"},
                {"action": "read", "resource": path + "/*", "effect": "allow"},
            ]
        )
    rules.extend(
        [
            {"action": "read", "resource": "*.env", "effect": "deny"},
            {"action": "read", "resource": "*.env.*", "effect": "deny"},
            {"action": "read", "resource": "*secrets.json", "effect": "deny"},
            {"action": "read", "resource": "*providers.json", "effect": "deny"},
            {"action": "read", "resource": "*id_rsa*", "effect": "deny"},
            {"action": "read", "resource": "*id_ed25519*", "effect": "deny"},
            {"action": "read", "resource": "*.pem", "effect": "deny"},
            {"action": "read", "resource": "*.key", "effect": "deny"},
            {"action": "read", "resource": "*credentials*", "effect": "deny"},
            {"action": "read", "resource": "*auth.json", "effect": "deny"},
            {"action": "read", "resource": "*cookies*", "effect": "deny"},
            # Keep examples readable; this must stay after the deny rules because the
            # last matching rule wins.
            {"action": "read", "resource": "*.env.example", "effect": "allow"},
        ]
    )
    return {
        "$schema": "https://opencode.ai/config.json",
        "update": "disable",
        "permissions": rules,
        # The Blender MCP can execute Python inside Blender. It is useful for
        # work runs, but a chat must not be able to drive it.
        "policies": [{"action": "mcp.use", "resource": "blender", "effect": "deny"}],
    }


def harden_chat_args(
    provider: dict[str, Any],
    args: list[str],
    external_paths: list[str] | None = None,
) -> list[str]:
    """Add provider-specific hardening that depends on the installed version."""
    result = list(args)
    provider_id = str(provider.get("id") or "")
    if provider_id == "claude":
        match = re.search(r"(\d+)\.(\d+)\.(\d+)", str(provider.get("version") or ""))
        if match:
            version = tuple(int(part) for part in match.groups())
            if version >= (2, 1, 248) and "--restricted" not in result:
                result.append("--restricted")
        for path in external_paths or []:
            result.extend(["--add-dir", str(path)])
    elif provider_id == "gemini":
        for path in external_paths or []:
            result.extend(["--include-directories", str(path)])
    return result


def prepare_chat_env(
    provider: dict[str, Any],
    env: dict[str, str],
    cwd: str,
    external_paths: list[str] | None = None,
) -> dict[str, str]:
    # Kova may itself be launched from an OpenCode/agent terminal. Do not let
    # the parent session ID or shell PWD leak into the child CLI and change the
    # workspace it operates on.
    clean = {
        key: value
        for key, value in env.items()
        if not key.startswith("OPENCODE_")
        and key not in {"AI_AGENT", "INIT_CWD", "OLDPWD", "PWD"}
    }
    clean["PWD"] = str(cwd)
    return apply_chat_env(provider, clean, external_paths)


def apply_chat_env(
    provider: dict[str, Any],
    env: dict[str, str],
    external_paths: list[str] | None = None,
) -> dict[str, str]:
    if str(provider.get("id") or "") != "opencode":
        return env
    result = dict(env)
    result["OPENCODE_CONFIG_CONTENT"] = json.dumps(
        opencode_chat_config(external_paths),
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return result
