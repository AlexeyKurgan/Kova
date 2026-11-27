from pathlib import Path

from fastapi.testclient import TestClient

from kova_core.api.server import create_app


def make_client(tmp_path: Path, monkeypatch) -> TestClient:
    monkeypatch.setenv("KOVA_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.delenv("KOVA_CORE_TOKEN", raising=False)
    return TestClient(create_app())


def test_night_shift_config(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    client.post("/project/open", json={"path": str(game)})
    first = client.post("/tasks", json={"title": "Night one"}).json()
    second = client.post("/tasks", json={"title": "Night two"}).json()

    initial = client.get("/night")
    assert initial.status_code == 200
    payload = initial.json()
    assert payload["config"]["task_ids"] == []
    assert payload["run"] is None

    updated = client.patch(
        "/night",
        json={
            "enabled": True,
            "start_at": "23:30",
            "task_ids": [first["id"], second["id"], "task_missing"],
            "max_tasks": 2,
            "stop_on_error": False,
        },
    )
    assert updated.status_code == 200, updated.text
    config = updated.json()["config"]
    assert config["enabled"] is True
    assert config["start_at"] == "23:30"
    assert config["task_ids"] == [first["id"], second["id"]]
    assert config["max_tasks"] == 2
    assert config["stop_on_error"] is False

    assert client.patch("/night", json={"start_at": "24:00"}).status_code == 422
    assert client.patch("/night", json={"max_tasks": 0}).status_code == 422

    # Unknown provider is rejected before a queue starts.
    assert (
        client.post(
            "/night/start",
            json={"task_ids": [first["id"]], "provider_id": "provider_missing"},
        ).status_code
        == 400
    )
    stopped = client.post("/night/stop")
    assert stopped.status_code == 200
    assert stopped.json()["run"] is None
