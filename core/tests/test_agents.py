import json
import subprocess
import sys
import time
from pathlib import Path

from fastapi.testclient import TestClient

from kova_core.api.server import create_app


def make_client(tmp_path: Path, monkeypatch) -> TestClient:
    monkeypatch.setenv("KOVA_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.delenv("KOVA_CORE_TOKEN", raising=False)
    return TestClient(create_app())


def test_provider_config_and_run(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    listed = client.get("/providers")
    assert listed.status_code == 200
    assert {row["id"] for row in listed.json()["providers"]} >= {"claude", "codex", "gemini", "opencode"}

    created = client.post(
        "/providers",
        json={
            "name": "Echo",
            "command": sys.executable,
            "args": ["-c", "print('AI OK')"],
            "set_default": True,
        },
    )
    assert created.status_code == 201
    provider = created.json()
    assert provider["installed"] is True
    assert provider["default"] is True

    updated = client.patch(
        f"/providers/{provider['id']}",
        json={"enabled": True, "args": ["-c", "print('AI OK')"]},
    )
    assert updated.status_code == 200
    assert client.post(f"/providers/{provider['id']}/check").status_code == 200

    game = tmp_path / "game"
    game.mkdir()
    client.post("/project/open", json={"path": str(game), "engine": "roblox"})
    task = client.post("/tasks", json={"title": "Echo task"}).json()
    started = client.post(
        "/ai/runs",
        json={"task_id": task["id"], "provider": provider["id"], "snapshot": False},
    )
    assert started.status_code == 201
    run = started.json()
    assert run["status"] in {"queued", "running"}
    assert run["session_id"].startswith("ses_")

    final = None
    for _ in range(300):
        time.sleep(0.2)
        response = client.get(f"/ai/runs/{run['id']}")
        assert response.status_code == 200
        final = response.json()
        if final["status"] not in {"queued", "running"}:
            break
    assert final is not None
    assert final["status"] == "succeeded", final
    assert "AI OK" in final["output"]
    assert final["artifact_path"]
    assert (game / ".hub" / final["artifact_path"]).is_file()

    session_file = game / ".hub" / "agents" / "sessions" / f"{final['session_id']}.json"
    assert session_file.is_file()
    session = json.loads(session_file.read_text(encoding="utf-8"))
    assert session["status"] == "completed"
    assert run["id"] in session["run_ids"]

    refreshed = client.get("/tasks").json()
    assert refreshed[0]["status"] == "review"
    reviews = client.get("/review").json()
    assert any(item["task_id"] == task["id"] for item in reviews)
    assert client.get(f"/ai/runs?task_id={task['id']}").status_code == 200

    session_rows = client.get(f"/ai/sessions?task_id={task['id']}").json()
    assert len(session_rows) == 1
    assert session_rows[0]["status"] == "completed"
    assert session_rows[0]["runs"][0]["id"] == run["id"]


def test_provider_validation(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    duplicate = client.post(
        "/providers",
        json={"name": "Codex", "command": "codex"},
    )
    assert duplicate.status_code == 409
    missing = client.patch("/providers/nope", json={"enabled": False})
    assert missing.status_code == 404
    bad = client.post(
        "/providers",
        json={"name": "Broken", "command": str(tmp_path / "missing.exe")},
    )
    assert bad.status_code == 201
    assert bad.json()["installed"] is False
    assert client.delete(f"/providers/{bad.json()['id']}").status_code == 204
    assert client.delete("/providers/codex").status_code == 400


def test_run_recovery_marks_interrupted(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    client.post("/project/open", json={"path": str(game)})
    task = client.post("/tasks", json={"title": "Stale task"}).json()

    hub = game / ".hub"
    runs = hub / "agents" / "runs"
    sessions = hub / "agents" / "sessions"
    runs.mkdir(parents=True, exist_ok=True)
    sessions.mkdir(parents=True, exist_ok=True)

    run_id = "run_stale"
    session_id = "ses_stale"
    session = {
        "id": session_id,
        "task_id": task["id"],
        "task_title": task["title"],
        "provider_id": "echo",
        "provider_name": "Echo",
        "status": "active",
        "created_at": "2026-01-01T00:00:00+00:00",
        "updated_at": "2026-01-01T00:00:00+00:00",
        "finished_at": "",
        "snapshot_before": "",
        "run_ids": [run_id],
    }
    (sessions / f"{session_id}.json").write_text(json.dumps(session), encoding="utf-8")
    run = {
        "id": run_id,
        "task_id": task["id"],
        "task_title": task["title"],
        "session_id": session_id,
        "provider_id": "echo",
        "provider_name": "Echo",
        "status": "running",
        "created_at": "2026-01-01T00:00:00+00:00",
        "started_at": "2026-01-01T00:00:01+00:00",
        "finished_at": "",
        "exit_code": None,
        "output": "",
        "error": "",
        "log_path": "",
        "artifact_path": "",
        "review_id": "",
        "snapshot_id": "",
        "snapshot_error": "",
        "command": "echo",
        "args": [],
        "cancel_requested": False,
        "pid": None,
        "interrupted_reason": "",
    }
    (runs / f"{run_id}.json").write_text(json.dumps(run), encoding="utf-8")

    listed = client.get("/ai/runs?limit=5")
    assert listed.status_code == 200
    stored = next(row for row in listed.json() if row["id"] == run_id)
    assert stored["status"] == "interrupted"
    assert "перезапущен" in stored["interrupted_reason"]

    recovered = json.loads((sessions / f"{session_id}.json").read_text(encoding="utf-8"))
    assert recovered["status"] == "interrupted"
    events = client.get("/ledger?limit=50").json()
    assert any(row["type"] == "agent.run.interrupted" for row in events)


def test_cancel_stale_run(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    client.post("/project/open", json={"path": str(game)})
    task = client.post("/tasks", json={"title": "Cancel task"}).json()
    runs = game / ".hub" / "agents" / "runs"
    runs.mkdir(parents=True, exist_ok=True)
    run_id = "run_cancel_stale"
    payload = {
        "id": run_id,
        "task_id": task["id"],
        "task_title": task["title"],
        "session_id": "",
        "provider_id": "echo",
        "provider_name": "Echo",
        "status": "queued",
        "created_at": "2026-01-01T00:00:00+00:00",
        "started_at": "",
        "finished_at": "",
        "exit_code": None,
        "output": "",
        "error": "",
        "log_path": "",
        "artifact_path": "",
        "review_id": "",
        "snapshot_id": "",
        "snapshot_error": "",
        "command": "echo",
        "args": [],
        "cancel_requested": False,
        "pid": None,
        "interrupted_reason": "",
    }
    (runs / f"{run_id}.json").write_text(json.dumps(payload), encoding="utf-8")

    response = client.post(f"/ai/runs/{run_id}/cancel")
    assert response.status_code == 200
    assert response.json()["status"] == "interrupted"


def test_run_message_and_model(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    client.post("/project/open", json={"path": str(game)})
    task = client.post("/tasks", json={"title": "Model task"}).json()
    provider = client.post(
        "/providers",
        json={
            "name": "Echo Model",
            "command": sys.executable,
            "args": [
                "-c",
                "import sys; print(sys.argv[1] + '|' + sys.argv[2])",
                "{model}",
                "{prompt}",
            ],
            "models": ["demo-model"],
        },
    ).json()

    missing_model = client.post(
        "/ai/runs",
        json={"task_id": task["id"], "provider": provider["id"], "snapshot": False},
    )
    assert missing_model.status_code == 400
    assert "модель" in missing_model.json()["detail"]

    started = client.post(
        "/ai/runs",
        json={
            "task_id": task["id"],
            "provider": provider["id"],
            "snapshot": False,
            "model": "demo-model",
            "message": "focus on hitboxes",
        },
    )
    assert started.status_code == 201
    run = started.json()
    assert run["model"] == "demo-model"
    final = None
    for _ in range(300):
        time.sleep(0.2)
        final = client.get(f"/ai/runs/{run['id']}").json()
        if final["status"] not in {"queued", "running"}:
            break
    assert final is not None
    assert final["status"] == "succeeded", final
    assert "demo-model" in final["output"]
    assert "focus on hitboxes" in final["output"]


def test_detect_capability_flags() -> None:
    from kova_core.agents.capabilities import detect_flags

    detected = detect_flags(
        "Usage: fake [--model MODEL] [--resume] [--output-format json] [--sandbox]"
    )
    assert detected["supports_model"] is True
    assert detected["supports_resume"] is True
    assert detected["supports_json"] is True
    assert detected["supports_permissions"] is True
    assert detected["supports_non_interactive"] is False


def test_provider_check_probes_help(tmp_path: Path, monkeypatch) -> None:
    import os

    import pytest

    if os.name != "nt":
        pytest.skip("Windows command wrapper")

    client = make_client(tmp_path, monkeypatch)
    script = tmp_path / "fake-cli.cmd"
    script.write_text(
        "\n".join(
            [
                "@echo off",
                "echo Usage: fake [--model MODEL] [--resume] [--output-format json] [--sandbox]",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    provider = client.post(
        "/providers",
        json={"name": "Fake Probe", "command": str(script)},
    ).json()
    assert provider["capabilities"]["checked"] is False

    checked = client.post(f"/providers/{provider['id']}/check")
    assert checked.status_code == 200
    capabilities = checked.json()["capabilities"]
    assert capabilities["checked"] is True
    assert capabilities["supports_model"] is True
    assert capabilities["supports_resume"] is True
    assert capabilities["supports_json"] is True
    assert capabilities["supports_permissions"] is True


def test_handoff_between_sessions(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    client.post("/project/open", json={"path": str(game)})
    task = client.post("/tasks", json={"title": "Handoff task"}).json()
    provider = client.post(
        "/providers",
        json={
            "name": "Echo Prompt",
            "command": sys.executable,
            "args": ["-c", "import sys; print(sys.argv[1])", "{prompt}"],
        },
    ).json()

    def run(message: str, handoff: str | None = None) -> dict:
        response = client.post(
            "/ai/runs",
            json={
                "task_id": task["id"],
                "provider": provider["id"],
                "snapshot": False,
                "message": message,
                "handoff_from_session": handoff,
            },
        )
        assert response.status_code == 201, response.text
        run_id = response.json()["id"]
        final = None
        for _ in range(300):
            time.sleep(0.2)
            final = client.get(f"/ai/runs/{run_id}").json()
            if final["status"] not in {"queued", "running"}:
                break
        assert final is not None
        assert final["status"] == "succeeded", final
        return final

    first = run("first step")
    sessions = client.get(f"/ai/sessions?task_id={task['id']}").json()
    assert len(sessions) == 1
    first_session = sessions[0]
    assert first_session["status"] == "completed"

    preview = client.post(
        "/ai/handoffs/preview",
        json={
            "task_id": task["id"],
            "from_session_id": first_session["id"],
            "to_provider": provider["id"],
        },
    )
    assert preview.status_code == 200, preview.text
    assert "Передача работы" in preview.json()["text"]
    assert not (game / ".hub" / "agents" / "handoffs").exists() or not list(
        (game / ".hub" / "agents" / "handoffs").glob("*.json")
    )

    second = run("continue from here", first_session["id"])
    assert second["handoff_id"].startswith("hnd_")
    assert second["session_id"] != first_session["id"]
    assert "Передача работы" in second["output"]

    sessions = client.get(f"/ai/sessions?task_id={task['id']}").json()
    assert len(sessions) == 2
    handed = next(row for row in sessions if row["id"] == second["session_id"])
    assert handed["handoff_id"] == second["handoff_id"]
    handoff_file = game / ".hub" / "agents" / "handoffs" / f"{second['handoff_id']}.json"
    assert handoff_file.is_file()


def test_run_records_file_changes(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    client.post("/project/open", json={"path": str(game)})
    task = client.post("/tasks", json={"title": "Changes task"}).json()
    provider = client.post(
        "/providers",
        json={
            "name": "Writer",
            "command": sys.executable,
            "args": [
                "-c",
                "from pathlib import Path; Path('agent.txt').write_text('made by agent')",
            ],
        },
    ).json()
    started = client.post(
        "/ai/runs",
        json={
            "task_id": task["id"],
            "provider": provider["id"],
            "snapshot": True,
        },
    ).json()
    final = None
    for _ in range(300):
        time.sleep(0.2)
        final = client.get(f"/ai/runs/{started['id']}").json()
        if final["status"] not in {"queued", "running"}:
            break
    assert final is not None
    assert final["status"] == "succeeded", final
    changes = {item["path"]: item["status"] for item in final["changes"]}
    assert changes.get("agent.txt") == "added"
    assert final["changes_total"] >= 1
    added = next(item for item in final["changes"] if item["path"] == "agent.txt")
    assert added["patch_path"]
    patch = client.get(f"/ai/runs/{final['id']}/changes/0")
    assert patch.status_code == 200
    assert "made by agent" in patch.text


def test_run_streams_output(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    client.post("/project/open", json={"path": str(game)})
    task = client.post("/tasks", json={"title": "Stream task"}).json()
    provider = client.post(
        "/providers",
        json={
            "name": "Streamer",
            "command": sys.executable,
            "args": [
                "-c",
                "import time; print('one', flush=True); time.sleep(1.2); print('two', flush=True)",
            ],
        },
    ).json()
    started = client.post(
        "/ai/runs",
        json={"task_id": task["id"], "provider": provider["id"], "snapshot": False},
    ).json()

    time.sleep(0.7)
    partial = client.get(f"/ai/runs/{started['id']}").json()
    assert "one" in partial["output"]
    assert "two" not in partial["output"]

    final = None
    for _ in range(300):
        time.sleep(0.2)
        final = client.get(f"/ai/runs/{started['id']}").json()
        if final["status"] not in {"queued", "running"}:
            break
    assert final is not None
    assert final["status"] == "succeeded"
    assert "one" in final["output"]
    assert "two" in final["output"]


def test_shutdown_interrupts_active_runs(tmp_path: Path, monkeypatch) -> None:
    from kova_core.agents.runner import shutdown_runs

    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    client.post("/project/open", json={"path": str(game)})
    task = client.post("/tasks", json={"title": "Shutdown task"}).json()
    provider = client.post(
        "/providers",
        json={
            "name": "Sleeper",
            "command": sys.executable,
            "args": ["-c", "import time; time.sleep(5); print('done')"],
        },
    ).json()
    started = client.post(
        "/ai/runs",
        json={"task_id": task["id"], "provider": provider["id"], "snapshot": False},
    ).json()
    time.sleep(0.3)

    shutdown_runs()
    shutdown_runs()

    final = client.get(f"/ai/runs/{started['id']}").json()
    assert final["status"] == "interrupted"
    assert "остановлен" in final["interrupted_reason"]


def test_parallel_runs_are_queued(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    client.post("/project/open", json={"path": str(game)})
    updated = client.patch("/project", json={"max_parallel_runs": 1})
    assert updated.status_code == 200
    assert updated.json()["project"]["max_parallel_runs"] == 1

    task = client.post("/tasks", json={"title": "Queue task"}).json()
    other = client.post("/tasks", json={"title": "Queue task two"}).json()
    provider = client.post(
        "/providers",
        json={
            "name": "Queue runner",
            "command": sys.executable,
            "args": ["-c", "import time; time.sleep(1.5); print('done')"],
        },
    ).json()

    first = client.post(
        "/ai/runs",
        json={"task_id": task["id"], "provider": provider["id"], "snapshot": False},
    ).json()
    for _ in range(50):
        time.sleep(0.1)
        if client.get(f"/ai/runs/{first['id']}").json()["status"] == "running":
            break

    second = client.post(
        "/ai/runs",
        json={"task_id": other["id"], "provider": provider["id"], "snapshot": False},
    ).json()
    assert second["status"] == "queued"
    assert second["queue_position"] >= 1

    for _ in range(300):
        time.sleep(0.2)
        a = client.get(f"/ai/runs/{first['id']}").json()
        b = client.get(f"/ai/runs/{second['id']}").json()
        if a["status"] not in {"queued", "running"} and b["status"] not in {
            "queued",
            "running",
        }:
            break
    assert a["status"] == "succeeded"
    assert b["status"] == "succeeded"
    assert b["queue_position"] == 0


def _git(root: Path, *args: str) -> None:
    subprocess.run(
        ["git", *args],
        cwd=str(root),
        check=True,
        capture_output=True,
        text=True,
    )


def test_worktree_isolation_and_apply(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    _git(game, "init")
    (game / "readme.txt").write_text("base" + chr(10), encoding="utf-8")
    _git(game, "add", "readme.txt")
    _git(
        game,
        "-c",
        "user.email=test@example.com",
        "-c",
        "user.name=Test",
        "commit",
        "-m",
        "init",
    )

    opened = client.post("/project/open", json={"path": str(game)})
    assert opened.status_code == 200
    assert opened.json()["git_repo"] is True
    patched = client.patch(
        "/project",
        json={"isolation": "worktree", "max_parallel_runs": 1},
    )
    assert patched.status_code == 200
    assert patched.json()["project"]["isolation"] == "worktree"

    task = client.post("/tasks", json={"title": "Worktree task"}).json()
    provider = client.post(
        "/providers",
        json={
            "name": "Writer",
            "command": sys.executable,
            "args": [
                "-c",
                "from pathlib import Path; Path('created.txt').write_text('from worktree')",
            ],
        },
    ).json()
    started = client.post(
        "/ai/runs",
        json={"task_id": task["id"], "provider": provider["id"]},
    )
    assert started.status_code == 201, started.text
    run = started.json()
    assert run["isolation"] == "worktree"
    assert run["worktree_path"]

    final = run
    for _ in range(300):
        time.sleep(0.2)
        final = client.get(f"/ai/runs/{run['id']}").json()
        if final["status"] not in {"queued", "running"}:
            break
    assert final["status"] == "succeeded"
    assert any(change["path"] == "created.txt" for change in final["changes"])
    assert not (game / "created.txt").exists()

    applied = client.post(f"/ai/runs/{run['id']}/apply-worktree")
    assert applied.status_code == 200, applied.text
    body = applied.json()
    assert body["worktree_applied"] == 1
    assert body["worktree_applied_at"]
    assert (game / "created.txt").read_text(encoding="utf-8") == "from worktree"
    assert not Path(run["worktree_path"]).exists()

    again = client.post(f"/ai/runs/{run['id']}/apply-worktree")
    assert again.status_code == 400


def test_read_only_uses_provider_args(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    client.post("/project/open", json={"path": str(game)})
    provider = client.post(
        "/providers",
        json={
            "name": "Two modes",
            "command": sys.executable,
            "args": [
                "-c",
                "from pathlib import Path; Path('normal.txt').write_text('x')",
            ],
            "read_only_args": [
                "-c",
                "from pathlib import Path; Path('readonly.txt').write_text('x')",
            ],
        },
    ).json()
    assert provider["read_only_args"]

    task = client.post("/tasks", json={"title": "Read only task"}).json()
    started = client.post(
        "/ai/runs",
        json={
            "task_id": task["id"],
            "provider": provider["id"],
            "snapshot": False,
            "read_only": True,
        },
    )
    assert started.status_code == 201, started.text
    run = started.json()
    assert run["read_only"] is True
    for _ in range(300):
        time.sleep(0.2)
        final = client.get(f"/ai/runs/{run['id']}").json()
        if final["status"] not in {"queued", "running"}:
            break
    assert final["status"] == "succeeded"
    assert (game / "readonly.txt").is_file()
    assert not (game / "normal.txt").exists()


def test_read_only_requires_args(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    client.post("/project/open", json={"path": str(game)})
    provider = client.post(
        "/providers",
        json={"name": "No readonly", "command": sys.executable, "args": ["-c", "print(1)"]},
    ).json()
    task = client.post("/tasks", json={"title": "No readonly task"}).json()
    response = client.post(
        "/ai/runs",
        json={
            "task_id": task["id"],
            "provider": provider["id"],
            "snapshot": False,
            "read_only": True,
        },
    )
    assert response.status_code == 400
    assert "только чтение" in response.json()["detail"]


def test_cli_resume_uses_session_id(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    client.post("/project/open", json={"path": str(game)})
    provider = client.post(
        "/providers",
        json={
            "name": "Resume CLI",
            "command": sys.executable,
            "args": [
                "-c",
                "import json; print(json.dumps({'session_id': 'cli-abc', 'result': 'first result'}))",
            ],
            "resume_args": [
                "-c",
                "import sys, pathlib; pathlib.Path('resumed.txt').write_text(sys.argv[1]); print('resumed')",
                "{prompt}",
            ],
        },
    ).json()
    assert provider["resume_args"]
    task = client.post("/tasks", json={"title": "Resume task"}).json()
    started = client.post(
        "/ai/runs",
        json={"task_id": task["id"], "provider": provider["id"], "snapshot": False},
    ).json()

    first = None
    for _ in range(300):
        time.sleep(0.2)
        first = client.get(f"/ai/runs/{started['id']}").json()
        if first["status"] not in {"queued", "running"}:
            break
    assert first["status"] == "succeeded"
    assert first["cli_session_id"] == "cli-abc"
    assert first["output"].strip() == "first result"

    session = client.get(f"/ai/sessions/{first['session_id']}").json()
    assert session["cli_session_id"] == "cli-abc"

    resumed = client.post(
        f"/ai/sessions/{first['session_id']}/resume",
        json={"message": "next step", "snapshot": False},
    )
    assert resumed.status_code == 201, resumed.text
    second = resumed.json()
    assert second["resumed"] is True
    assert second["resumed_from_session"] == first["session_id"]
    assert second["session_id"] == first["session_id"]

    for _ in range(300):
        time.sleep(0.2)
        second = client.get(f"/ai/runs/{second['id']}").json()
        if second["status"] not in {"queued", "running"}:
            break
    assert second["status"] == "succeeded"
    assert second["cli_session_id"] == "cli-abc"
    assert (game / "resumed.txt").read_text(encoding="utf-8").startswith("next step")
    after = client.get(f"/ai/sessions/{first['session_id']}").json()
    assert after["run_ids"] == [first["id"], second["id"]]


def test_resume_requires_cli_session(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    client.post("/project/open", json={"path": str(game)})
    provider = client.post(
        "/providers",
        json={
            "name": "No session CLI",
            "command": sys.executable,
            "args": ["-c", "print('no id here')"],
            "resume_args": ["-c", "print('x')", "{prompt}"],
        },
    ).json()
    task = client.post("/tasks", json={"title": "No session task"}).json()
    started = client.post(
        "/ai/runs",
        json={"task_id": task["id"], "provider": provider["id"], "snapshot": False},
    ).json()
    for _ in range(300):
        time.sleep(0.2)
        run = client.get(f"/ai/runs/{started['id']}").json()
        if run["status"] not in {"queued", "running"}:
            break
    assert run["status"] == "succeeded"
    response = client.post(
        f"/ai/sessions/{run['session_id']}/resume",
        json={"message": "again", "snapshot": False},
    )
    assert response.status_code == 400
    assert "идентификатор" in response.json()["detail"]


def test_linear_workflow_stops_between_steps(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    client.post("/project/open", json={"path": str(game)})
    task = client.post("/tasks", json={"title": "Flow task"}).json()
    first = client.post(
        f"/tasks/{task['id']}/workflow",
        json={"title": "Plan", "prompt": "make a plan"},
    ).json()
    second = client.post(
        f"/tasks/{task['id']}/workflow",
        json={"title": "Build", "prompt": "build it"},
    ).json()
    assert [step["title"] for step in second["workflow"]] == ["Plan", "Build"]
    step = first["workflow"][0]

    provider = client.post(
        "/providers",
        json={"name": "Flow runner", "command": sys.executable, "args": ["-c", "print('step done')"]},
    ).json()
    started = client.post(
        "/ai/runs",
        json={
            "task_id": task["id"],
            "provider": provider["id"],
            "snapshot": False,
            "workflow_step_id": step["id"],
        },
    )
    assert started.status_code == 201, started.text
    run = started.json()
    assert run["workflow_step_id"] == step["id"]
    for _ in range(300):
        time.sleep(0.2)
        run = client.get(f"/ai/runs/{run['id']}").json()
        if run["status"] not in {"queued", "running"}:
            break
    assert run["status"] == "succeeded"

    updated = next(
        item for item in client.get("/tasks").json() if item["id"] == task["id"]
    )
    assert updated["workflow"][0]["status"] == "done"
    assert updated["workflow"][0]["run_id"] == run["id"]
    assert updated["workflow"][1]["status"] == "pending"

    skipped = client.patch(
        f"/tasks/{task['id']}/workflow/{updated['workflow'][1]['id']}",
        json={"status": "skipped"},
    ).json()
    assert skipped["workflow"][1]["status"] == "skipped"


def test_routing_rules_and_roles(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    client.post("/project/open", json={"path": str(game)})
    provider = client.post(
        "/providers",
        json={
            "name": "Role runner",
            "command": sys.executable,
            "args": [
                "-c",
                "import sys, pathlib; pathlib.Path('role.txt').write_text(sys.argv[1])",
                "{prompt}",
            ],
        },
    ).json()
    saved = client.put(
        "/ai/routing",
        json={
            "rules": [{"tag": "backend", "provider_id": provider["id"]}],
            "roles": [
                {
                    "name": "Reviewer",
                    "prompt": "Be strict and list risks.",
                    "provider_id": provider["id"],
                }
            ],
        },
    )
    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert body["rules"][0]["tag"] == "backend"
    role_id = body["roles"][0]["id"]
    assert role_id.startswith("role_")

    task = client.post(
        "/tasks",
        json={"title": "Routed task", "tags": ["backend"]},
    ).json()
    recommendation = client.get(f"/ai/routing/recommend?task_id={task['id']}").json()
    assert recommendation["provider_id"] == provider["id"]
    assert "backend" in recommendation["reason"]

    started = client.post(
        "/ai/runs",
        json={
            "task_id": task["id"],
            "provider": provider["id"],
            "snapshot": False,
            "role_id": role_id,
        },
    ).json()
    assert started["role_id"] == role_id
    assert started["role_name"] == "Reviewer"
    for _ in range(300):
        time.sleep(0.2)
        run = client.get(f"/ai/runs/{started['id']}").json()
        if run["status"] not in {"queued", "running"}:
            break
    assert run["status"] == "succeeded"
    prompt = (game / "role.txt").read_text(encoding="utf-8")
    assert "## Роль" in prompt
    assert "Be strict and list risks." in prompt


def test_worktree_apply_detects_conflicts(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    _git(game, "init")
    (game / "readme.txt").write_text("base" + chr(10), encoding="utf-8")
    _git(game, "add", "readme.txt")
    _git(
        game,
        "-c",
        "user.email=test@example.com",
        "-c",
        "user.name=Test",
        "commit",
        "-m",
        "init",
    )
    client.post("/project/open", json={"path": str(game)})
    client.patch("/project", json={"isolation": "worktree"})
    task = client.post("/tasks", json={"title": "Conflict task"}).json()
    provider = client.post(
        "/providers",
        json={
            "name": "Writer",
            "command": sys.executable,
            "args": [
                "-c",
                "from pathlib import Path; Path('readme.txt').write_text('from worktree')",
            ],
        },
    ).json()
    run = client.post(
        "/ai/runs",
        json={"task_id": task["id"], "provider": provider["id"]},
    ).json()
    final = run
    for _ in range(300):
        time.sleep(0.2)
        final = client.get(f"/ai/runs/{run['id']}").json()
        if final["status"] not in {"queued", "running"}:
            break
    assert final["status"] == "succeeded"
    (game / "readme.txt").write_text("user change" + chr(10), encoding="utf-8")

    applied = client.post(f"/ai/runs/{run['id']}/apply-worktree")
    assert applied.status_code == 400, applied.text
    assert "конфликт" in applied.json()["detail"].lower()
    assert (game / "readme.txt").read_text(encoding="utf-8") == "user change" + chr(10)
    assert Path(run["worktree_path"]).is_dir()


def test_sandbox_copy_apply(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    (game / "readme.txt").write_text("base", encoding="utf-8")
    client.post("/project/open", json={"path": str(game)})
    patched = client.patch("/project", json={"isolation": "sandbox"})
    assert patched.status_code == 200
    assert patched.json()["project"]["isolation"] == "sandbox"

    task = client.post("/tasks", json={"title": "Sandbox task"}).json()
    provider = client.post(
        "/providers",
        json={
            "name": "Writer",
            "command": sys.executable,
            "args": [
                "-c",
                "from pathlib import Path; Path('created.txt').write_text('from sandbox')",
            ],
        },
    ).json()
    run = client.post(
        "/ai/runs",
        json={"task_id": task["id"], "provider": provider["id"]},
    ).json()
    assert run["isolation"] == "sandbox"
    assert run["worktree_path"]
    final = run
    for _ in range(300):
        time.sleep(0.2)
        final = client.get(f"/ai/runs/{run['id']}").json()
        if final["status"] not in {"queued", "running"}:
            break
    assert final["status"] == "succeeded"
    assert not (game / "created.txt").exists()

    applied = client.post(f"/ai/runs/{run['id']}/apply-worktree")
    assert applied.status_code == 200, applied.text
    assert (game / "created.txt").read_text(encoding="utf-8") == "from sandbox"
    assert not Path(run["worktree_path"]).exists()
