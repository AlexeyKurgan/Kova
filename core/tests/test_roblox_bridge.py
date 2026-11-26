import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from kova_core.api.server import create_app
from kova_core.integrations.roblox.bridge import BRIDGE


def make_client(tmp_path: Path, monkeypatch) -> TestClient:
    monkeypatch.setenv("KOVA_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "local"))
    monkeypatch.delenv("KOVA_CORE_TOKEN", raising=False)
    monkeypatch.delenv("KOVA_ROBLOX_TOKEN", raising=False)
    monkeypatch.delenv("KOVA_ROBLOX_STUDIO", raising=False)
    BRIDGE.reset()
    return TestClient(create_app())


@pytest.fixture(autouse=True)
def clean_bridge() -> None:
    BRIDGE.reset()
    yield
    BRIDGE.reset()


def test_roblox_bridge_protocol(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    installed = client.post("/roblox/install-plugin")
    assert installed.status_code == 200, installed.text
    path = Path(installed.json()["path"])
    assert path.is_file()
    source = path.read_text(encoding="utf-8")
    assert "__KOVA_TOKEN__" not in source
    assert "__KOVA_PROTOCOL__" not in source
    assert "local PROTOCOL = 2" in source
    assert "Kova Bridge" in source

    status = client.get("/roblox/status").json()
    assert status["connected"] is False
    assert status["token_configured"] is True
    assert status["protocol"] == 2
    assert "upload_mesh" in status["capabilities"]
    assert status["plugin_installed"] is True

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
            "plugin_version": "0.3.0",
            "protocol": 2,
        },
    )
    assert result.status_code == 200, result.text
    assert result.json()["ok"] is True
    assert client.get(f"/roblox/result/{command_id}").json()["ok"] is True
    refreshed = client.get("/roblox/status").json()
    assert refreshed["connected"] is True
    assert refreshed["plugin_version"] == "0.3.0"
    assert refreshed["protocol"] == 2


def test_roblox_rejects_unknown_command(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    response = client.post("/roblox/execute", json={"command": {"type": "nope"}})
    assert response.status_code == 400


def test_roblox_rejects_unsafe_commands(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    cases = [
        {
            "type": "create_script",
            "service": "NotAService",
            "name": "Bad",
            "source": "",
        },
        {
            "type": "create_script",
            "service": "ServerScriptService",
            "name": "../Bad",
            "source": "",
        },
        {
            "type": "set_source",
            "path": "ServerScriptService.Bad",
            "source": "x" * 200_001,
        },
        {
            "type": "upload_mesh",
            "positions": [[0, 0, 0]],
            "triangles": [[1, 1, 1]] * 20_001,
        },
        {
            "type": "batch",
            "commands": [{"type": "batch", "commands": [{"type": "ping"}]}],
        },
        {
            "type": "set_properties",
            "path": "Workspace.Baseplate",
            "properties": {"Parent": None},
        },
        {
            "type": "create_mesh_part",
            "asset_id": "rbxassetid://1",
        },
    ]
    for command in cases:
        response = client.post("/roblox/execute", json={"command": command})
        assert response.status_code == 400, (command["type"], response.text)


def test_roblox_command_expiry(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    sent = client.post("/roblox/execute", json={"command": {"type": "ping"}})
    assert sent.status_code == 200
    command_id = sent.json()["id"]
    BRIDGE._queue[0]["_expires"] = 0
    token = BRIDGE.token()
    command = client.get(
        "/roblox/commands",
        headers={"X-Kova-Roblox-Token": token},
    ).json()
    assert command["command"] is None
    result = client.get(f"/roblox/result/{command_id}").json()
    assert result["ok"] is False
    assert "истекла" in result["error"]


def test_roblox_events(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    token = BRIDGE.token()
    response = client.post(
        "/roblox/event",
        headers={"X-Kova-Roblox-Token": token},
        json={"kind": "playtest_done", "ok": True, "result": "KovaSmoke"},
    )
    assert response.status_code == 200, response.text
    status = client.get("/roblox/status").json()
    assert status["recent_events"][-1]["kind"] == "playtest_done"
    assert status["recent_events"][-1]["ok"] is True


def test_roblox_studio_detection(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    local = tmp_path / "local"
    version = local / "Roblox" / "Versions" / "version-test"
    version.mkdir(parents=True)
    executable = version / "RobloxStudioBeta.exe"
    executable.write_bytes(b"test")
    plugin = local / "Roblox" / "Plugins" / "KovaBridge.lua"
    plugin.parent.mkdir(parents=True)
    plugin.write_text("-- test", encoding="utf-8")
    status = client.get("/roblox/status").json()
    assert status["studio_installed"] is True
    assert status["studio_path"] == str(executable)
    assert status["plugin_installed"] is True


def test_roblox_launch_rejects_missing_place(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    local = tmp_path / "local"
    version = local / "Roblox" / "Versions" / "version-test"
    version.mkdir(parents=True)
    (version / "RobloxStudioBeta.exe").write_bytes(b"test")
    response = client.post(
        "/roblox/launch",
        json={"place_path": str(tmp_path / "missing.rbxlx")},
    )
    assert response.status_code == 400
    assert "not found" in response.json()["detail"]


def test_roblox_build_place(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    project = tmp_path / "Uncharted 3D"
    (project / "assets" / "models" / "sword").mkdir(parents=True)
    (project / "src" / "ServerScriptService").mkdir(parents=True)
    (project / "assets" / "models" / "sword" / "sword.meta.json").write_text(
        json.dumps({"roblox": {"asset_id": "102749949850689"}}),
        encoding="utf-8",
    )
    (project / "src" / "ServerScriptService" / "KovaBootstrap.server.lua").write_text(
        'print("Кова работает")', encoding="utf-8"
    )
    response = client.post(
        "/roblox/build-place",
        json={"project_path": str(project), "launch": False},
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["asset_id"] == "102749949850689"
    output = Path(data["path"])
    assert output.is_file()
    text = output.read_text(encoding="utf-8")
    assert "rbxassetid://102749949850689" in text
    assert "Кова работает" in text
    assert "<Item class=\"MeshPart\"" in text


def test_roblox_build_place_rejects_missing_project(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    response = client.post(
        "/roblox/build-place",
        json={"project_path": str(tmp_path / "missing"), "launch": False},
    )
    assert response.status_code == 400
