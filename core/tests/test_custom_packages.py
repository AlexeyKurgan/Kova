import json
import zipfile
from pathlib import Path

from fastapi.testclient import TestClient

from kova_core.api.server import create_app


def make_client(tmp_path: Path, monkeypatch) -> TestClient:
    monkeypatch.setenv("KOVA_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.delenv("KOVA_CORE_TOKEN", raising=False)
    return TestClient(create_app())


def _manifest(package_id: str = "my-pack") -> dict:
    return {
        "id": package_id,
        "name": "My Pack",
        "version": "1.0.0",
        "type": "tool_adapter",
        "author": "Local",
        "engines": ["generic"],
        "permissions": ["project.read"],
        "tools": ["custom.tool"],
        "checks": ["custom.check"],
        "templates": [],
        "ui": [],
        "description": "Local test package",
        "description_en": "English test package",
    }


def test_import_custom_package(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    client.post("/project/open", json={"path": str(game)})
    source = tmp_path / "pack"
    source.mkdir()
    (source / "kova-package.json").write_text(json.dumps(_manifest()), encoding="utf-8")
    (source / "tool.py").write_text("print('ok')", encoding="utf-8")

    imported = client.post("/packages/import", json={"path": str(source)})
    assert imported.status_code == 200, imported.text
    row = imported.json()
    assert row["id"] == "my-pack"
    assert row["trust"] == "local"
    assert row["status"] == "available"
    assert row["custom"] is True
    assert (game / ".hub" / "packages" / "custom" / "my-pack" / "tool.py").is_file()

    listed = {item["id"]: item for item in client.get("/packages").json()}
    assert "my-pack" in listed
    installed = client.post("/packages/my-pack/install")
    assert installed.status_code == 200
    assert installed.json()["status"] == "installed"
    disabled = client.patch("/packages/my-pack", json={"enabled": False})
    assert disabled.json()["status"] == "disabled"
    assert client.post("/packages/my-pack/uninstall").status_code == 200

    duplicate = client.post("/packages/import", json={"path": str(source)})
    assert duplicate.status_code == 400
    assert "уже установлен" in duplicate.json()["detail"]


def test_import_custom_package_zip_slip(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    client.post("/project/open", json={"path": str(game)})
    archive = tmp_path / "bad.zip"
    with zipfile.ZipFile(archive, "w") as z:
        z.writestr("kova-package.json", json.dumps(_manifest("bad-pack")))
        z.writestr("../escape.txt", "bad")
    response = client.post("/packages/import", json={"path": str(archive)})
    assert response.status_code == 400
    assert "небезопасный" in response.json()["detail"]
    assert not (game / "escape.txt").exists()


def test_import_custom_package_static_id_rejected(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    client.post("/project/open", json={"path": str(game)})
    source = tmp_path / "pack"
    source.mkdir()
    (source / "kova-package.json").write_text(
        json.dumps(_manifest("blender-core")), encoding="utf-8"
    )
    response = client.post("/packages/import", json={"path": str(source)})
    assert response.status_code == 409
    assert "встроенным" in response.json()["detail"]


def test_custom_package_task_templates(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    client.post("/project/open", json={"path": str(game)})
    manifest = _manifest("template-pack")
    manifest["task_templates"] = [
        {
            "id": "review-pass",
            "label": "Review pass",
            "title": "Проверить ассет по чек-листу",
            "type": "model",
            "engine": "generic",
            "goal": "Пройти чек-лист и исправить замечания.",
            "criteria": ["Масштаб", "Материалы"],
            "label_en": "Checklist review",
            "title_en": "Review the checklist",
            "goal_en": "Go through the checklist and fix the findings.",
            "criteria_en": ["Scale", "Materials"],
        },
        {
            "id": "bad id",
            "label": "Bad",
        },
    ]
    source = tmp_path / "template-pack"
    source.mkdir()
    (source / "kova-package.json").write_text(json.dumps(manifest), encoding="utf-8")
    assert client.post("/packages/import", json={"path": str(source)}).status_code == 200
    assert client.get("/packages/templates").json() == []

    installed = client.post("/packages/template-pack/install")
    assert installed.status_code == 200, installed.text
    rows = client.get("/packages/templates").json()
    assert len(rows) == 1
    assert rows[0]["id"] == "template-pack::review-pass"
    assert rows[0]["type"] == "model"
    assert rows[0]["engine"] == "generic"
    assert rows[0]["criteria"] == ["Масштаб", "Материалы"]

    english = client.get(
        "/packages/templates", headers={"X-Kova-Language": "en"}
    ).json()
    assert english[0]["label"] == "Checklist review"
    assert english[0]["title"] == "Review the checklist"
    assert english[0]["criteria"] == ["Scale", "Materials"]
    listed_en = {
        row["id"]: row
        for row in client.get(
            "/packages", headers={"X-Kova-Language": "en"}
        ).json()
    }
    assert listed_en["template-pack"]["description"] == "English test package"

    client.patch("/packages/template-pack", json={"enabled": False})
    assert client.get("/packages/templates").json() == []
