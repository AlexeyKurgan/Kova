import sys
from pathlib import Path

from fastapi.testclient import TestClient

from kova_core.api.server import create_app


def make_client(tmp_path: Path, monkeypatch) -> TestClient:
    monkeypatch.setenv("KOVA_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.delenv("KOVA_CORE_TOKEN", raising=False)
    return TestClient(create_app())


def test_godot_detection_and_import(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    (game / "project.godot").write_text("[application]\nconfig/name=\"Test\"\n", encoding="utf-8")
    monkeypatch.setenv("KOVA_GODOT", sys.executable)
    client.post("/project/open", json={"path": str(game), "engine": "godot"})
    client.post("/packages/godot-core/install")

    listed = client.get("/engines")
    assert listed.status_code == 200
    assert {row["engine"] for row in listed.json()} == {
        "godot",
        "unity",
        "unreal",
        "rpgmaker",
        "web",
    }

    info = client.get("/engines/godot")
    assert info.status_code == 200, info.text
    data = info.json()
    assert data["installed"] is True
    assert data["project_detected"] is True
    assert data["project_file"].endswith("project.godot")
    assert ".glb" in data["formats"]

    source = tmp_path / "hero.glb"
    source.write_bytes(b"glb")
    asset = client.post("/assets/import", json={"path": str(source), "engine": "godot"}).json()
    imported = client.post(f"/engines/godot/import/{asset['id']}")
    assert imported.status_code == 200, imported.text
    payload = imported.json()
    assert payload["relative"] == "assets/kova/hero.glb"
    assert (game / "assets" / "kova" / "hero.glb").read_bytes() == b"glb"
    assert client.get("/engines/roblox").status_code == 404


def test_rpgmaker_project_import(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    (game / "game.rmmzproject").write_text("{}", encoding="utf-8")
    client.post("/project/open", json={"path": str(game), "engine": "rpgmaker"})
    client.post("/packages/rpgmaker-core/install")

    info = client.get("/engines/rpgmaker").json()
    assert info["installed"] is True
    assert info["project_detected"] is True

    source = tmp_path / "hero.png"
    source.write_bytes(b"png")
    asset = client.post("/assets/import", json={"path": str(source), "engine": "rpgmaker"}).json()
    imported = client.post(f"/engines/rpgmaker/import/{asset['id']}")
    assert imported.status_code == 200, imported.text
    assert imported.json()["relative"] == "img/pictures/hero.png"
    assert (game / "img" / "pictures" / "hero.png").is_file()


def test_engine_import_rejects_wrong_format(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    (game / "game.rmmzproject").write_text("{}", encoding="utf-8")
    client.post("/project/open", json={"path": str(game), "engine": "rpgmaker"})
    client.post("/packages/rpgmaker-core/install")
    source = tmp_path / "hero.glb"
    source.write_bytes(b"glb")
    asset = client.post("/assets/import", json={"path": str(source)}).json()
    response = client.post(f"/engines/rpgmaker/import/{asset['id']}")
    assert response.status_code == 400
    assert "не поддерживается" in response.json()["detail"]


def test_reimport_requires_supported_engine_and_package(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    (game / "game.rmmzproject").write_text("{}", encoding="utf-8")
    client.post("/project/open", json={"path": str(game), "engine": "rpgmaker"})
    response = client.post("/engines/rpgmaker/reimport", json={})
    assert response.status_code == 400
    assert "Godot и Unity" in response.json()["detail"]

    response = client.post("/engines/godot/reimport", json={})
    assert response.status_code == 400
    assert "пакет" in response.json()["detail"]
