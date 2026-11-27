import hashlib
import io
import json
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from kova_core.api.server import create_app
from kova_core.packages import remote


class FakeResponse:
    def __init__(self, data: bytes, url: str = "https://1.1.1.1/package.zip") -> None:
        self._buffer = io.BytesIO(data)
        self._url = url

    def read(self, size: int = -1) -> bytes:
        return self._buffer.read(size)

    def geturl(self) -> str:
        return self._url

    def __enter__(self):
        return self

    def __exit__(self, *args) -> None:
        return None


def make_client(tmp_path: Path, monkeypatch) -> TestClient:
    monkeypatch.setenv("KOVA_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.delenv("KOVA_CORE_TOKEN", raising=False)
    client = TestClient(create_app())
    game = tmp_path / "game"
    game.mkdir()
    assert client.post("/project/open", json={"path": str(game)}).status_code == 200
    return client


def _manifest(package_id: str = "remote-pack") -> dict:
    return {
        "id": package_id,
        "name": "Remote Pack",
        "version": "1.2.0",
        "type": "check",
        "author": "Community",
        "engines": ["generic"],
        "permissions": ["project.read"],
        "tools": ["remote.check"],
        "checks": ["remote.naming"],
        "templates": [],
        "ui": [],
        "description": "Remote test package",
    }


def _archive(path: Path, package_id: str = "remote-pack") -> None:
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("kova-package.json", json.dumps(_manifest(package_id)))
        archive.writestr("checklist.json", json.dumps({"items": ["naming", "scale"]}))


def test_remote_url_rejects_non_public_targets() -> None:
    for value in (
        "http://1.1.1.1/index.json",
        "https://localhost/index.json",
        "https://127.0.0.1/index.json",
        "https://10.0.0.1/index.json",
        "https://169.254.169.254/latest/meta-data",
        "https://user:pass@1.1.1.1/index.json",
        "https://1.1.1.1.local/index.json",
    ):
        with pytest.raises(remote.RemoteError):
            remote._validate_url(value)
    assert remote._validate_url("https://1.1.1.1/index.json").hostname == "1.1.1.1"


def test_fetch_index_normalizes_and_skips_invalid(monkeypatch) -> None:
    payload = {
        "schema": 1,
        "name": "Test Index",
        "updated_at": "2026-11-27",
        "packages": [
            {
                "id": "remote-pack",
                "name": "Remote Pack",
                "version": "1.0.0",
                "download_url": "https://1.1.1.1/pkg.zip",
                "sha256": "a" * 64,
                "size": 1024,
            },
            {"id": "Bad Id", "name": "Bad"},
            {
                "id": "no-hash",
                "name": "No hash",
                "download_url": "https://1.1.1.1/x.zip",
            },
        ],
    }
    monkeypatch.setattr(remote, "_read_url", lambda url, limit: json.dumps(payload).encode())
    index = remote.fetch_index("https://1.1.1.1/index.json")
    assert index["name"] == "Test Index"
    assert [item["id"] for item in index["packages"]] == ["remote-pack"]
    entry = index["packages"][0]
    assert entry["trust"] == "remote"
    assert entry["engines"] == ["generic"]
    assert entry["sha256"] == "a" * 64


def test_download_rejects_sha_mismatch(tmp_path: Path, monkeypatch) -> None:
    payload = b"not the expected bytes"
    monkeypatch.setattr(remote, "_open", lambda url: FakeResponse(payload))
    target = tmp_path / "package.zip"
    with pytest.raises(remote.RemoteError, match="SHA256"):
        remote._download_archive(
            "https://1.1.1.1/package.zip",
            target,
            hashlib.sha256(b"other").hexdigest(),
        )
    assert not target.exists()


def test_marketplace_and_install(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    archive = tmp_path / "remote-pack.zip"
    _archive(archive)
    payload = {
        "name": "Test Index",
        "updated_at": "2026-11-27",
        "index_url": "https://1.1.1.1/index.json",
        "packages": [
            {
                "id": "remote-pack",
                "name": "Remote Pack",
                "version": "1.2.0",
                "type": "check",
                "author": "Community",
                "engines": ["generic"],
                "permissions": ["project.read"],
                "tools": ["remote.check"],
                "checks": ["remote.naming"],
                "templates": [],
                "ui": [],
                "description": "Remote test package",
                "homepage": "",
                "download_url": "https://1.1.1.1/remote-pack.zip",
                "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
                "size": archive.stat().st_size,
                "trust": "remote",
            }
        ],
    }
    monkeypatch.setattr(remote, "fetch_index", lambda url: dict(payload))
    response = client.get("/packages/marketplace")
    assert response.status_code == 200, response.text
    row = response.json()["packages"][0]
    assert row["installed"] is False
    assert row["builtin"] is False

    monkeypatch.setattr(
        remote,
        "_download_archive",
        lambda url, target, sha: target.write_bytes(archive.read_bytes()),
    )
    installed = client.post(
        "/packages/marketplace/install",
        json={
            "package_id": "remote-pack",
            "url": payload["packages"][0]["download_url"],
            "sha256": payload["packages"][0]["sha256"],
        },
    )
    assert installed.status_code == 200, installed.text
    assert installed.json()["status"] == "installed"
    assert installed.json()["trust"] == "remote"
    game = tmp_path / "game"
    assert (
        game / ".hub" / "packages" / "custom" / "remote-pack" / "checklist.json"
    ).is_file()

    again = client.get("/packages/marketplace")
    assert again.json()["packages"][0]["installed"] is True

    builtin = client.post(
        "/packages/marketplace/install",
        json={
            "package_id": "blender-core",
            "url": "https://1.1.1.1/x.zip",
            "sha256": "a" * 64,
        },
    )
    assert builtin.status_code == 409


def test_marketplace_rejects_private_index(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    response = client.get("/packages/marketplace", params={"url": "http://127.0.0.1:8765/x"})
    assert response.status_code == 502
    assert "HTTPS" in response.json()["detail"]


def test_committed_index_matches_sample_archive() -> None:
    root = Path(__file__).resolve().parents[2]
    index = json.loads((root / "packages" / "index.json").read_text(encoding="utf-8"))
    assert index["schema"] == 1
    sample = index["packages"][0]
    archive = (
        root / "packages" / "archives" / "starter-review-checklist-1.1.0.zip"
    ).read_bytes()
    assert hashlib.sha256(archive).hexdigest() == sample["sha256"]
    assert len(archive) == sample["size"]
    manifest = json.loads(
        (root / "packages" / "samples" / "starter-review-checklist" / "kova-package.json").read_text(
            encoding="utf-8"
        )
    )
    assert manifest["id"] == sample["id"]
    assert manifest["version"] == sample["version"]



def test_marketplace_updates_existing_package(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    first = tmp_path / "first.zip"
    _archive(first)
    entry = {
        "id": "remote-pack",
        "name": "Remote Pack",
        "version": "1.2.0",
        "type": "check",
        "author": "Community",
        "engines": ["generic"],
        "permissions": ["project.read"],
        "tools": [],
        "checks": ["remote.naming"],
        "templates": [],
        "ui": [],
        "description": "v1",
        "homepage": "",
        "download_url": "https://1.1.1.1/first.zip",
        "sha256": hashlib.sha256(first.read_bytes()).hexdigest(),
        "size": first.stat().st_size,
        "trust": "remote",
    }
    index = {
        "name": "Test",
        "updated_at": "",
        "index_url": "https://1.1.1.1/index.json",
        "packages": [entry],
    }
    monkeypatch.setattr(remote, "fetch_index", lambda url: json.loads(json.dumps(index)))
    monkeypatch.setattr(
        remote,
        "_download_archive",
        lambda url, target, sha: target.write_bytes(first.read_bytes()),
    )
    installed = client.post(
        "/packages/marketplace/install",
        json={
            "package_id": "remote-pack",
            "url": entry["download_url"],
            "sha256": entry["sha256"],
            "version": "1.2.0",
        },
    )
    assert installed.status_code == 200, installed.text
    target = game / ".hub" / "packages" / "custom" / "remote-pack"
    assert json.loads((target / "kova-package.json").read_text())["version"] == "1.2.0"

    second = tmp_path / "second.zip"
    with zipfile.ZipFile(second, "w") as archive:
        manifest = _manifest()
        manifest["version"] = "2.0.0"
        archive.writestr("kova-package.json", json.dumps(manifest))
        archive.writestr("checklist.json", json.dumps({"items": ["v2"]}))
    entry["version"] = "2.0.0"
    entry["description"] = "v2"
    entry["download_url"] = "https://1.1.1.1/second.zip"
    entry["sha256"] = hashlib.sha256(second.read_bytes()).hexdigest()
    entry["size"] = second.stat().st_size
    market = client.get("/packages/marketplace").json()
    row = market["packages"][0]
    assert row["installed_version"] == "1.2.0"
    assert row["update_available"] is True

    monkeypatch.setattr(
        remote,
        "_download_archive",
        lambda url, target, sha: target.write_bytes(second.read_bytes()),
    )
    updated = client.post(
        "/packages/marketplace/install",
        json={
            "package_id": "remote-pack",
            "url": entry["download_url"],
            "sha256": entry["sha256"],
            "version": "2.0.0",
        },
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["installed_version"] == "2.0.0"
    assert json.loads((target / "kova-package.json").read_text())["version"] == "2.0.0"
    assert json.loads((target / "checklist.json").read_text()) == {"items": ["v2"]}
    assert not (target.parent / "remote-pack.backup").exists()
