from pathlib import Path

from fastapi.testclient import TestClient

from kova_core.api.server import create_app


def test_media_accepts_query_token(tmp_path: Path, monkeypatch) -> None:
    token = "test-owner-token"
    monkeypatch.setenv("KOVA_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("KOVA_CORE_TOKEN", token)
    client = TestClient(create_app())
    auth = {"X-Kova-Token": token}

    game = tmp_path / "game"
    game.mkdir()
    assert client.post("/project/open", json={"path": str(game)}, headers=auth).status_code == 200
    source = tmp_path / "icon.png"
    source.write_bytes(b"png-bytes")
    asset = client.post(
        "/assets/import",
        json={"path": str(source)},
        headers=auth,
    ).json()

    hub = game / ".hub"
    preview = hub / "artifacts" / "previews" / f"{asset['id']}.png"
    preview.parent.mkdir(parents=True, exist_ok=True)
    preview.write_bytes(b"preview-bytes")
    stored = client.get(f"/assets/{asset['id']}", headers=auth).json()
    stored["preview"] = f"artifacts/previews/{asset['id']}.png"
    asset_file = hub / "assets" / f"{asset['id']}.json"
    asset_file.write_text(
        __import__("json").dumps(stored),
        encoding="utf-8",
    )

    assert client.get(f"/assets/{asset['id']}/preview").status_code == 401
    assert (
        client.get(f"/assets/{asset['id']}/preview?token={token}").content
        == b"preview-bytes"
    )
    assert (
        client.get(
            f"/assets/{asset['id']}/preview",
            headers=auth,
        ).content
        == b"preview-bytes"
    )
    # Query token is not accepted for non-media endpoints.
    assert client.get(f"/assets?token={token}").status_code == 401
