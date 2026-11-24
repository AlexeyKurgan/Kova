from pathlib import Path

from fastapi.testclient import TestClient

from kova_core.api.server import create_app


def make_client(tmp_path: Path, monkeypatch) -> TestClient:
    monkeypatch.setenv("KOVA_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.delenv("KOVA_CORE_TOKEN", raising=False)
    return TestClient(create_app())


def test_builtin_skills_and_user_crud(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    listed = client.get("/skills")
    assert listed.status_code == 200
    rows = listed.json()
    assert len(rows) >= 28
    assert all(row["category"] == "blender" for row in rows)

    created = client.post(
        "/skills",
        json={
            "name": "roblox-hitboxes",
            "description": "Hitbox rules for Roblox combat.",
            "category": "roblox",
            "content": "# Hitboxes\nUse attributes.",
            "locked": True,
        },
    )
    assert created.status_code == 201, created.text
    skill = created.json()
    assert skill["name"] == "roblox-hitboxes"
    assert skill["locked"] is True

    detail = client.get(f"/skills/{skill['id']}")
    assert "Hitboxes" in detail.json()["content"]

    blocked = client.patch(
        f"/skills/{skill['id']}",
        json={"content": "# Changed"},
    )
    assert blocked.status_code == 400
    unlocked = client.patch(f"/skills/{skill['id']}", json={"locked": False})
    assert unlocked.status_code == 200
    updated = client.patch(
        f"/skills/{skill['id']}",
        json={"content": "# Changed", "description": "Updated"},
    )
    assert updated.status_code == 200
    assert updated.json()["content"] == "# Changed"

    locked_again = client.patch(f"/skills/{skill['id']}", json={"locked": True})
    assert locked_again.status_code == 200
    assert client.delete(f"/skills/{skill['id']}").status_code == 400
    assert client.delete(f"/skills/{skill['id']}?unlock=true").status_code == 204
    assert not any(row["id"] == skill["id"] for row in client.get("/skills").json())


def test_builtin_override_and_prompt(tmp_path: Path, monkeypatch) -> None:
    from kova_core.skills import skill_prompt

    client = make_client(tmp_path, monkeypatch)
    row = client.get("/skills/blender-core").json()
    assert row["source"] == "builtin"
    patched = client.patch(
        "/skills/blender-core",
        json={"content": "# Custom core\nDo the thing."},
    )
    assert patched.status_code == 200, patched.text
    assert client.get("/skills/blender-core").json()["content"].startswith("# Custom core")
    prompt = skill_prompt(["blender-core"])
    assert "blender-core" in prompt
    assert "Do the thing." in prompt
