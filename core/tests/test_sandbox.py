from fastapi.testclient import TestClient

from kova_core.api.server import create_app


def test_sandbox_status(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("KOVA_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.delenv("KOVA_CORE_TOKEN", raising=False)
    client = TestClient(create_app())
    response = client.get("/sandbox")
    assert response.status_code == 200
    payload = response.json()
    assert {row["id"] for row in payload["backends"]} == {
        "docker",
        "wsl",
        "windows-sandbox",
    }
    assert payload["fallback"]
    assert payload["default"] in {row["id"] for row in payload["backends"]} | {"copy"}
    assert payload["message"]
