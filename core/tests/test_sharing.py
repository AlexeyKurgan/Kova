import json
import zipfile
from pathlib import Path

from fastapi.testclient import TestClient

from kova_core.api.server import create_app
from kova_core.sharing import SHARE_FILE, SHARE_FORMAT, SHARE_VERSION


def make_client(tmp_path: Path, monkeypatch) -> TestClient:
    monkeypatch.setenv("KOVA_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.delenv("KOVA_CORE_TOKEN", raising=False)
    return TestClient(create_app())


def _create_project(client: TestClient, tmp_path: Path) -> dict:
    parent = tmp_path / "projects"
    parent.mkdir()
    response = client.post(
        "/projects",
        json={"name": "Share Test", "engine": "generic", "parent": str(parent)},
    )
    assert response.status_code == 201, response.text
    project = response.json()
    opened = client.post(f"/projects/{project['id']}/open")
    assert opened.status_code == 200, opened.text
    return opened.json()


def test_export_and_import_project(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    project = _create_project(client, tmp_path)
    root = Path(project["path"])

    task = client.post("/tasks", json={"title": "Shared task", "goal": "Keep me"}).json()
    source = tmp_path / "asset.glb"
    source.write_bytes(b"glb")
    client.post("/assets/import", json={"path": str(source), "task_id": task["id"]})

    (root / ".git").mkdir()
    (root / ".git" / "config").write_text("secret git", encoding="utf-8")
    (root / ".env").write_text("SECRET=1", encoding="utf-8")
    (root / "node_modules").mkdir()
    (root / "node_modules" / "x.js").write_text("cache", encoding="utf-8")
    (root / ".hub" / ".local").mkdir(parents=True, exist_ok=True)
    (root / ".hub" / ".local" / "token.txt").write_text("private", encoding="utf-8")

    target = tmp_path / "share.kovaproj"
    exported = client.post(
        f"/projects/{project['id']}/export",
        json={"target": str(target)},
    )
    assert exported.status_code == 200, exported.text
    result = exported.json()
    assert result["files"] > 0
    assert result["path"].endswith(".kovaproj")
    assert target.is_file()

    with zipfile.ZipFile(target) as archive:
        names = set(archive.namelist())
        manifest = json.loads(archive.read(SHARE_FILE))
    assert manifest["format"] == SHARE_FORMAT
    assert manifest["version"] == SHARE_VERSION
    assert manifest["name"] == "Share Test"
    assert any(name.startswith(".hub/tasks/") for name in names)
    assert not any(name.startswith(".git/") for name in names)
    assert not any(name.startswith("node_modules/") for name in names)
    assert ".env" not in names
    assert not any(name.startswith(".hub/.local/") for name in names)

    imports = tmp_path / "imports"
    imports.mkdir()
    imported = client.post(
        "/projects/import",
        json={"path": str(target), "parent": str(imports)},
    )
    assert imported.status_code == 201, imported.text
    row = imported.json()
    imported_root = Path(row["path"])
    assert imported_root.is_dir()
    assert (imported_root / ".hub" / "tasks").is_dir()
    assert not (imported_root / ".git").exists()
    assert not (imported_root / ".env").exists()

    opened = client.post(f"/projects/{row['id']}/open")
    assert opened.status_code == 200, opened.text
    tasks = client.get("/tasks").json()
    assert [item["title"] for item in tasks] == ["Shared task"]
    assets = client.get("/assets").json()
    assert len(assets) == 1


def test_import_rejects_zip_slip(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    archive = tmp_path / "bad.kovaproj"
    with zipfile.ZipFile(archive, "w") as z:
        z.writestr(
            SHARE_FILE,
            json.dumps(
                {
                    "format": SHARE_FORMAT,
                    "version": SHARE_VERSION,
                    "name": "Bad",
                    "engine": "generic",
                }
            ),
        )
        z.writestr("../escape.txt", "bad")
    imports = tmp_path / "imports"
    imports.mkdir()
    response = client.post(
        "/projects/import",
        json={"path": str(archive), "parent": str(imports)},
    )
    assert response.status_code == 400
    assert "небезопасный" in response.json()["detail"]
    assert not (tmp_path / "escape.txt").exists()
    assert not any(imports.iterdir())


def test_import_rejects_wrong_manifest(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    archive = tmp_path / "wrong.kovaproj"
    with zipfile.ZipFile(archive, "w") as z:
        z.writestr("readme.txt", "not a project")
    response = client.post(
        "/projects/import",
        json={"path": str(archive), "parent": str(tmp_path)},
    )
    assert response.status_code == 400
    assert SHARE_FILE in response.json()["detail"]
