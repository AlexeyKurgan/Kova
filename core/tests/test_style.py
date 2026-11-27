import json
from pathlib import Path

from fastapi.testclient import TestClient

from kova_core.api.server import create_app


def make_client(tmp_path: Path, monkeypatch) -> TestClient:
    monkeypatch.setenv("KOVA_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.delenv("KOVA_CORE_TOKEN", raising=False)
    return TestClient(create_app())


def test_style_bible_checks(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    client.post("/project/open", json={"path": str(game)})
    hub = game / ".hub"

    default = client.get("/style")
    assert default.status_code == 200
    assert default.json()["enabled"] is False
    assert client.get("/style/violations").json() == []

    source = tmp_path / "Hero.glb"
    source.write_bytes(b"glb")
    asset = client.post("/assets/import", json={"path": str(source)}).json()

    updated = client.patch(
        "/style",
        json={
            "enabled": True,
            "name": "Hero style",
            "max_triangles": 100,
            "max_materials": 2,
            "require_license": True,
            "naming_pattern": "^[a-z][a-z0-9-]*$",
            "palette": ["#D8A657", "#1C232B"],
        },
    )
    assert updated.status_code == 200, updated.text
    payload = updated.json()
    assert payload["enabled"] is True
    assert payload["max_triangles"] == 100
    assert payload["palette"] == ["#D8A657", "#1C232B"]

    asset_file = hub / "assets" / f"{asset['id']}.json"
    data = json.loads(asset_file.read_text(encoding="utf-8"))
    data["metrics"] = {
        "objects": 2,
        "triangles": 500,
        "vertices": 400,
        "materials": 3,
        "textures": 1,
        "bones": 0,
        "animations": 0,
    }
    data["license"] = ""
    asset_file.write_text(json.dumps(data), encoding="utf-8")

    violations = client.get("/style/violations").json()
    assert len(violations) == 1
    checks = {row["name"]: row for row in violations[0]["checks"]}
    assert "Стиль: треугольники" in checks
    assert "Стиль: материалы" in checks
    assert "Стиль: лицензия" in checks
    assert "Стиль: шаблон имени" in checks
    assert checks["Стиль: треугольники"]["status"] == "warning"

    checked = client.post(f"/assets/{asset['id']}/checks")
    assert checked.status_code == 200
    names = {row["name"] for row in checked.json()}
    assert "Стиль: треугольники" in names
    assert "Файл на месте" in names

    invalid = client.patch("/style", json={"naming_pattern": "["})
    assert invalid.status_code == 200
    invalid_checks = client.get("/style/violations").json()[0]["checks"]
    assert any("задан неверно" in row["message"] for row in invalid_checks)

    disabled = client.patch("/style", json={"enabled": False})
    assert disabled.status_code == 200
    assert client.get("/style/violations").json() == []


def test_style_palette_preview(tmp_path: Path, monkeypatch) -> None:
    from PIL import Image

    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    client.post("/project/open", json={"path": str(game)})
    hub = game / ".hub"
    source = tmp_path / "sword.png"
    Image.new("RGB", (16, 16), (220, 30, 30)).save(source)
    asset = client.post("/assets/import", json={"path": str(source)}).json()

    preview = hub / "artifacts" / "previews" / f"{asset['id']}.png"
    preview.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (16, 16), (220, 30, 30)).save(preview)
    asset_file = hub / "assets" / f"{asset['id']}.json"
    data = json.loads(asset_file.read_text(encoding="utf-8"))
    data["preview"] = f"artifacts/previews/{asset['id']}.png"
    asset_file.write_text(json.dumps(data), encoding="utf-8")

    client.patch("/style", json={"enabled": True, "palette": ["#00FF00"]})
    violations = client.get("/style/violations").json()
    checks = {row["name"]: row for row in violations[0]["checks"]}
    assert "Стиль: палитра" in checks

    client.patch("/style", json={"palette": ["#DC1E1E"]})
    assert client.get("/style/violations").json() == []
