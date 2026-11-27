from pathlib import Path

from kova_core.agents import runner, usage


def test_usage_provider_breakdown(tmp_path: Path, monkeypatch) -> None:
    rows = [
        {"status": "succeeded", "provider_id": "claude", "provider_name": "Claude", "usage": {"total_tokens": 700}},
        {"status": "failed", "provider_id": "claude", "provider_name": "Claude", "usage": {"input_tokens": 100, "output_tokens": 50}},
        {"status": "succeeded", "provider_id": "codex", "provider_name": "Codex", "usage": None},
        {"status": "running", "provider_id": "gemini", "provider_name": "Gemini", "usage": {"total_tokens": 999}},
    ]
    monkeypatch.setattr(runner, "list_runs_raw", lambda hub: rows)
    summary = usage.usage_summary(tmp_path, budget=1000)
    assert summary["used"] == 850
    assert summary["unknown_runs"] == 1
    assert summary["remaining"] == 150
    providers = {row["id"]: row for row in summary["providers"]}
    assert providers["claude"]["used"] == 850
    assert providers["claude"]["known_runs"] == 2
    assert providers["codex"]["unknown_runs"] == 1
    assert "gemini" not in providers
