from pathlib import Path

from fastapi.testclient import TestClient

from kova_core.api.server import create_app


def make_client(tmp_path: Path, monkeypatch) -> TestClient:
    monkeypatch.setenv("KOVA_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.delenv("KOVA_CORE_TOKEN", raising=False)
    return TestClient(create_app())


def test_task_explanation_prompt(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    client.post("/project/open", json={"path": str(game)})
    task = client.post(
        "/tasks",
        json={
            "title": "Починить пивот меча",
            "goal": "Пивот должен быть у рукояти",
            "criteria": ["Пивот внизу", "Масштаб 1.0"],
        },
    ).json()

    response = client.post(f"/tasks/{task['id']}/explain")
    assert response.status_code == 200, response.text
    prompt = response.json()["text"]
    assert "наставник" in prompt
    assert task["title"] in prompt
    assert "Пивот должен быть у рукояти" in prompt
    assert "Что проверить руками" in prompt
    assert client.post("/tasks/task_missing/explain").status_code == 404
