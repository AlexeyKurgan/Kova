from pathlib import Path

from fastapi.testclient import TestClient

from kova_core.api.server import create_app


def make_client(tmp_path: Path, monkeypatch) -> TestClient:
    monkeypatch.setenv("KOVA_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.delenv("KOVA_CORE_TOKEN", raising=False)
    return TestClient(create_app())


def test_snapshot_and_restore(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    (game / "chest.lua").write_text("version 1", encoding="utf-8")
    client.post("/project/open", json={"path": str(game)})

    created = client.post("/snapshots", json={"reason": "before pivot fix"})
    assert created.status_code == 201
    snapshot = created.json()
    assert snapshot["files"][0]["path"] == "chest.lua"
    assert snapshot["restore_point"] is True

    (game / "chest.lua").write_text("version 2 broken", encoding="utf-8")

    restored = client.post(f"/snapshots/{snapshot['id']}/restore")
    assert restored.status_code == 200
    assert (game / "chest.lua").read_text(encoding="utf-8") == "version 1"

    listed = client.get("/snapshots")
    assert listed.status_code == 200
    assert len(listed.json()) == 2

    assert client.post("/snapshots/snap_missing/restore").status_code == 404


def test_doctor_reports_environment(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    client.post("/project/open", json={"path": str(game)})

    response = client.get("/doctor")
    assert response.status_code == 200
    checks = {item["name"]: item for item in response.json()}
    assert checks["Структура .hub"]["status"] == "passed"
    assert "Свободное место" in checks
    assert "Blender" in checks
