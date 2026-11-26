from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from kova_core.api.server import create_app


@pytest.fixture()
def client(tmp_path: Path, monkeypatch) -> TestClient:
    monkeypatch.setenv("KOVA_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.delenv("KOVA_CORE_TOKEN", raising=False)
    game = tmp_path / "game"
    game.mkdir()
    app_client = TestClient(create_app())
    assert app_client.post("/project/open", json={"path": str(game)}).status_code == 200
    return app_client


def test_memory_search_finds_tasks_and_assets(client: TestClient, tmp_path: Path) -> None:
    task = client.post(
        "/tasks",
        json={
            "title": "Уникальный поиск памяти",
            "goal": "Найти задачу по слову quasarmemory",
            "status": "ready",
        },
    )
    assert task.status_code == 201, task.text
    task_id = task.json()["id"]

    model = tmp_path / "quasarmodel.fbx"
    model.write_text("fake fbx", encoding="utf-8")
    asset = client.post(
        "/assets/import",
        json={"path": str(model), "name": "Quasar Blade", "type": "model", "engine": "roblox"},
    )
    assert asset.status_code == 201, asset.text
    asset_id = asset.json()["id"]

    found = client.get("/memory/search", params={"q": "quasarmemory"})
    assert found.status_code == 200, found.text
    payload = found.json()
    assert payload["total"] >= 1
    assert payload["timeline"]["granularity"] == "day"
    assert len(payload["timeline"]["buckets"]) == 14
    assert any(row["id"] == task_id for row in payload["groups"]["tasks"])

    found_asset = client.get("/memory/search", params={"q": "quasar"})
    assert any(row["id"] == asset_id for row in found_asset.json()["groups"]["assets"])

    empty = client.get("/memory/search", params={"q": "no-such-token-xyz"})
    assert empty.status_code == 200
    assert empty.json()["total"] == 0

    monthly = client.get("/memory/search", params={"granularity": "month"}).json()
    assert monthly["timeline"]["granularity"] == "month"
    assert len(monthly["timeline"]["buckets"]) == 12
    yearly = client.get("/memory/search", params={"granularity": "year"}).json()
    assert len(yearly["timeline"]["buckets"]) == 5


def test_memory_empty_query_returns_recent(client: TestClient) -> None:
    client.post("/tasks", json={"title": "Недавняя задача"})
    payload = client.get("/memory/search").json()
    assert payload["total"] >= 0
    assert payload["groups"]["tasks"]
