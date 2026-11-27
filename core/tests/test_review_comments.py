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
        },
    )
    assert added.status_code == 201, added.text
    comment = added.json()
    assert comment["body"] == "Слишком тёмный клинок"
    assert comment["x"] == 0.25
    assert comment["y"] == 0.8
    assert comment["resolved"] is False

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
