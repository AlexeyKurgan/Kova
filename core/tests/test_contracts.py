import json
from pathlib import Path

from fastapi.testclient import TestClient

from kova_core.api.server import create_app


def make_client(tmp_path: Path, monkeypatch) -> TestClient:
    monkeypatch.setenv("KOVA_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.delenv("KOVA_CORE_TOKEN", raising=False)
    return TestClient(create_app())


def test_engine_contracts(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    client.post("/project/open", json={"path": str(game)})
    hub = game / ".hub"

    source = tmp_path / "hero.glb"
    source.write_bytes(b"glb")
    asset = client.post(
        "/assets/import",
        json={"path": str(source), "engine": "roblox"},
    ).json()

    empty = client.get(f"/assets/{asset['id']}/contract")
    assert empty.status_code == 200, empty.text
    payload = empty.json()
    assert payload["contract"]["engine"] == "roblox"
    assert payload["contract"]["max_triangles"] == 20_000
    assert payload["checks"] == []

    data = json.loads((hub / "assets" / f"{asset['id']}.json").read_text(encoding="utf-8"))
    data["metrics"] = {
        "objects": 1,
        "triangles": 30_000,
        "vertices": 12_000,
        "materials": 3,
        "textures": 1,
        "bones": 0,
        "animations": 0,
    }
    (hub / "assets" / f"{asset['id']}.json").write_text(json.dumps(data), encoding="utf-8")

    warned = client.get(f"/assets/{asset['id']}/contract").json()
    checks = {row["name"]: row for row in warned["checks"]}
    assert "Контракт: треугольники" in checks
    assert "Контракт: материалы" in checks
    assert checks["Контракт: треугольники"]["status"] == "warning"

    wrong = tmp_path / "hero.blend"
    wrong.write_bytes(b"blend")
    blend = client.post(
        "/assets/import",
        json={"path": str(wrong), "engine": "roblox"},
    ).json()
    blend_report = client.get(f"/assets/{blend['id']}/contract").json()
    assert any("не входит в форматы" in row["message"] for row in blend_report["checks"])

    generic = client.post("/assets/import", json={"path": str(source)}).json()
    generic_report = client.get(f"/assets/{generic['id']}/contract").json()
    assert generic_report["contract"]["engine"] == "generic"
    assert generic_report["checks"] == []
    assert client.get("/assets/asst_missing/contract").status_code == 404
