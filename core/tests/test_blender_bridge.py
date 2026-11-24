from pathlib import Path

from fastapi.testclient import TestClient

from kova_core.api.server import create_app
from kova_core.integrations.blender.addon_install import (
    ADDON_MODULE,
    STARTUP_NAME,
    addon_state,
    install_legacy,
)
from kova_core.integrations.blender.client import connection_state
from kova_core.integrations.blender.discovery import data_dir


def make_client(tmp_path: Path, monkeypatch) -> TestClient:
    monkeypatch.setenv("KOVA_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.delenv("KOVA_CORE_TOKEN", raising=False)
    return TestClient(create_app())


def test_workspace_scaffold_and_model(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    client.post("/project/open", json={"path": str(game), "engine": "roblox"})

    workspace = client.post("/blender/workspace")
    assert workspace.status_code == 200
    data = workspace.json()
    assert data["exists"] is True
    assert data["path"] == "Blender"
    root = game / "Blender"
    assert (root / "ModelScripts").is_dir()
    assert (root / "Models").is_dir()
    assert (root / "Checks").is_dir()
    assert (root / "AGENTS.md").is_file()
    assert (root / "adapters" / "ROBLOX_RULES.txt").is_file()

    created = client.post("/blender/models", json={"name": "Chest"})
    assert created.status_code == 201
    script = root / "ModelScripts" / "Chest" / "Chest.py"
    assert script.is_file()
    assert "MODEL = \"Chest\"" in script.read_text(encoding="utf-8")

    again = client.post("/blender/models", json={"name": "Chest"})
    assert again.status_code == 201
    assert len(list((root / "ModelScripts" / "Chest").glob("*.py"))) == 1

    invalid = client.post("/blender/models", json={"name": "../escape"})
    assert invalid.status_code == 400

    listed = client.get("/blender/workspace").json()
    assert [item["name"] for item in listed["scripts"]] == ["Chest"]


def test_skills_available(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)

    listed = client.get("/blender/skills")
    assert listed.status_code == 200
    names = {item["name"] for item in listed.json()}
    assert "blender-core" in names
    assert "blender-asset-qa" in names
    assert len(names) >= 20

    detail = client.get("/blender/skills/blender-core")
    assert detail.status_code == 200
    payload = detail.json()
    assert payload["name"] == "blender-core"
    assert payload["group"] == "core"
    assert payload["content"].startswith("---")

    missing = client.get("/blender/skills/not-a-skill")
    assert missing.status_code == 404


def test_status_reports_addon_fields(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("KOVA_HUB_BLENDER_DATA", str(tmp_path / "blender-data"))
    client = make_client(tmp_path, monkeypatch)
    response = client.get("/blender/status")
    assert response.status_code == 200
    data = response.json()
    for key in ("installed", "path", "version", "addon_installed", "connected", "workspace"):
        assert key in data


def test_discovery_without_addon(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("KOVA_HUB_BLENDER_DATA", str(tmp_path / "blender-data"))
    assert connection_state()["connected"] is False
    assert data_dir() == tmp_path / "blender-data"

    target = data_dir()
    target.mkdir(parents=True)
    (target / "bridge.json").write_text(
        '{"host": "127.0.0.1", "port": 9, "token": "x", "addon_version": "1.0.0"}',
        encoding="utf-8",
    )
    state = connection_state(timeout=0.5)
    assert state["connected"] is False
    assert state["port"] == 9


def test_legacy_addon_install(tmp_path: Path, monkeypatch) -> None:
    scripts = tmp_path / "scripts"
    monkeypatch.setenv("KOVA_BLENDER_SCRIPTS", str(scripts))
    monkeypatch.setenv("KOVA_BLENDER_EXTENSIONS", str(tmp_path / "extensions"))

    installed = install_legacy()
    target = scripts / "addons" / ADDON_MODULE
    assert (target / "__init__.py").is_file()
    assert (target / "server.py").is_file()
    assert not (target / "blender_manifest.toml").exists()
    assert (scripts / "startup" / STARTUP_NAME).is_file()
    assert installed["installed"] is True
    assert installed["version"] == installed["available_version"]
    assert installed["mode"] == "legacy"

    state = addon_state()
    assert state["installed"] is True
    assert state["outdated"] is False

    install_legacy()
    assert len(list((scripts / "addons").iterdir())) == 1


def test_extension_state_detected(tmp_path: Path, monkeypatch) -> None:
    repo = tmp_path / "extensions" / "user_default"
    target = repo / ADDON_MODULE
    target.mkdir(parents=True)
    (target / "__init__.py").write_text("", encoding="utf-8")
    (target / "blender_manifest.toml").write_text(
        'schema_version = "1.0.0"\nversion = "9.9.9"\n',
        encoding="utf-8",
    )
    monkeypatch.setenv("KOVA_BLENDER_EXTENSIONS", str(repo))

    state = addon_state()
    assert state["installed"] is True
    assert state["mode"] == "extension"
    assert state["version"] == "9.9.9"
    assert state["outdated"] is True


def test_capsule_mentions_blender_workspace(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    client.post("/project/open", json={"path": str(game), "engine": "roblox"})

    task = client.post(
        "/tasks",
        json={"title": "Сундук", "type": "model", "engine": "roblox"},
    ).json()
    capsule = client.post(f"/tasks/{task['id']}/capsule")
    assert capsule.status_code == 200
    text = capsule.json()["text"]
    assert "Blender/ModelScripts" in text
    assert "blender-asset-qa" in text
    assert (game / "Blender" / "AGENTS.md").is_file()
    assert (game / ".hub" / "skills" / "blender" / "blender-core" / "SKILL.md").is_file()

    picked = client.patch(
        f"/tasks/{task['id']}",
        json={"skills": ["blender-core", "blender-stylized-npr"]},
    )
    assert picked.status_code == 200
    assert picked.json()["skills"] == ["blender-core", "blender-stylized-npr"]

    manual = client.post(f"/tasks/{task['id']}/capsule").json()["text"]
    assert ".hub/skills/blender/blender-stylized-npr/SKILL.md" in manual
    assert "blender-hardsurface-modeling/SKILL.md" not in manual

    invalid = client.patch(
        f"/tasks/{task['id']}",
        json={"skills": ["blender-missing"]},
    )
    assert invalid.status_code == 400
