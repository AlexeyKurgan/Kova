import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from fastapi.testclient import TestClient

from kova_core.api.server import create_app


class _Handler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length") or 0)
        self.rfile.read(length)
        payload = (
            'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n'
            'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n'
            'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":2}}\n\n'
            "data: [DONE]\n\n"
        ).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self) -> None:
        payload = json.dumps(
            {"data": [{"id": "model-a"}, {"id": "model-b"}]}
        ).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args) -> None:
        return


def test_api_provider_run_and_key_storage(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("KOVA_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.delenv("KOVA_CORE_TOKEN", raising=False)

    server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    port = server.server_address[1]
    client = TestClient(create_app())
    try:
        game = tmp_path / "game"
        game.mkdir()
        client.post("/project/open", json={"path": str(game)})
        created = client.post(
            "/providers",
            json={
                "name": "Fake API",
                "kind": "api",
                "api_url": f"http://127.0.0.1:{port}/v1/chat/completions",
                "api_model": "fake-model",
                "api_key": "secret-key",
            },
        )
        assert created.status_code == 201, created.text
        provider = created.json()
        assert provider["kind"] == "api"
        assert provider["has_key"] is True
        assert provider["installed"] is True
        assert "secret-key" not in created.text

        listed = client.get("/providers")
        assert "secret-key" not in listed.text

        task = client.post("/tasks", json={"title": "API task"}).json()
        started = client.post(
            "/ai/runs",
            json={"task_id": task["id"], "provider": provider["id"], "snapshot": False},
        )
        assert started.status_code == 201, started.text
        run = started.json()
        final = run
        for _ in range(300):
            time.sleep(0.2)
            final = client.get(f"/ai/runs/{run['id']}").json()
            if final["status"] not in {"queued", "running"}:
                break
        assert final["status"] == "succeeded", final
        assert final["output"] == "Hello"
        assert final["usage"] == {"prompt_tokens": 10, "completion_tokens": 2}
        assert final["changes"] == []

        removed = client.delete(f"/providers/{provider['id']}")
        assert removed.status_code == 204
    finally:
        server.shutdown()
        server.server_close()


def test_token_budget_uses_real_usage(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("KOVA_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.delenv("KOVA_CORE_TOKEN", raising=False)
    server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    port = server.server_address[1]
    client = TestClient(create_app())
    try:
        game = tmp_path / "game"
        game.mkdir()
        client.post("/project/open", json={"path": str(game)})
        provider = client.post(
            "/providers",
            json={
                "name": "Budget API",
                "kind": "api",
                "api_url": f"http://127.0.0.1:{port}/v1/chat/completions",
                "api_model": "fake-model",
                "api_key": "secret",
            },
        ).json()
        task = client.post("/tasks", json={"title": "Budget task"}).json()
        started = client.post(
            "/ai/runs",
            json={"task_id": task["id"], "provider": provider["id"], "snapshot": False},
        ).json()
        for _ in range(300):
            time.sleep(0.2)
            run = client.get(f"/ai/runs/{started['id']}").json()
            if run["status"] not in {"queued", "running"}:
                break
        assert run["status"] == "succeeded"

        summary = client.get("/ai/usage").json()
        assert summary["used"] == 12
        assert summary["unknown_runs"] == 0
        assert summary["exhausted"] is False

        patched = client.patch("/project", json={"token_budget": 10})
        assert patched.json()["project"]["token_budget"] == 10
        blocked = client.post(
            "/ai/runs",
            json={"task_id": task["id"], "provider": provider["id"], "snapshot": False},
        )
        assert blocked.status_code == 400
        assert "лимит токенов" in blocked.json()["detail"]
        assert client.get("/ai/usage").json()["exhausted"] is True
    finally:
        server.shutdown()
        server.server_close()


def test_local_connector_without_key_and_model_discovery(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setenv("KOVA_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.delenv("KOVA_CORE_TOKEN", raising=False)
    server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    port = server.server_address[1]
    client = TestClient(create_app())
    try:
        game = tmp_path / "game"
        game.mkdir()
        client.post("/project/open", json={"path": str(game)})
        provider = client.post(
            "/providers",
            json={
                "name": "Local connector",
                "kind": "api",
                "api_url": f"http://127.0.0.1:{port}/v1/chat/completions",
                "api_model": "local-model",
            },
        )
        assert provider.status_code == 201, provider.text
        body = provider.json()
        assert body["installed"] is True
        assert body["has_key"] is False

        models = client.post(f"/providers/{body['id']}/models")
        assert models.status_code == 200, models.text
        assert models.json()["models"] == ["model-a", "model-b"]

        task = client.post("/tasks", json={"title": "Local API task"}).json()
        started = client.post(
            "/ai/runs",
            json={"task_id": task["id"], "provider": body["id"], "snapshot": False},
        )
        assert started.status_code == 201, started.text
        run = started.json()
        for _ in range(300):
            time.sleep(0.2)
            run = client.get(f"/ai/runs/{run['id']}").json()
            if run["status"] not in {"queued", "running"}:
                break
        assert run["status"] == "succeeded"
        assert run["output"] == "Hello"
    finally:
        server.shutdown()
        server.server_close()


class _AnthropicHandler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length") or 0)
        self.rfile.read(length)
        payload = (
            'event: message_start\n'
            'data: {"type":"message_start","message":{"usage":{"input_tokens":3}}}\n\n'
            'event: content_block_delta\n'
            'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Claude "}}\n\n'
            'data: {"type":"content_block_delta","delta":{"text":"OK"}}\n\n'
            'data: {"type":"message_delta","usage":{"output_tokens":2}}\n\n'
        ).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args) -> None:
        return


class _GoogleHandler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length") or 0)
        self.rfile.read(length)
        payload = (
            'data: {"candidates":[{"content":{"parts":[{"text":"Gemini OK"}]}}],'
            '"usageMetadata":{"promptTokenCount":4,"candidatesTokenCount":2,"totalTokenCount":6}}\n\n'
        ).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args) -> None:
        return


def _run_provider(client, task: dict, provider: dict) -> dict:
    started = client.post(
        "/ai/runs",
        json={"task_id": task["id"], "provider": provider["id"], "snapshot": False},
    )
    assert started.status_code == 201, started.text
    run = started.json()
    for _ in range(300):
        time.sleep(0.2)
        run = client.get(f"/ai/runs/{run['id']}").json()
        if run["status"] not in {"queued", "running"}:
            break
    return run


def test_catalog_and_anthropic_adapter(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("KOVA_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.delenv("KOVA_CORE_TOKEN", raising=False)
    server = ThreadingHTTPServer(("127.0.0.1", 0), _AnthropicHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    port = server.server_address[1]
    client = TestClient(create_app())
    try:
        catalog = client.get("/providers/catalog")
        assert catalog.status_code == 200
        rows = {row["id"]: row for row in catalog.json()["providers"]}
        assert rows["openai"]["available"] is True
        assert rows["azure"]["available"] is True
        assert rows["bedrock"]["available"] is True

        game = tmp_path / "game"
        game.mkdir()
        client.post("/project/open", json={"path": str(game)})
        provider = client.post(
            "/providers",
            json={
                "name": "Anthropic test",
                "kind": "api",
                "api_style": "anthropic",
                "api_url": f"http://127.0.0.1:{port}/v1/messages",
                "api_model": "claude-test",
                "api_key": "key",
                "catalog_id": "anthropic",
            },
        ).json()
        assert provider["api_style"] == "anthropic"
        task = client.post("/tasks", json={"title": "Anthropic task"}).json()
        run = _run_provider(client, task, provider)
        assert run["status"] == "succeeded", run
        assert run["output"] == "Claude OK"
        assert run["usage"] == {"input_tokens": 3, "output_tokens": 2}
        assert rows["anthropic"]["available"] is True
    finally:
        server.shutdown()
        server.server_close()


def test_google_adapter(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("KOVA_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.delenv("KOVA_CORE_TOKEN", raising=False)
    server = ThreadingHTTPServer(("127.0.0.1", 0), _GoogleHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    port = server.server_address[1]
    client = TestClient(create_app())
    try:
        game = tmp_path / "game"
        game.mkdir()
        client.post("/project/open", json={"path": str(game)})
        provider = client.post(
            "/providers",
            json={
                "name": "Google test",
                "kind": "api",
                "api_style": "google",
                "api_url": f"http://127.0.0.1:{port}/v1beta",
                "api_model": "gemini-test",
                "api_key": "key",
                "catalog_id": "google",
            },
        ).json()
        task = client.post("/tasks", json={"title": "Google task"}).json()
        run = _run_provider(client, task, provider)
        assert run["status"] == "succeeded", run
        assert run["output"] == "Gemini OK"
        assert run["usage"] == {
            "input_tokens": 4,
            "output_tokens": 2,
            "total_tokens": 6,
        }
    finally:
        server.shutdown()
        server.server_close()


def test_azure_adapter(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("KOVA_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.delenv("KOVA_CORE_TOKEN", raising=False)
    server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    port = server.server_address[1]
    client = TestClient(create_app())
    try:
        game = tmp_path / "game"
        game.mkdir()
        client.post("/project/open", json={"path": str(game)})
        provider = client.post(
            "/providers",
            json={
                "name": "Azure test",
                "kind": "api",
                "api_style": "azure",
                "api_url": (
                    f"http://127.0.0.1:{port}/openai/deployments/test/"
                    "chat/completions?api-version=2024-10-21"
                ),
                "api_model": "test",
                "api_key": "key",
                "catalog_id": "azure",
            },
        ).json()
        task = client.post("/tasks", json={"title": "Azure task"}).json()
        run = _run_provider(client, task, provider)
        assert run["status"] == "succeeded", run
        assert run["output"] == "Hello"
    finally:
        server.shutdown()
        server.server_close()


def test_sigv4_headers(monkeypatch) -> None:
    from kova_core.agents.api_provider import _sigv4_headers

    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "AKIATEST")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "secret")
    headers = _sigv4_headers(
        "POST",
        "bedrock-runtime.us-east-1.amazonaws.com",
        "/model/test/invoke",
        "us-east-1",
        "bedrock",
        b"{}",
    )
    assert headers["Authorization"].startswith("AWS4-HMAC-SHA256 Credential=AKIATEST/")
    assert "x-amz-content-sha256" in headers
