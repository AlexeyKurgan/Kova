from pathlib import Path

from fastapi.testclient import TestClient

from kova_core.api.server import create_app
from kova_core.domain.review import ReviewItem
from kova_core.storage.review import save_review


def make_client(tmp_path: Path, monkeypatch) -> TestClient:
    monkeypatch.setenv("KOVA_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.delenv("KOVA_CORE_TOKEN", raising=False)
    return TestClient(create_app())


def test_review_comment_thread(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    opened = client.post("/project/open", json={"path": str(game), "engine": "roblox"})
    assert opened.status_code == 200
    hub = game / ".hub"

    task = client.post("/tasks", json={"title": "Sword review"}).json()
    review = save_review(hub, ReviewItem(task_id=task["id"], summary="Sword v2"))

    source = tmp_path / "sword.glb"
    source.write_bytes(b"glb")
    asset = client.post(
        "/assets/import",
        json={"path": str(source), "engine": "roblox"},
    ).json()
    version_id = asset["versions"][0]["id"]

    added = client.post(
        f"/review/{review.id}/comments",
        json={
            "body": "  Слишком тёмный клинок  ",
            "asset_id": asset["id"],
            "version_id": version_id,
            "x": 0.25,
            "y": 0.8,
            "timestamp": 3.5,
        },
    )
    assert added.status_code == 201, added.text
    comment = added.json()
    assert comment["body"] == "Слишком тёмный клинок"
    assert comment["x"] == 0.25
    assert comment["y"] == 0.8
    assert comment["resolved"] is False
    assert comment["timestamp"] == 3.5

    listed = client.get(f"/review/{review.id}/comments")
    assert listed.status_code == 200
    assert [row["id"] for row in listed.json()] == [comment["id"]]

    resolved = client.patch(
        f"/review/{review.id}/comments/{comment['id']}",
        json={"resolved": True},
    )
    assert resolved.status_code == 200
    assert resolved.json()["resolved"] is True

    assert (
        client.post(
            f"/review/{review.id}/comments",
            json={"body": "   "},
        ).status_code
        == 422
    )
    assert (
        client.post(
            f"/review/{review.id}/comments",
            json={"body": "bad asset", "asset_id": "asst_missing"},
        ).status_code
        == 404
    )

    removed = client.delete(f"/review/{review.id}/comments/{comment['id']}")
    assert removed.status_code == 204
    assert client.get(f"/review/{review.id}/comments").json() == []
    assert client.delete(f"/review/{review.id}/comments/{comment['id']}").status_code == 404

    opinion = client.post(f"/review/{review.id}/second-opinion")
    assert opinion.status_code == 200, opinion.text
    prompt = opinion.json()["text"]
    assert "независимый критик" in prompt
    assert task["title"] in prompt
    assert "Sword review" in prompt
    assert "Sword" in prompt

    accepted = client.post(f"/review/{review.id}/accept")
    assert accepted.status_code == 200, accepted.text
    assert client.get("/review").json() == []
    archive = client.get("/review/archive").json()
    assert [row["id"] for row in archive] == [review.id]


def test_review_video_media_and_timestamp_bounds(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    client.post("/project/open", json={"path": str(game)})
    task = client.post("/tasks", json={"title": "Video review"}).json()
    review = save_review(game / ".hub", ReviewItem(task_id=task["id"], summary="Clip"))

    source = tmp_path / "clip.mp4"
    payload = b"\x00\x00\x00\x18ftypmp42" + b"0" * 512
    source.write_bytes(payload)
    asset = client.post("/assets/import", json={"path": str(source)}).json()
    assert asset["type"] == "video"
    version = asset["versions"][0]["id"]

    media = client.get(f"/assets/{asset['id']}/media")
    assert media.status_code == 200
    assert media.headers["content-type"].startswith("video/mp4")
    ranged = client.get(
        f"/assets/{asset['id']}/media",
        headers={"Range": "bytes=0-15"},
    )
    assert ranged.status_code == 206
    assert ranged.content == payload[:16]

    added = client.post(
        f"/review/{review.id}/comments",
        json={"body": "Поправить кадр", "asset_id": asset["id"], "version_id": version, "timestamp": 1.25},
    )
    assert added.status_code == 201, added.text
    assert added.json()["timestamp"] == 1.25

    bad = client.post(
        f"/review/{review.id}/comments",
        json={"body": "too late", "timestamp": 90000},
    )
    assert bad.status_code == 422


def test_animation_frame_pins_and_preview(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    client.post("/project/open", json={"path": str(game)})
    task = client.post("/tasks", json={"title": "Animation review"}).json()
    review = save_review(game / ".hub", ReviewItem(task_id=task["id"], summary="Swing"))

    png = bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
        "890000000d49444154789c6360000000020001e221bc330000000049454e44ae426082"
    )
    source = tmp_path / "swing.fbx"
    source.write_bytes(b"fbx")
    asset = client.post("/assets/import", json={"path": str(source)}).json()

    from kova_core.domain.asset import AssetPreviewFrame
    from kova_core.storage.assets import get_asset, save_asset, sync_current_version

    hub = game / ".hub"
    stored = get_asset(hub, asset["id"])
    assert stored is not None
    frame_path = hub / "artifacts" / "previews" / "anim" / "frame_0012.png"
    frame_path.parent.mkdir(parents=True)
    frame_path.write_bytes(png)
    stored.preview_frames = [
        AssetPreviewFrame(frame=12, path=frame_path.relative_to(hub).as_posix())
    ]
    stored.frame_start = 1
    stored.frame_end = 24
    stored.fps = 24
    sync_current_version(stored)
    save_asset(hub, stored)

    preview = client.get(f"/assets/{asset['id']}/preview", params={"frame": 12})
    assert preview.status_code == 200
    assert preview.headers["content-type"].startswith("image/png")
    missing = client.get(f"/assets/{asset['id']}/preview", params={"frame": 99})
    assert missing.status_code == 404

    version_id = stored.versions[0].id
    added = client.post(
        f"/review/{review.id}/comments",
        json={
            "body": "Поправить замах",
            "asset_id": asset["id"],
            "version_id": version_id,
            "frame": 12,
        },
    )
    assert added.status_code == 201, added.text
    assert added.json()["frame"] == 12
    bad = client.post(
        f"/review/{review.id}/comments",
        json={"body": "bad frame", "frame": -1},
    )
    assert bad.status_code == 422
