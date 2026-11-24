from pathlib import Path

from fastapi.testclient import TestClient

from kova_core.api.server import create_app


def make_client(tmp_path: Path, monkeypatch) -> TestClient:
    monkeypatch.setenv("KOVA_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.delenv("KOVA_CORE_TOKEN", raising=False)
    return TestClient(create_app())


def test_project_lifecycle(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    listed = client.get("/projects")
    assert listed.status_code == 200
    assert listed.json()["projects"] == []
    assert listed.json()["default_parent"].endswith("projects")

    parent = tmp_path / "games"
    created = client.post(
        "/projects",
        json={"name": "Alpha", "engine": "godot", "parent": str(parent)},
    )
    assert created.status_code == 201
    card = created.json()
    assert card["name"] == "Alpha"
    assert card["engine"] == "godot"
    assert card["active"] is True
    assert (Path(card["path"]) / ".hub" / "project.json").is_file()

    current = client.get("/project").json()
    assert current["project"]["name"] == "Alpha"

    renamed = client.patch(f"/projects/{card['id']}", json={"name": "Alpha Two"})
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "Alpha Two"
    assert client.get("/project").json()["project"]["name"] == "Alpha Two"

    dupes = tmp_path / "dupes"
    duplicated = client.post(
        f"/projects/{card['id']}/duplicate",
        json={"name": "Alpha Copy", "parent": str(dupes)},
    )
    assert duplicated.status_code == 201
    copy = duplicated.json()
    assert Path(copy["path"]).is_dir()
    assert (Path(copy["path"]) / ".hub" / "project.json").is_file()
    assert len(client.get("/projects").json()["projects"]) == 2

    cover = tmp_path / "cover.png"
    cover.write_bytes(b"\x89PNG\r\n\x1a\ncover")
    uploaded = client.post(
        f"/projects/{card['id']}/cover",
        json={"path": str(cover)},
    )
    assert uploaded.status_code == 200
    assert uploaded.json()["cover_url"]
    served = client.get(uploaded.json()["cover_url"])
    assert served.status_code == 200
    assert served.content.startswith(b"\x89PNG")

    deleted = client.delete(f"/projects/{copy['id']}?delete_files=true")
    assert deleted.status_code == 204
    assert not Path(copy["path"]).exists()
    assert len(client.get("/projects").json()["projects"]) == 1

    removed = client.delete(f"/projects/{card['id']}")
    assert removed.status_code == 204
    assert Path(card["path"]).is_dir()
    assert client.get("/projects").json()["projects"] == []


def test_project_validation(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    parent = tmp_path / "games"
    first = client.post(
        "/projects",
        json={"name": "Same", "engine": "roblox", "parent": str(parent)},
    )
    assert first.status_code == 201
    second = client.post(
        "/projects",
        json={"name": "Same", "engine": "roblox", "parent": str(parent)},
    )
    assert second.status_code == 409

    defaulted = client.post("/projects", json={"name": "Defaulted", "engine": "godot"})
    assert defaulted.status_code == 201
    default_id = defaulted.json()["id"]
    assert client.delete(f"/projects/{default_id}").status_code == 204
    names = {item["name"] for item in client.get("/projects").json()["projects"]}
    assert "Defaulted" not in names

    missing = client.post("/projects/prj_missing/open")
    assert missing.status_code == 404
    bad_cover = client.post(
        f"/projects/{first.json()['id']}/cover",
        json={"path": str(tmp_path / "missing.png")},
    )
    assert bad_cover.status_code == 400


def test_task_archive_and_delete(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    client.post("/project/open", json={"path": str(game), "engine": "roblox"})

    task = client.post("/tasks", json={"title": "Сундук"}).json()
    archived = client.patch(f"/tasks/{task['id']}", json={"status": "archived"})
    assert archived.status_code == 200
    assert archived.json()["status"] == "archived"
    assert (game / ".hub" / "tasks" / "archive" / f"{task['id']}.json").is_file()

    deleted = client.delete(f"/tasks/{task['id']}")
    assert deleted.status_code == 204
    assert client.get("/tasks").json() == []
    assert client.delete(f"/tasks/{task['id']}").status_code == 404

    trash = client.get("/tasks/trash")
    assert trash.status_code == 200
    assert [item["id"] for item in trash.json()] == [task["id"]]

    restored = client.post(f"/tasks/{task['id']}/restore")
    assert restored.status_code == 200
    assert restored.json()["deleted_at"] is None
    assert client.get("/tasks/trash").json() == []
    assert client.get("/tasks").json()[0]["id"] == task["id"]

    assert client.delete(f"/tasks/{task['id']}").status_code == 204
    assert client.delete(f"/tasks/{task['id']}/purge").status_code == 204
    assert client.get("/tasks/trash").json() == []
