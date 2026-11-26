import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from kova_core.agents.activity import extract_activity
from kova_core.agents.app_guide import KOVA_APP_GUIDE
from kova_core.agents.chat_safety import (
    harden_chat_args,
    opencode_chat_config,
    prepare_chat_env,
)
from kova_core.agents.providers import PRESETS
from kova_core.chats import _build_egress
from kova_core.security.egress import EgressGuard, egress_hosts


def _rules() -> dict[tuple[str, str], str]:
    config = opencode_chat_config()
    return {
        (str(rule["action"]), str(rule["resource"])): str(rule["effect"])
        for rule in config["permissions"]
    }


def test_opencode_chat_is_read_only_and_project_scoped() -> None:
    rules = _rules()
    assert rules[("external_directory", "*")] == "ask"
    assert rules[("edit", "*")] == "deny"
    assert rules[("shell", "*")] == "deny"
    assert rules[("webfetch", "*")] == "deny"
    assert rules[("websearch", "*")] == "deny"
    assert rules[("subagent", "*")] == "deny"
    assert rules[("execute", "*")] == "deny"
    assert rules[("opencode_*", "*")] == "deny"
    assert rules[("read", "*.env")] == "deny"
    assert rules[("read", "*.env.example")] == "allow"
    assert opencode_chat_config()["policies"] == [
        {"action": "mcp.use", "resource": "blender", "effect": "deny"}
    ]


def test_opencode_allows_explicit_external_reads_but_keeps_secrets_denied() -> None:
    config = opencode_chat_config(["C:/work/shared"])
    rules = config["permissions"]
    shared_reads = [
        index
        for index, rule in enumerate(rules)
        if rule["action"] == "read" and rule["resource"].startswith("C:/work/shared")
    ]
    env_denies = [
        index
        for index, rule in enumerate(rules)
        if rule["action"] == "read" and rule["resource"] == "*.env"
    ]
    assert shared_reads
    assert env_denies
    assert max(shared_reads) < env_denies[0]


def test_cli_chat_modes_are_safe() -> None:
    claude = PRESETS["claude"]["chat_args"]
    assert "--permission-mode" in claude
    assert claude[claude.index("--permission-mode") + 1] == "plan"
    assert "Read,Grep,Glob" in claude
    assert "acceptEdits" not in claude

    gemini = PRESETS["gemini"]["chat_args"]
    assert gemini[gemini.index("--approval-mode") + 1] == "plan"

    opencode = PRESETS["opencode"]["chat_args"]
    assert "--standalone" in opencode
    assert opencode[opencode.index("--agent") + 1] == "plan"
    assert "--auto" not in opencode

    codex = PRESETS["codex"]["chat_args"]
    assert codex[codex.index("--sandbox") + 1] == "read-only"


def test_chat_env_does_not_keep_parent_opencode_session() -> None:
    env = prepare_chat_env(
        {"id": "opencode"},
        {
            "OPENCODE_SESSION_ID": "ses_parent",
            "OPENCODE_TERMINAL": "1",
            "PWD": "C:/other",
            "PATH": "C:/bin",
        },
        "C:/work/Game",
        ["C:/work/shared"],
    )
    assert "C:/work/shared" in env["OPENCODE_CONFIG_CONTENT"]
    assert "OPENCODE_SESSION_ID" not in env
    assert "OPENCODE_TERMINAL" not in env
    assert env["PWD"] == "C:/work/Game"
    assert env["PATH"] == "C:/bin"
    assert "OPENCODE_CONFIG_CONTENT" in env


def test_claude_gets_restricted_mode_only_on_new_versions() -> None:
    base = ["-p", "{prompt}", "--permission-mode", "plan"]
    assert "--restricted" in harden_chat_args(
        {"id": "claude", "version": "2.1.300 (Claude Code)"}, base
    )
    assert "--add-dir" in harden_chat_args(
        {"id": "claude", "version": "2.1.300 (Claude Code)"}, base, ["C:/shared"]
    )
    assert "--include-directories" in harden_chat_args(
        {"id": "gemini", "version": "1.0.0"}, ["-p", "{prompt}"], ["C:/shared"]
    )
    assert "--restricted" not in harden_chat_args(
        {"id": "claude", "version": "2.1.200 (Claude Code)"}, base
    )
    assert harden_chat_args({"id": "codex", "version": "1.0.0"}, base) == base


