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

    refreshed = client.get("/tasks").json()
    assert refreshed[0]["status"] == "review"
    reviews = client.get("/review").json()
    assert any(item["task_id"] == task["id"] for item in reviews)
    assert client.get(f"/ai/runs?task_id={task['id']}").status_code == 200


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
