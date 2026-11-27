import sys
from pathlib import Path

from fastapi.testclient import TestClient

from kova_core.api.server import create_app


def make_client(tmp_path: Path, monkeypatch) -> TestClient:
    monkeypatch.setenv("KOVA_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.delenv("KOVA_CORE_TOKEN", raising=False)
    return TestClient(create_app())


def test_task_validation_commands(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    client.post("/project/open", json={"path": str(game)})
    task = client.post("/tasks", json={"title": "Validation task"}).json()
    assert task["validation"] == []
    assert task["validation_mode"] == "ask"
    updated = client.patch(
        f"/tasks/{task['id']}",
        json={"validation_mode": "always"},
    )
    assert updated.status_code == 200
    assert updated.json()["validation_mode"] == "always"

    ok_command = f'"{sys.executable}" -c "print(\'VAL OK\')"'
    added = client.post(
        f"/tasks/{task['id']}/validation",
        json={"label": "Smoke", "command": ok_command, "timeout": 120},
    )
    assert added.status_code == 201
    command = added.json()["validation"][0]
    assert command["label"] == "Smoke"

    run = client.post(f"/tasks/{task['id']}/validation/run", json={})
    assert run.status_code == 200
    results = run.json()
    assert len(results) == 1
    assert results[0]["status"] == "passed"
    assert "VAL OK" in results[0]["output"]
    assert results[0]["exit_code"] == 0

    stored = client.get(f"/tasks/{task['id']}/validation/results")
    assert stored.status_code == 200
    assert len(stored.json()) == 1

    bad_command = f'"{sys.executable}" -c "import sys; sys.exit(3)"'
    added = client.post(
        f"/tasks/{task['id']}/validation",
        json={"label": "Fail", "command": bad_command, "timeout": 120},
    )
    fail_id = next(
        item["id"] for item in added.json()["validation"] if item["label"] == "Fail"
    )
    run = client.post(
        f"/tasks/{task['id']}/validation/run",
        json={"command_id": fail_id},
    )
    assert run.status_code == 200
    assert run.json()[0]["status"] == "failed"
    assert run.json()[0]["exit_code"] == 3

    deleted = client.delete(
        f"/tasks/{task['id']}/validation/{fail_id}",
    )
    assert deleted.status_code == 200
    assert all(item["id"] != fail_id for item in deleted.json()["validation"])


def test_validation_suggestions(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    (game / "package.json").write_text(
        '{"scripts": {"test": "vitest", "lint": "eslint ."}}',
        encoding="utf-8",
    )
    (game / "tsconfig.json").write_text("{}", encoding="utf-8")
    (game / "pyproject.toml").write_text(
        "\n".join(["[project]", "name = 'demo'"]) + "\n",
        encoding="utf-8",
    )
    (game / "Cargo.toml").write_text(
        "\n".join(["[package]", "name = 'demo'"]) + "\n",
        encoding="utf-8",
    )
    (game / "go.mod").write_text("module demo\n", encoding="utf-8")
    (game / "Makefile").write_text(
        "\n".join(["test:", "\techo ok"]) + "\n",
        encoding="utf-8",
    )
    client.post("/project/open", json={"path": str(game)})
    task = client.post("/tasks", json={"title": "Suggest"}).json()

    response = client.get(f"/tasks/{task['id']}/validation/suggestions")
    assert response.status_code == 200
    commands = {row["command"] for row in response.json()}
    assert {"npm test", "npm run lint", "npx tsc --noEmit"} <= commands
    assert "python -m pytest -q" in commands
    assert "cargo test" in commands
    assert "go test ./..." in commands
    assert "make test" in commands


def test_validation_attaches_latest_agent_run(tmp_path: Path, monkeypatch) -> None:
    import time

    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    client.post("/project/open", json={"path": str(game)})
    task = client.post("/tasks", json={"title": "Run link"}).json()
    provider = client.post(
        "/providers",
        json={
            "name": "Echo Validation",
            "command": sys.executable,
            "args": ["-c", "import sys; print(sys.argv[1])", "{prompt}"],
        },
    ).json()
    started = client.post(
        "/ai/runs",
        json={"task_id": task["id"], "provider": provider["id"], "snapshot": False},
    ).json()
    final = None
    for _ in range(300):
        time.sleep(0.2)
        final = client.get(f"/ai/runs/{started['id']}").json()
        if final["status"] not in {"queued", "running"}:
            break
    assert final is not None
    assert final["status"] == "succeeded", final

    client.post(
        f"/tasks/{task['id']}/validation",
        json={
            "label": "Smoke",
            "command": f'"{sys.executable}" -c "print(123)"',
            "timeout": 120,
        },
    )
    run = client.post(f"/tasks/{task['id']}/validation/run", json={})
    assert run.status_code == 200
    result = run.json()[0]
    assert result["agent_run_id"] == started["id"]
    assert result["agent_session_id"] == started["session_id"]

    invalid = client.post(
        f"/tasks/{task['id']}/validation/run",
        json={"run_id": "run_missing"},
    )
    assert invalid.status_code == 400


def test_validation_replay_environment(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    client.post("/project/open", json={"path": str(game)})
    task = client.post("/tasks", json={"title": "Replay task"}).json()
    command = (
        f'"{sys.executable}" -c "import pathlib,sys; '
        "sys.exit(0 if pathlib.Path('flag.txt').exists() else 1)\""
    )
    added = client.post(
        f"/tasks/{task['id']}/validation",
        json={"label": "Replay check", "command": command, "timeout": 120},
    ).json()
    command_id = added["validation"][0]["id"]
    first = client.post(
        f"/tasks/{task['id']}/validation/run",
        json={"command_id": command_id},
    ).json()[0]
    assert first["status"] == "failed"
    assert first["environment"]["python"]

    (game / "flag.txt").write_text("ok", encoding="utf-8")
    replay = client.post(f"/tasks/{task['id']}/validation/replay/{first['id']}")
    assert replay.status_code == 200, replay.text
    payload = replay.json()
    assert payload["previous"]["status"] == "failed"
    assert payload["current"]["status"] == "passed"
    assert payload["same_status"] is False
    assert client.post("/tasks/task_missing/validation/replay/x").status_code == 404
    assert (
        client.post(
            f"/tasks/{task['id']}/validation/replay/valrun_missing"
        ).status_code
        == 404
    )
