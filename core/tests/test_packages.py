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
    opened = app_client.post("/project/open", json={"path": str(game)})
    assert opened.status_code == 200, opened.text
    return app_client


def test_packages_catalog_and_install(client: TestClient) -> None:
    response = client.get("/packages")
    assert response.status_code == 200, response.text
    rows = response.json()
    ids = {row["id"]: row for row in rows}
    assert {"kova-core", "blender-core", "roblox-core"} <= set(ids)
    assert ids["kova-core"]["status"] == "installed"
    assert ids["blender-core"]["installed"] is True
    assert ids["godot-core"]["status"] == "coming_soon"

    removed = client.post("/packages/blender-core/uninstall")
    assert removed.status_code == 200, removed.text
    after = {row["id"]: row for row in client.get("/packages").json()}
    assert after["blender-core"]["status"] == "available"

    installed = client.post("/packages/blender-core/install")
    assert installed.status_code == 200, installed.text
    assert installed.json()["status"] == "installed"

    disabled = client.patch("/packages/blender-core", json={"enabled": False})
    assert disabled.status_code == 200, disabled.text
    assert disabled.json()["status"] == "disabled"

    enabled = client.patch("/packages/blender-core", json={"enabled": True})
    assert enabled.status_code == 200, enabled.text
    assert enabled.json()["status"] == "installed"


def test_packages_reject_core_removal_and_coming_soon(client: TestClient) -> None:
    assert client.post("/packages/kova-core/uninstall").status_code == 400
    assert client.post("/packages/godot-core/install").status_code == 400
    assert client.get("/packages/nope").status_code == 404
    assert client.post("/packages/nope/install").status_code == 404
