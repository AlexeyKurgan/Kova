import json
import shutil
import subprocess
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from kova_core.api.server import create_app
from kova_core.sharing import SHARE_FILE
from kova_core.team import project_uid


def make_client(tmp_path: Path, monkeypatch) -> TestClient:
    monkeypatch.setenv("KOVA_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("KOVA_LOCAL_DATA_DIR", str(tmp_path / "cache"))
    monkeypatch.delenv("KOVA_CORE_TOKEN", raising=False)
    return TestClient(create_app())


def create_project(client: TestClient, tmp_path: Path, name: str) -> dict:
    parent = tmp_path / "projects"
    parent.mkdir(exist_ok=True)
    response = client.post(
        "/projects",
        json={"name": name, "engine": "godot", "parent": str(parent)},
    )
    assert response.status_code == 201, response.text
    project_id = response.json()["id"]
    opened = client.post(f"/projects/{project_id}/open")
    assert opened.status_code == 200, opened.text
    return opened.json()


def connect(client: TestClient, location: Path, kind: str = "folder") -> dict:
    response = client.post(
        "/team/connect",
        json={
            "kind": kind,
            "location": str(location),
            "name": "Team",
            "branch": "kova-team",
            "member": "Alice" if kind == "folder" else "Bob",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def bundles(space: Path) -> list[Path]:
    return sorted((space / "bundles").glob("*.kovaproj"))


def import_bundle(client: TestClient, tmp_path: Path, bundle: Path) -> dict:
    imports = tmp_path / "imports"
    imports.mkdir(exist_ok=True)
    response = client.post(
        "/projects/import",
        json={"path": str(bundle), "parent": str(imports)},
    )
    assert response.status_code == 201, response.text
    project_id = response.json()["id"]
    opened = client.post(f"/projects/{project_id}/open")
    assert opened.status_code == 200, opened.text
    return opened.json()


def test_folder_team_roundtrip(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    space = tmp_path / "team-space"
    first = create_project(client, tmp_path, "Team Game")
    root_a = Path(first["path"])

    status = connect(client, space)
    assert status["connected"] is True
    assert status["space"]["kind"] == "folder"
    assert status["space"]["has_token"] is False

    assert client.post("/tasks", json={"title": "From Alice"}).status_code == 201
    published = client.post("/team/publish", json={"message": "first drop"})
    assert published.status_code == 200, published.text
    assert published.json()["bundle"]["message"] == "first drop"

    files = bundles(space)
    assert len(files) == 1
    with zipfile.ZipFile(files[0]) as archive:
        names = set(archive.namelist())
        manifest = json.loads(archive.read(SHARE_FILE))
    assert manifest["project_uid"] == project_uid(root_a)
    assert manifest["bundle_id"] == published.json()["bundle"]["id"]
    assert not any(name.startswith(".hub/team/") for name in names)
    assert any(name.startswith(".hub/tasks/") for name in names)

    second = import_bundle(client, tmp_path, files[0])
    root_b = Path(second["path"])
    assert project_uid(root_b) == project_uid(root_a)
    assert "From Alice" in [task["title"] for task in client.get("/tasks").json()]
    assert client.get("/team").json()["connected"] is False

    connect(client, space)
    incoming = client.get("/team/incoming").json()
    assert len(incoming["bundles"]) == 1
    bundle_id = incoming["bundles"][0]["id"]

    preview = client.get(f"/team/incoming/{bundle_id}").json()
    assert preview["bundle"]["author"] == "Alice"
    assert preview["stats"]["conflicts"] == 0
    applied = client.post(
        f"/team/incoming/{bundle_id}/apply",
        json={"resolutions": {}, "force": False},
    )
    assert applied.status_code == 200, applied.text

    assert client.post("/tasks", json={"title": "From Bob"}).status_code == 201
    published_b = client.post("/team/publish", json={"message": "bob adds"})
    assert published_b.status_code == 200, published_b.text
    assert len(bundles(space)) == 2

    assert client.post(f"/projects/{first['id']}/open").status_code == 200
    incoming_a = client.get("/team/incoming").json()
    assert len(incoming_a["bundles"]) == 1
    bundle_b = incoming_a["bundles"][0]["id"]
    preview_a = client.get(f"/team/incoming/{bundle_b}").json()
    assert preview_a["stats"]["conflicts"] == 0
    assert any(row["path"].startswith(".hub/tasks/") for row in preview_a["changes"])
    applied_a = client.post(f"/team/incoming/{bundle_b}/apply", json={})
    assert applied_a.status_code == 200, applied_a.text
    assert applied_a.json()["written"] > 0
    titles = [task["title"] for task in client.get("/tasks").json()]
    assert "From Bob" in titles

    ledger = (root_a / ".hub" / "ledger" / "events.jsonl").read_text(encoding="utf-8")
    assert ledger.count("team.published") >= 1


def test_team_conflict_resolution(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    space = tmp_path / "team-space"
    first = create_project(client, tmp_path, "Conflict Game")
    root_a = Path(first["path"])
    connect(client, space)
    published = client.post("/team/publish", json={"message": "base"}).json()
    base_bundle = published["bundle"]["id"]

    second = import_bundle(client, tmp_path, bundles(space)[0])
    root_b = Path(second["path"])
    connect(client, space)
    assert client.post(f"/team/incoming/{base_bundle}/apply", json={}).status_code == 200

    # Alice changes notes.txt and publishes.
    assert client.post(f"/projects/{first['id']}/open").status_code == 200
    (root_a / "notes.txt").write_text("alice\n", encoding="utf-8")
    assert client.post("/team/publish", json={"message": "alice notes"}).status_code == 200
    # Alice keeps editing locally after publishing.
    (root_a / "notes.txt").write_text("alice2\n", encoding="utf-8")

    # Bob changes the same file before looking at Alice's bundle.
    assert client.post(f"/projects/{second['id']}/open").status_code == 200
    (root_b / "notes.txt").write_text("bob\n", encoding="utf-8")
    incoming = client.get("/team/incoming").json()["bundles"]
    conflict_id = incoming[0]["id"]
    preview = client.get(f"/team/incoming/{conflict_id}").json()
    rows = {row["path"]: row for row in preview["changes"]}
    assert rows["notes.txt"]["conflict"] is True
    assert preview["can_apply"] is False

    blocked = client.post(f"/team/incoming/{conflict_id}/apply", json={})
    assert blocked.status_code == 400
    assert "конфликт" in blocked.json()["detail"].lower()

    kept = client.post(
        f"/team/incoming/{conflict_id}/apply",
        json={"resolutions": {"notes.txt": "local"}},
    )
    assert kept.status_code == 200, kept.text
    assert (root_b / "notes.txt").read_text(encoding="utf-8") == "bob\n"

    # Bob publishes his version; Alice takes it explicitly.
    assert client.post("/team/publish", json={"message": "bob notes"}).status_code == 200
    assert client.post(f"/projects/{first['id']}/open").status_code == 200
    rows = client.get("/team/incoming").json()["bundles"]
    assert rows
    bob_bundle = rows[0]["id"]
    preview_a = client.get(f"/team/incoming/{bob_bundle}").json()
    assert any(
        row["path"] == "notes.txt" and row["conflict"] for row in preview_a["changes"]
    )
    taken = client.post(
        f"/team/incoming/{bob_bundle}/apply",
        json={"resolutions": {"notes.txt": "remote"}},
    )
    assert taken.status_code == 200, taken.text
    assert (root_a / "notes.txt").read_text(encoding="utf-8") == "bob\n"


def test_team_apply_and_rollback(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    space = tmp_path / "team-space"
    first = create_project(client, tmp_path, "Rollback Game")
    root_a = Path(first["path"])
    connect(client, space)
    assert client.post("/tasks", json={"title": "Base"}).status_code == 201
    published = client.post("/team/publish", json={"message": "base"}).json()
    base_bundle = published["bundle"]["id"]

    second = import_bundle(client, tmp_path, bundles(space)[0])
    connect(client, space)
    assert (
        client.post(f"/team/incoming/{base_bundle}/apply", json={}).status_code
        == 200
    )
    assert client.post("/tasks", json={"title": "Bob task"}).status_code == 201
    assert client.post("/team/publish", json={"message": "bob"}).status_code == 200

    assert client.post(f"/projects/{first['id']}/open").status_code == 200
    rows = client.get("/team/incoming").json()["bundles"]
    assert len(rows) == 1
    applied = client.post(f"/team/incoming/{rows[0]['id']}/apply", json={})
    assert applied.status_code == 200, applied.text
    assert "Bob task" in [task["title"] for task in client.get("/tasks").json()]

    rolled = client.post("/team/rollback")
    assert rolled.status_code == 200, rolled.text
    assert rolled.json()["removed"] >= 1
    titles = [task["title"] for task in client.get("/tasks").json()]
    assert "Bob task" not in titles
    assert "Base" in titles
    again = client.get("/team/incoming").json()["bundles"]
    assert any(row["id"] == rows[0]["id"] for row in again)


def test_git_team_space(tmp_path: Path, monkeypatch) -> None:
    if shutil.which("git") is None:
        pytest.skip("git is not installed")
    client = make_client(tmp_path, monkeypatch)
    bare = tmp_path / "remote.git"
    subprocess.run(["git", "init", "--bare", str(bare)], check=True, capture_output=True)
    first = create_project(client, tmp_path, "Git Team")
    connect(client, bare, kind="git")
    assert client.post("/tasks", json={"title": "Over Git"}).status_code == 201
    response = client.post("/team/publish", json={"message": "git drop"})
    assert response.status_code == 200, response.text

    checkout = tmp_path / "checkout"
    subprocess.run(
        ["git", "clone", "--quiet", "--branch", "kova-team", str(bare), str(checkout)],
        check=True,
        capture_output=True,
    )
    bundle = next((checkout / "bundles").glob("*.kovaproj"))
    index = json.loads((checkout / "kova-team.json").read_text(encoding="utf-8"))
    assert len(index["bundles"]) == 1

    second = import_bundle(client, tmp_path, bundle)
    assert project_uid(Path(second["path"])) == project_uid(Path(first["path"]))
    connect(client, bare, kind="git")
    incoming = client.get("/team/incoming").json()["bundles"]
    assert len(incoming) == 1
    applied = client.post(f"/team/incoming/{incoming[0]['id']}/apply", json={})
    assert applied.status_code == 200, applied.text

    assert client.post("/tasks", json={"title": "Bob over Git"}).status_code == 201
    assert client.post("/team/publish", json={"message": "bob git"}).status_code == 200
    assert client.post(f"/projects/{first['id']}/open").status_code == 200
    rows = client.get("/team/incoming").json()["bundles"]
    assert len(rows) == 1
    taken = client.post(f"/team/incoming/{rows[0]['id']}/apply", json={})
    assert taken.status_code == 200, taken.text
    assert "Bob over Git" in [task["title"] for task in client.get("/tasks").json()]

    history = client.get("/team/history").json()["history"]
    assert history and history[0]["action"] == "apply"


def test_team_requires_space(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    create_project(client, tmp_path, "Solo")
    assert client.get("/team").json()["connected"] is False
    response = client.post("/team/publish", json={"message": "x"})
    assert response.status_code == 400
    assert "не подключён" in response.json()["detail"]


def test_connect_rejects_space_inside_project(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    project = create_project(client, tmp_path, "Inside")
    response = client.post(
        "/team/connect",
        json={
            "kind": "folder",
            "location": str(Path(project["path"]) / "shared"),
            "name": "Bad",
        },
    )
    assert response.status_code == 400
    assert "внутри проекта" in response.json()["detail"]


def test_folder_space_survives_a_different_mount_path(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    first_space = tmp_path / "team-a"
    create_project(client, tmp_path, "Mounted")
    connected = connect(client, first_space)
    shared_id = connected["space"]["id"]
    assert client.post("/team/publish", json={"message": "mount"}).status_code == 200

    second_space = tmp_path / "team-b"
    shutil.copytree(first_space, second_space)
    again = connect(client, second_space)
    assert again["space"]["id"] == shared_id
    rows = client.get("/team/incoming").json()["bundles"]
    assert rows == []
