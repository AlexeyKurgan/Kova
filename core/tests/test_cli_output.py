from kova_core.agents.cli_output import parse_output


def test_codex_jsonl_extracts_session_text_and_usage() -> None:
    raw = "\n".join(
        [
            '{"type":"thread.started","thread_id":"thr_123"}',
            '{"type":"turn.started"}',
            '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"Done."}}',
            '{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"pytest -q","exit_code":0}}',
            '{"type":"item.completed","item":{"id":"item_2","type":"file_change","changes":[{"path":"src/game.py","kind":"update"}]}}',
            '{"type":"turn.completed","usage":{"input_tokens":12,"output_tokens":7}}',
        ]
    )
    parsed = parse_output(raw, {"output_mode": "codex-jsonl"})
    assert parsed["session_id"] == "thr_123"
    assert parsed["display"] == "Done."
    assert parsed["usage"] == {"input_tokens": 12, "output_tokens": 7}
    assert parsed["actions"][0] == {
        "kind": "command",
        "value": "pytest -q",
        "exit_code": 0,
    }
    assert parsed["actions"][1]["value"] == "src/game.py"


def test_claude_json_extracts_result() -> None:
    raw = '{"session_id":"ses_abc","result":"Finished work","usage":{"input_tokens":5}}'
    parsed = parse_output(raw, {"output_mode": "claude-json"})
    assert parsed["session_id"] == "ses_abc"
    assert parsed["display"] == "Finished work"
    assert parsed["usage"] == {"input_tokens": 5}


def test_regex_fallback_without_json() -> None:
    raw = "sessionID: ses_xyz\nwork done"
    parsed = parse_output(
        raw,
        {"output_mode": "auto", "session_regex": r"sessionID:\s*(\S+)"},
    )
    assert parsed["session_id"] == "ses_xyz"
    assert parsed["display"] == raw
