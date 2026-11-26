from pathlib import Path

from fastapi.testclient import TestClient

from kova_core.api.server import create_app


def make_client(tmp_path: Path, monkeypatch) -> TestClient:
    monkeypatch.setenv("KOVA_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "local"))
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


def test_git_project_defaults_to_worktree(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / ".git").mkdir()
    (repo / "README.md").write_text("game", encoding="utf-8")
    opened = client.post(
        "/project/open",
        json={"path": str(repo), "name": "Git Game"},
    )
    assert opened.status_code == 200, opened.text
    assert opened.json()["project"]["isolation"] == "worktree"

    plain = tmp_path / "plain"
    plain.mkdir()
    other = client.post(
        "/project/open",
        json={"path": str(plain), "name": "Plain Game"},
    )
    assert other.status_code == 200, other.text
    assert other.json()["project"]["isolation"] == "direct"


def test_project_trash_restore_and_purge(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    parent = tmp_path / "games"
    created = client.post(
        "/projects",
        json={"name": "Trash Me", "engine": "godot", "parent": str(parent)},
    ).json()
    root = Path(created["path"])
    assert root.is_dir()

    deleted = client.delete(f"/projects/{created['id']}?delete_files=true")
    assert deleted.status_code == 204
    assert not root.exists()
    items = client.get("/projects/trash").json()["items"]
    assert len(items) == 1
    item = items[0]
    assert item["name"] == "Trash Me"
    assert item["original_path"] == str(root.resolve())

    restored = client.post(f"/projects/trash/{item['id']}/restore")
    assert restored.status_code == 200, restored.text
    assert root.is_dir()
    assert client.get("/projects/trash").json()["items"] == []
    cards = client.get("/projects").json()["projects"]
    assert any(card["name"] == "Trash Me" for card in cards)

    deleted_again = client.delete(f"/projects/{created['id']}?delete_files=true")
    assert deleted_again.status_code == 204
    item = client.get("/projects/trash").json()["items"][0]
    purged = client.delete(f"/projects/trash/{item['id']}")
    assert purged.status_code == 204
    assert not root.exists()
    assert client.get("/projects/trash").json()["items"] == []


def test_project_trash_cleanup_removes_old_entries(tmp_path: Path, monkeypatch) -> None:
    import json

    client = make_client(tmp_path, monkeypatch)
    created = client.post(
        "/projects",
        json={"name": "Old Trash", "engine": "generic", "parent": str(tmp_path / "games")},
    ).json()
    client.delete(f"/projects/{created['id']}?delete_files=true")
    item = client.get("/projects/trash").json()["items"][0]
    meta_path = Path(item["path"]) / ".kova-trash.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    meta["deleted_at"] = "2020-01-01T00:00:00+00:00"
    meta_path.write_text(json.dumps(meta), encoding="utf-8")

    cleaned = client.post("/projects/trash/cleanup?days=30")
    assert cleaned.status_code == 200, cleaned.text
    assert cleaned.json()["removed"] == 1
    assert client.get("/projects/trash").json()["items"] == []
    assert not Path(item["path"]).exists()
