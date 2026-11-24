from pathlib import Path

from fastapi.testclient import TestClient

from kova_core.api.server import create_app


def make_client(tmp_path: Path, monkeypatch) -> TestClient:
    monkeypatch.setenv("KOVA_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.delenv("KOVA_CORE_TOKEN", raising=False)
    return TestClient(create_app())


def test_capsule_response_review_loop(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    client.post("/project/open", json={"path": str(game), "name": "Demo", "engine": "roblox"})

    task = client.post(
        "/tasks",
        json={
            "title": "Сундук",
            "engine": "roblox",
            "goal": "Низкополигональный сундук",
            "criteria": ["≤ 800 треугольников", "пивот внизу"],
            "constraints": ["стиль проекта"],
        },
    ).json()
    task_id = task["id"]

    capsule = client.post(f"/tasks/{task_id}/capsule")
    assert capsule.status_code == 200
    text = capsule.json()["text"]
    assert "Сундук" in text
    assert "≤ 800 треугольников" in text
    assert "Формат ответа" in text
    capsule_id = capsule.json()["capsule"]["id"]
    assert (game / ".hub" / "capsules" / f"{capsule_id}.md").is_file()

    response_text = "Готово: chest.blend\n- 780 треугольников\n- пивот внизу"
    imported = client.post(f"/tasks/{task_id}/response", json={"text": response_text})
    assert imported.status_code == 201
    result = imported.json()
    assert result["task"]["status"] == "review"
    review_id = result["review"]["id"]
    assert result["review"]["status"] == "pending"
    assert (game / ".hub" / result["artifact_path"]).is_file()

    inbox = client.get("/review")
    assert inbox.status_code == 200
    assert [item["id"] for item in inbox.json()] == [review_id]

    preview = client.get(f"/review/{review_id}/response")
    assert preview.status_code == 200
    assert preview.json()["text"] == response_text

    accepted = client.post(f"/review/{review_id}/accept")
    assert accepted.status_code == 200
    assert accepted.json()["status"] == "accepted"
    assert client.get("/review").json() == []
    assert client.get("/tasks").json()[0]["status"] == "done"

    ledger = client.get("/ledger")
    assert ledger.status_code == 200
    types = [event["type"] for event in ledger.json()]
    assert types[0] == "review.accepted"
    assert "response.imported" in types
    assert "capsule.created" in types
    assert "task.created" in types


def test_rework_returns_task_to_work(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    client.post("/project/open", json={"path": str(game)})

    task = client.post("/tasks", json={"title": "Меч"}).json()
    imported = client.post(f"/tasks/{task['id']}/response", json={"text": "вариант 1"}).json()
    review_id = imported["review"]["id"]

    reworked = client.post(f"/review/{review_id}/rework")
    assert reworked.status_code == 200
    assert reworked.json()["status"] == "rework"
    assert client.get("/tasks").json()[0]["status"] == "working"
    assert [item["id"] for item in client.get("/review").json()] == [review_id]

    second = client.post(f"/tasks/{task['id']}/response", json={"text": "вариант 2"}).json()
    assert second["review"]["id"] != review_id
    assert len(client.get("/review").json()) == 2
