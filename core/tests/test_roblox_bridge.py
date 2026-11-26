from pathlib import Path

from fastapi.testclient import TestClient

from kova_core.api.server import create_app
from kova_core.integrations.roblox.bridge import BRIDGE


def make_client(tmp_path: Path, monkeypatch) -> TestClient:
    monkeypatch.setenv("KOVA_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "local"))
    monkeypatch.delenv("KOVA_CORE_TOKEN", raising=False)
    return TestClient(create_app())


def test_roblox_bridge_protocol(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    installed = client.post("/roblox/install-plugin")
    assert installed.status_code == 200, installed.text
    path = Path(installed.json()["path"])
    assert path.is_file()
    source = path.read_text(encoding="utf-8")
    assert "__KOVA_TOKEN__" not in source
    assert "Kova Bridge" in source

    status = client.get("/roblox/status").json()
    assert status["connected"] is False
    assert status["token_configured"] is True

    sent = client.post(
        "/roblox/execute",
        json={
            "command": {
                "type": "create_script",
                "service": "ServerScriptService",
                "name": "KovaBootstrap",
                "source": 'print("Kova works")',
            }
        },
    )
    assert sent.status_code == 200, sent.text
    command_id = sent.json()["id"]

    token = BRIDGE.token()
    assert client.get("/roblox/commands").status_code == 403
    command = client.get(
        "/roblox/commands",
        headers={"X-Kova-Roblox-Token": token},
    ).json()["command"]
    assert command["id"] == command_id
    assert command["type"] == "create_script"
    assert command["service"] == "ServerScriptService"

    result = client.post(
        "/roblox/results",
        headers={"X-Kova-Roblox-Token": token},
        json={
            "id": command_id,
            "ok": True,
            "result": "ServerScriptService.KovaBootstrap",
            "plugin_version": "0.1.0",
        },
    )
    assert result.status_code == 200, result.text
    assert result.json()["ok"] is True
    assert client.get(f"/roblox/result/{command_id}").json()["ok"] is True
    assert client.get("/roblox/status").json()["connected"] is True


def test_roblox_rejects_unknown_command(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    response = client.post("/roblox/execute", json={"command": {"type": "nope"}})
    assert response.status_code == 400
