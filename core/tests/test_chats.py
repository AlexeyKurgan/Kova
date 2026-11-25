import sys
import time
from pathlib import Path

from fastapi.testclient import TestClient

from kova_core.api.server import create_app


def make_client(tmp_path: Path, monkeypatch) -> TestClient:
    monkeypatch.setenv("KOVA_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.delenv("KOVA_CORE_TOKEN", raising=False)
    return TestClient(create_app())


def test_project_chat_with_context(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    client.post("/project/open", json={"path": str(game), "name": "Chat Game"})
    task = client.post("/tasks", json={"title": "Сделать меч", "goal": "Меч для игрока"}).json()
    provider = client.post(
        "/providers",
        json={
            "name": "Chat CLI",
            "command": sys.executable,
            "args": [
                "-c",
                "import sys, pathlib; pathlib.Path('chat_prompt.txt').write_text(sys.argv[1], encoding='utf-8'); print('Ответ ассистента')",
            ],
        },
    ).json()

    created = client.post(
        "/chats",
        json={"provider_id": provider["id"], "scope": "task", "task_id": task["id"]},
    )
    assert created.status_code == 201
    chat = created.json()
    long_text = "Что делаем дальше? " + ("x" * 3000) + " MARKER_AT_END"
    sent = client.post(
        f"/chats/{chat['id']}/messages",
        json={"text": long_text},
    )
    assert sent.status_code == 200, sent.text

    final = None
    for _ in range(300):
        time.sleep(0.2)
        final = client.get(f"/chats/{chat['id']}").json()
        if final["status"] != "running":
            break
    assert final is not None
    assert final["status"] == "idle", final
    assert [message["role"] for message in final["messages"]] == ["user", "assistant"]
    assert "Ответ ассистента" in final["messages"][1]["content"]
    prompt = (game / "chat_prompt.txt").read_text(encoding="utf-8")
    assert "Сделать меч" in prompt
    assert "Chat Game" in prompt
    assert "Что делаем дальше?" in prompt
    assert "MARKER_AT_END" in prompt

    listed = client.get("/chats").json()
    assert listed[0]["message_count"] == 2
    assert client.delete(f"/chats/{chat['id']}").status_code == 204
    assert client.get("/chats").json() == []


def test_chat_action_create_task(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    client.post("/project/open", json={"path": str(game), "name": "Action Game"})
    script = tmp_path / "emit_action.py"
    script.write_text(
        "print('Предлагаю создать задачу.')\n"
        "print('```kova-action')\n"
        "print('{\"action\":\"create_task\",\"title\":\"Квест\",\"goal\":\"Сделать квест\",\"criteria\":[\"Квест играется\"]}')\n"
        "print('```')\n",
        encoding="utf-8",
    )
    provider = client.post(
        "/providers",
        json={
            "name": "Action CLI",
            "command": sys.executable,
            "args": [str(script)],
        },
    ).json()
    chat = client.post(
        "/chats",
        json={"title": "Action", "provider_id": provider["id"]},
    ).json()
    client.post(f"/chats/{chat['id']}/messages", json={"text": "создай задачу"})
    final = None
    for _ in range(300):
        time.sleep(0.2)
        final = client.get(f"/chats/{chat['id']}").json()
        if final["status"] != "running":
            break
    assert final is not None
    message = final["messages"][-1]
    assert "```kova-action" not in message["content"]
    assert len(message["actions"]) == 1
    action = message["actions"][0]
    assert action["status"] == "pending"
    assert action["type"] == "create_task"

    approved = client.post(
        f"/chats/{chat['id']}/actions/{action['id']}",
        json={"decision": "approve"},
    )
    assert approved.status_code == 200, approved.text
    updated = approved.json()["messages"][-1]["actions"][0]
    assert updated["status"] == "approved", updated
    assert updated["result"]["task_id"].startswith("task_")
    tasks = client.get("/tasks").json()
    assert [task["title"] for task in tasks] == ["Квест"]

    second = client.post(
        f"/chats/{chat['id']}/actions/{action['id']}",
        json={"decision": "approve"},
    )
    assert second.status_code == 409


def test_chat_action_update_task(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    client.post("/project/open", json={"path": str(game), "name": "Update Game"})
    task = client.post("/tasks", json={"title": "Старая", "goal": "Цель"}).json()
    script = tmp_path / "emit_update.py"
    script.write_text(
        "print('Обновляю.')\n"
        "print('```kova-action')\n"
        "print('{\"action\":\"update_task\",\"task_id\":\"%s\",\"status\":\"ready\",\"next_step\":\"Проверить\"}')\n"
        "print('```')\n" % task["id"],
        encoding="utf-8",
    )
    provider = client.post(
        "/providers",
        json={"name": "Update CLI", "command": sys.executable, "args": [str(script)]},
    ).json()
    chat = client.post("/chats", json={"title": "Update", "provider_id": provider["id"]}).json()
    client.post(f"/chats/{chat['id']}/messages", json={"text": "обнови"})
    final = None
    for _ in range(300):
        time.sleep(0.2)
        final = client.get(f"/chats/{chat['id']}").json()
        if final["status"] != "running":
            break
    action = final["messages"][-1]["actions"][0]
    approved = client.post(
        f"/chats/{chat['id']}/actions/{action['id']}",
        json={"decision": "approve"},
    ).json()
    assert approved["messages"][-1]["actions"][0]["status"] == "approved"
    updated = next(item for item in client.get("/tasks").json() if item["id"] == task["id"])
    assert updated["status"] == "ready"
    assert updated["next_step"] == "Проверить"


def test_chat_parses_jsonl_cli_output(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    client.post("/project/open", json={"path": str(game), "name": "JSONL Game"})
    script = tmp_path / "emit_jsonl.py"
    script.write_text(
        "import json\n"
        "print(json.dumps({'type':'step_start','part':{'type':'step-start'}}))\n"
        "print(json.dumps({'type':'text','part':{'type':'text','text':'Привет! Я на связи.'}}))\n"
        "print(json.dumps({'type':'step_finish','part':{'type':'step-finish'}}))\n",
        encoding="utf-8",
    )
    provider = client.post(
        "/providers",
        json={
            "name": "JSONL CLI",
            "command": sys.executable,
            "args": [str(script)],
            "output_mode": "jsonl-auto",
        },
    ).json()
    chat = client.post(
        "/chats",
        json={"title": "JSONL", "provider_id": provider["id"]},
    ).json()
    client.post(f"/chats/{chat['id']}/messages", json={"text": "привет"})
    final = None
    for _ in range(300):
        time.sleep(0.2)
        final = client.get(f"/chats/{chat['id']}").json()
        if final["status"] != "running":
            break
    assert final is not None
    content = final["messages"][-1]["content"]
    assert content == "Привет! Я на связи."
    assert "step_start" not in content


def test_chat_attachments(tmp_path: Path, monkeypatch) -> None:
    import base64

    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    client.post("/project/open", json={"path": str(game), "name": "Media Game"})
    provider = client.post(
        "/providers",
        json={
            "name": "Media CLI",
            "command": sys.executable,
            "args": [
                "-c",
                "import sys, pathlib; pathlib.Path('media_prompt.txt').write_text(sys.argv[1], encoding='utf-8'); print('ok')",
            ],
        },
    ).json()
    chat = client.post("/chats", json={"title": "Media", "provider_id": provider["id"]}).json()
    text_data = base64.b64encode("важная заметка".encode("utf-8")).decode("ascii")
    image_data = base64.b64encode(
        base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII="
        )
    ).decode("ascii")
    sent = client.post(
        f"/chats/{chat['id']}/messages",
        json={
            "text": "смотри вложения",
            "attachments": [
                {"name": "note.txt", "mime": "text/plain", "data": text_data},
                {"name": "pixel.png", "mime": "image/png", "data": image_data},
            ],
        },
    )
    assert sent.status_code == 200, sent.text
    final = None
    for _ in range(300):
        time.sleep(0.2)
        final = client.get(f"/chats/{chat['id']}").json()
        if final["status"] != "running":
            break
    assert final is not None
    message = final["messages"][0]
    assert len(message["attachments"]) == 2
    assert {item["kind"] for item in message["attachments"]} == {"text", "image"}
    prompt = (game / "media_prompt.txt").read_text(encoding="utf-8")
    assert "note.txt" in prompt
    assert "важная заметка" in prompt
    assert "pixel.png" in prompt
    attachment_id = message["attachments"][0]["id"]
    served = client.get(f"/chats/{chat['id']}/attachments/{attachment_id}")
    assert served.status_code == 200
    assert served.content
