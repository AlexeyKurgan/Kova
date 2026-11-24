import json
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
    for _ in range(100):
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
    for _ in range(100):
        time.sleep(0.2)
        final = client.get(f"/ai/runs/{run['id']}").json()
        if final["status"] not in {"queued", "running"}:
            break
    assert final is not None
    assert final["status"] == "succeeded", final
    assert "demo-model" in final["output"]
    assert "focus on hitboxes" in final["output"]
