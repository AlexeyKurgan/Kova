import json
from pathlib import Path

from kova_core.agents.retention import cleanup


def test_cleanup_keeps_latest(tmp_path: Path) -> None:
    hub = tmp_path / ".hub"
    runs = hub / "agents" / "runs"
    sessions = hub / "agents" / "sessions"
    logs = hub / "artifacts" / "logs"
    runs.mkdir(parents=True)
    sessions.mkdir(parents=True)
    logs.mkdir(parents=True)

    for index in range(3):
        run_id = f"run_{index}"
        log = logs / f"{run_id}.txt"
        log.write_text("log", encoding="utf-8")
        (runs / f"{run_id}.json").write_text(
            json.dumps(
                {
                    "id": run_id,
                    "task_id": "task_1",
                    "status": "succeeded",
                    "created_at": f"2026-01-0{index + 1}T00:00:00+00:00",
                    "log_path": f"artifacts/logs/{run_id}.txt",
                }
            ),
            encoding="utf-8",
        )
        diff = hub / "agents" / "diffs" / run_id
        diff.mkdir(parents=True)
        (diff / "0000.diff").write_text("diff", encoding="utf-8")
        (sessions / f"ses_{index}.json").write_text(
            json.dumps(
                {
                    "id": f"ses_{index}",
                    "task_id": "task_1",
                    "status": "completed",
                    "created_at": f"2026-01-0{index + 1}T00:00:00+00:00",
                }
            ),
            encoding="utf-8",
        )

    result = cleanup(hub, keep=2)
    assert result["runs_removed"] == 1
    assert result["sessions_removed"] == 1
    assert result["logs_removed"] == 1
    assert result["diffs_removed"] == 1
    assert not (runs / "run_0.json").exists()
    assert (runs / "run_1.json").is_file()
    assert (runs / "run_2.json").is_file()
    assert not (sessions / "ses_0.json").exists()
    assert (sessions / "ses_1.json").is_file()
    assert (sessions / "ses_2.json").is_file()
    assert not (logs / "run_0.txt").exists()
    assert not (hub / "agents" / "diffs" / "run_0").exists()
