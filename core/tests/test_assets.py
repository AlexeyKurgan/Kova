from pathlib import Path

from fastapi.testclient import TestClient

from kova_core.api.server import create_app


def make_client(tmp_path: Path, monkeypatch) -> TestClient:
    monkeypatch.setenv("KOVA_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.delenv("KOVA_CORE_TOKEN", raising=False)
    return TestClient(create_app())


def test_import_asset_and_checks(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    client.post("/project/open", json={"path": str(game), "engine": "roblox"})

    source = tmp_path / "chest.glb"
    source.write_bytes(b"glb-test-data")

    imported = client.post(
        "/assets/import",
        json={"path": str(source), "engine": "roblox", "license": "CC0"},
    )
    assert imported.status_code == 201
    asset = imported.json()
    assert asset["name"] == "chest"
    assert asset["type"] == "model"
    assert asset["path"] == "assets/chest.glb"
    assert asset["file_size"] == len(b"glb-test-data")
    assert (game / "assets" / "chest.glb").is_file()
    assert asset["versions"][0]["label"] == "v1"

    listed = client.get("/assets")
    assert [item["id"] for item in listed.json()] == [asset["id"]]

    checks = client.post(f"/assets/{asset['id']}/checks")
    assert checks.status_code == 200
    statuses = {item["name"]: item["status"] for item in checks.json()}
    assert statuses["Файл на месте"] == "passed"
    assert statuses["Файл не пустой"] == "passed"
    assert statuses["Поддерживаемый формат"] == "passed"
    assert statuses["Хеш совпадает"] == "passed"

    stored = client.get(f"/assets/{asset['id']}/checks")
    assert len(stored.json()) == 4

    stats = client.get("/stats").json()
    assert stats["assets_total"] == 1
    assert stats["assets_problems"] == 0

    raw = client.get(f"/assets/{asset['id']}/file")
    assert raw.status_code == 200
    assert raw.content == b"glb-test-data"

    next_version = tmp_path / "chest_v2.glb"
    next_version.write_bytes(b"glb-test-data-v2")
    versioned = client.post(
        f"/assets/{asset['id']}/versions",
        json={"path": str(next_version), "reason": "v2", "make_current": True},
    )
    assert versioned.status_code == 201
    version_payload = versioned.json()
    assert len(version_payload["versions"]) == 2
    current = version_payload["versions"][-1]
    assert version_payload["current_version_id"] == current["id"]
    assert version_payload["path"] == current["path"]
    assert current["file_size"] == len(b"glb-test-data-v2")
    assert client.get(f"/assets/{asset['id']}/checks").json() == []

    activated = client.post(
        f"/assets/{asset['id']}/versions/{asset['versions'][0]['id']}/activate",
    )
    assert activated.status_code == 200
    assert activated.json()["path"] == asset["path"]
    assert activated.json()["file_size"] == len(b"glb-test-data")
    assert len(client.get(f"/assets/{asset['id']}/checks").json()) == 4

    import json

    hub = game / ".hub"
    previews = hub / "artifacts" / "previews"
    previews.mkdir(parents=True, exist_ok=True)
    v1 = activated.json()["versions"][0]
    v2 = activated.json()["versions"][1]
    (previews / f"{asset['id']}_{v1['id']}.png").write_bytes(b"png-v1")
    (previews / f"{asset['id']}_{v2['id']}.png").write_bytes(b"png-v2")
    stored_asset = hub / "assets" / f"{asset['id']}.json"
    payload = json.loads(stored_asset.read_text(encoding="utf-8"))
    payload["versions"][0]["preview"] = f"artifacts/previews/{asset['id']}_{v1['id']}.png"
    payload["versions"][1]["preview"] = f"artifacts/previews/{asset['id']}_{v2['id']}.png"
    payload["preview"] = payload["versions"][0]["preview"]
    stored_asset.write_text(json.dumps(payload), encoding="utf-8")

    assert client.get(f"/assets/{asset['id']}/preview").content == b"png-v1"
    assert (
        client.get(f"/assets/{asset['id']}/preview?version_id={v2['id']}").content
        == b"png-v2"
    )
    assert (
        client.get(f"/assets/{asset['id']}/preview?version_id=ver_missing").status_code
        == 404
    )


def test_asset_task_link(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    client.post("/project/open", json={"path": str(game)})

    task = client.post("/tasks", json={"title": "Сундук"}).json()
    source = tmp_path / "chest.glb"
    source.write_bytes(b"glb")

    from_task = client.post(
        "/tasks",
        json={"title": "С созданным ассетом"},
    ).json()
    imported = client.post(
        "/assets/import",
        json={"path": str(source), "task_id": from_task["id"]},
    )
    assert imported.status_code == 201
    linked_asset = imported.json()
    assert linked_asset["task_id"] == from_task["id"]
    task_after = next(
        item for item in client.get("/tasks").json() if item["id"] == from_task["id"]
    )
    assert linked_asset["id"] in task_after["asset_ids"]

    asset = imported.json()
    second = client.post("/tasks", json={"title": "Второй клинок"}).json()
    multi = client.patch(
        f"/assets/{asset['id']}",
        json={"task_ids": [task["id"], second["id"]]},
    )
    assert multi.status_code == 200
    assert set(multi.json()["task_ids"]) == {task["id"], second["id"]}
    tasks = {item["id"]: item for item in client.get("/tasks").json()}
    assert asset["id"] in tasks[task["id"]]["asset_ids"]
    assert asset["id"] in tasks[second["id"]]["asset_ids"]

    unlinked = client.patch(f"/assets/{asset['id']}", json={"task_ids": []})
    assert unlinked.status_code == 200
    assert unlinked.json()["task_ids"] == []

    linked = client.patch(f"/assets/{asset['id']}", json={"task_id": task["id"]})
    assert linked.status_code == 200
    assert linked.json()["task_id"] == task["id"]

    missing = client.patch(
        f"/assets/{asset['id']}",
        json={"task_id": "task_missing"},
    )
    assert missing.status_code == 404


def test_asset_export_profiles(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    client.post("/project/open", json={"path": str(game)})
    source = tmp_path / "sword.glb"
    source.write_bytes(b"glb")
    asset = client.post(
        "/assets/import",
        json={"path": str(source), "engine": "roblox"},
    ).json()
    assert asset["export_profiles"] == []

    updated = client.patch(
        f"/assets/{asset['id']}",
        json={
            "license": "CC-BY",
            "export_profiles": [
                {"engine": "roblox", "format": "FBX", "options": {"scale": "1"}},
                {"engine": "godot", "format": "GLB"},
            ],
        },
    )
    assert updated.status_code == 200, updated.text
    payload = updated.json()
    assert payload["license"] == "CC-BY"
    assert [row["format"] for row in payload["export_profiles"]] == ["FBX", "GLB"]
    assert payload["export_profiles"][0]["options"] == {"scale": "1"}

    cleared = client.patch(f"/assets/{asset['id']}", json={"export_profiles": []})
    assert cleared.status_code == 200
    assert cleared.json()["export_profiles"] == []


def test_blender_status(tmp_path: Path, monkeypatch) -> None:
    import pytest

    from kova_core.integrations.blender.bridge import find_blender

    if find_blender() is None:
        pytest.skip("Blender не установлен")

    client = make_client(tmp_path, monkeypatch)
    response = client.get("/blender/status")
    assert response.status_code == 200
    data = response.json()
    assert data["installed"] is True
    assert data["path"]
    assert "Blender" in data["version"]


def test_import_rejects_missing_file(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    client.post("/project/open", json={"path": str(game)})

    response = client.post("/assets/import", json={"path": str(tmp_path / "missing.glb")})
    assert response.status_code == 400


def test_delete_asset_removes_file_and_task_link(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    client.post("/project/open", json={"path": str(game), "engine": "roblox"})
    task = client.post("/tasks", json={"title": "Asset owner"}).json()
    source = tmp_path / "sword.glb"
    source.write_bytes(b"sword-data")
    asset = client.post(
        "/assets/import",
        json={"path": str(source), "task_id": task["id"]},
    ).json()
    linked = next(item for item in client.get("/tasks").json() if item["id"] == task["id"])
    assert asset["id"] in linked["asset_ids"]
    copied = game / asset["path"]
    assert copied.is_file()

    response = client.delete(f"/assets/{asset['id']}")
    assert response.status_code == 204
    assert not copied.exists()
    assert not (game / ".hub" / "assets" / f"{asset['id']}.json").exists()
    assert client.get("/assets").json() == []
    updated = next(item for item in client.get("/tasks").json() if item["id"] == task["id"])
    assert asset["id"] not in updated["asset_ids"]
    assert client.delete(f"/assets/{asset['id']}").status_code == 404


def test_duplicate_asset_copies_current_file(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    client.post("/project/open", json={"path": str(game)})
    source = tmp_path / "shield.glb"
    source.write_bytes(b"shield")
    asset = client.post("/assets/import", json={"path": str(source)}).json()
    duplicate = client.post(f"/assets/{asset['id']}/duplicate")
    assert duplicate.status_code == 201, duplicate.text
    copy = duplicate.json()
    assert copy["id"] != asset["id"]
    assert copy["name"].endswith("copy")
    assert copy["versions"][0]["path"] != asset["versions"][0]["path"]
    assert (game / copy["versions"][0]["path"]).is_file()
    assert len(client.get("/assets").json()) == 2


def test_asset_dependencies(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    client.post("/project/open", json={"path": str(game)})
    texture = tmp_path / "wood.png"
    texture.write_bytes(b"png")
    model = tmp_path / "chest.glb"
    model.write_bytes(b"glb")
    texture_asset = client.post("/assets/import", json={"path": str(texture)}).json()
    model_asset = client.post("/assets/import", json={"path": str(model)}).json()

    updated = client.patch(
        f"/assets/{model_asset['id']}",
        json={
            "dependencies": [
                {
                    "kind": "texture",
                    "target_id": texture_asset["id"],
                    "label": "wood texture",
                }
            ]
        },
    )
    assert updated.status_code == 200, updated.text
    deps = updated.json()["dependencies"]
    assert deps == [
        {
            "kind": "texture",
            "target_id": texture_asset["id"],
            "label": "wood texture",
        }
    ]

    cleared = client.patch(f"/assets/{model_asset['id']}", json={"dependencies": []})
    assert cleared.status_code == 200
    assert cleared.json()["dependencies"] == []

    self_link = client.patch(
        f"/assets/{model_asset['id']}",
        json={"dependencies": [{"kind": "asset", "target_id": model_asset["id"]}]},
    )
    assert self_link.status_code == 422
