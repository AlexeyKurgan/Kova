import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from fastapi.testclient import TestClient

from kova_core.api.server import create_app


class _Handler(BaseHTTPRequestHandler):
    responses: list[str] = []
    index = 0

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length") or 0)
        self.rfile.read(length)
        cls = type(self)
        if cls.index >= len(cls.responses):
            content = '{"final":"done"}'
        else:
            content = cls.responses[cls.index]
            cls.index += 1
        payload = (
            "data: "
            + json.dumps({"choices": [{"delta": {"content": content}}]})
            + "\n\ndata: [DONE]\n\n"
        ).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args) -> None:
        return


def _client(tmp_path: Path, monkeypatch, responses: list[str]) -> tuple[TestClient, ThreadingHTTPServer, dict]:
    monkeypatch.setenv("KOVA_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.delenv("KOVA_CORE_TOKEN", raising=False)
    _Handler.responses = responses
    _Handler.index = 0
    server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    port = server.server_address[1]
    client = TestClient(create_app())
    game = tmp_path / "game"
    game.mkdir()
    client.post("/project/open", json={"path": str(game)})
    provider = client.post(
        "/providers",
        json={
            "name": "Native test",
            "kind": "api",
            "api_url": f"http://127.0.0.1:{port}/v1/chat/completions",
            "api_model": "fake",
            "api_key": "key",
            "api_style": "openai",
        },
    ).json()
    return client, server, provider


def _wait(client: TestClient, run: dict) -> dict:
    for _ in range(300):
        time.sleep(0.2)
        run = client.get(f"/ai/runs/{run['id']}").json()
        if run["status"] not in {"queued", "running", "waiting_approval"}:
            return run
    return run


def test_native_agent_reads_and_writes(tmp_path: Path, monkeypatch) -> None:
    responses = [
        '{"tool":"read_file","args":{"path":"base.txt"}}',
        '{"tool":"write_file","args":{"path":"out.txt","content":"from tool"}}',
        '{"final":"done"}',
    ]
    client, server, provider = _client(tmp_path, monkeypatch, responses)
    game = tmp_path / "game"
    (game / "base.txt").write_text("hello", encoding="utf-8")
    try:
        task = client.post("/tasks", json={"title": "Native task"}).json()
        started = client.post(
            "/ai/runs",
            json={
                "task_id": task["id"],
                "provider": provider["id"],
                "snapshot": False,
                "tool_policy": "workspace",
            },
        )
        assert started.status_code == 201, started.text
        run = started.json()
        for _ in range(300):
            time.sleep(0.2)
            run = client.get(f"/ai/runs/{run['id']}").json()
            if run["status"] == "waiting_approval":
                break
        assert run["status"] == "waiting_approval", run
        assert run["approval"]["tool"] == "write_file"
        approved = client.post(
            f"/ai/runs/{run['id']}/approval", json={"decision": "allow"}
        )
        assert approved.status_code == 200, approved.text
        run = _wait(client, run)
        assert run["status"] == "succeeded", run
        assert (game / "out.txt").read_text(encoding="utf-8") == "from tool"
        assert run["output"].endswith("done")
        assert [action["value"] for action in run["actions"]] == ["base.txt", "out.txt"]
        assert run["actions"][1]["change"] == "write"
    finally:
        server.shutdown()
        server.server_close()


def test_native_read_only_blocks_write(tmp_path: Path, monkeypatch) -> None:
    responses = [
        '{"tool":"write_file","args":{"path":"blocked.txt","content":"no"}}',
        '{"final":"blocked"}',
    ]
    client, server, provider = _client(tmp_path, monkeypatch, responses)
    game = tmp_path / "game"
    try:
        task = client.post("/tasks", json={"title": "Read only task"}).json()
        started = client.post(
            "/ai/runs",
            json={
                "task_id": task["id"],
                "provider": provider["id"],
                "snapshot": False,
                "tool_policy": "read-only",
            },
        ).json()
        run = _wait(client, started)
        assert run["status"] == "succeeded", run
        assert not (game / "blocked.txt").exists()
        assert run["output"].endswith("blocked")
        assert run["tool_policy"] == "read-only"
    finally:
        server.shutdown()
        server.server_close()


def test_run_command_policy(tmp_path: Path) -> None:
    import sys

    from kova_core.agents.tools import run_tool

    root = tmp_path / "project"
    root.mkdir()
    command = f'"{sys.executable}" -c "open(\'cmd.txt\', \'w\').write(\'ok\')"'
    denied = run_tool("run_command", {"command": command}, root, "workspace")
    assert denied["ok"] is False
    assert not (root / "cmd.txt").exists()
    allowed = run_tool("run_command", {"command": command}, root, "auto")
    assert allowed["ok"] is True
    assert (root / "cmd.txt").read_text(encoding="utf-8") == "ok"


def test_native_deny_stops_run(tmp_path: Path, monkeypatch) -> None:
    responses = [
        '{"tool":"write_file","args":{"path":"denied.txt","content":"no"}}',
        '{"final":"should not happen"}',
    ]
    client, server, provider = _client(tmp_path, monkeypatch, responses)
    game = tmp_path / "game"
    try:
        task = client.post("/tasks", json={"title": "Deny task"}).json()
        started = client.post(
            "/ai/runs",
            json={
                "task_id": task["id"],
                "provider": provider["id"],
                "snapshot": False,
                "tool_policy": "workspace",
            },
        ).json()
        run = started
        for _ in range(300):
            time.sleep(0.2)
            run = client.get(f"/ai/runs/{run['id']}").json()
            if run["status"] == "waiting_approval":
                break
        assert run["status"] == "waiting_approval", run
        denied = client.post(
            f"/ai/runs/{run['id']}/approval", json={"decision": "deny"}
        )
        assert denied.status_code == 200
        run = _wait(client, run)
        assert run["status"] == "cancelled", run
        assert not (game / "denied.txt").exists()
    finally:
        server.shutdown()
        server.server_close()