def test_egress_summarizes_read_files_and_attachments() -> None:
    chat = {
        "messages": [
            {
                "role": "user",
                "content": "посмотри",
                "attachments": [{"size": 7}],
            }
        ]
    }
    egress = _build_egress(
        chat,
        {"id": "opencode", "name": "OpenCode", "kind": "cli"},
        [
            {
                "tool": "read",
                "detail": "C:/work/Game/README.md",
                "output": "hello",
            }
        ],
    )
    assert egress["remote"] is True
    assert egress["files"] == [{"path": "C:/work/Game/README.md", "bytes": 5}]
    assert egress["attachments"] == 1
    assert egress["attachment_bytes"] == 7
    local = _build_egress(
        chat,
        {"id": "local", "name": "Local", "kind": "api", "local_api": True},
        [],
    )
    assert local["remote"] is False


def test_activity_marks_external_sensitive_and_network_steps() -> None:
    rows = [
        {
            "type": "tool_use",
            "timestamp": 1,
            "part": {
                "partID": "inside",
                "tool": "read",
                "state": {
                    "status": "completed",
                    "input": {"path": "C:/work/Game/README.md"},
                    "output": "ok",
                },
            },
        },
        {
            "type": "tool_use",
            "timestamp": 2,
            "part": {
                "partID": "outside",
                "tool": "read",
                "state": {
                    "status": "error",
                    "input": {"path": "C:/Windows/win.ini"},
                    "error": "cannot ask",
                },
            },
        },
        {
            "type": "tool_use",
            "timestamp": 3,
            "part": {
                "partID": "secret",
                "tool": "read",
                "state": {
                    "status": "completed",
                    "input": {"path": "C:/work/Game/.env"},
                    "output": "TOKEN=1",
                },
            },
        },
        {
            "type": "tool_use",
            "timestamp": 4,
            "part": {
                "partID": "network",
                "tool": "bash",
                "state": {
                    "status": "completed",
                    "input": {"command": "curl https://example.test"},
                    "output": "",
                },
            },
        },
    ]
    raw = "\n".join(json.dumps(row) for row in rows)
    items = extract_activity(
        raw,
        {"id": "opencode", "output_mode": "jsonl-auto"},
        final=True,
        project_root="C:/work/Game",
    )
    by_id = {item["id"]: item for item in items}
    assert "flags" not in by_id["inside"]
    assert by_id["outside"]["flags"] == ["external"]
    assert by_id["outside"]["status"] == "error"
    assert by_id["outside"]["output"] == "cannot ask"
    assert by_id["secret"]["flags"] == ["sensitive"]
    assert by_id["network"]["flags"] == ["network"]


def test_egress_guard_allowlist() -> None:
    hosts = egress_hosts({"id": "opencode", "kind": "cli"})
    assert "opencode.ai" in hosts
    guard = EgressGuard(hosts)
    try:
        assert guard.allowed("opencode.ai")
        assert guard.allowed("api.opencode.ai")
        assert not guard.allowed("evil-opencode.ai")
        guard.record("opencode.ai", 443, True)
        guard.record("example.com", 443, False)
        summary = guard.summary()
        assert any(item["host"] == "opencode.ai" and item["allowed"] for item in summary)
        assert any(item["host"] == "example.com" and not item["allowed"] for item in summary)
    finally:
        guard.stop()


def test_app_guide_covers_user_facing_sections() -> None:
    for token in ("Обзор", "Проекты", "Задачи", "Чат", "Review", "Агенты", "Doctor", "Редактор", "Быстрый старт"):
        assert token in KOVA_APP_GUIDE
