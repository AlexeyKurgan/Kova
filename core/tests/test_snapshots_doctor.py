from pathlib import Path

from fastapi.testclient import TestClient

from kova_core.api.server import create_app
from kova_core.storage.snapshots import create_snapshot, diff_snapshot


def make_client(tmp_path: Path, monkeypatch) -> TestClient:
    monkeypatch.setenv("KOVA_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.delenv("KOVA_CORE_TOKEN", raising=False)
    return TestClient(create_app())


def test_snapshot_and_restore(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    (game / "chest.lua").write_text("version 1", encoding="utf-8")
    client.post("/project/open", json={"path": str(game)})

    created = client.post("/snapshots", json={"reason": "before pivot fix"})
    assert created.status_code == 201
    snapshot = created.json()
    assert snapshot["files"][0]["path"] == "chest.lua"
    assert snapshot["restore_point"] is True

    (game / "chest.lua").write_text("version 2 broken", encoding="utf-8")

    restored = client.post(f"/snapshots/{snapshot['id']}/restore")
    assert restored.status_code == 200
    assert (game / "chest.lua").read_text(encoding="utf-8") == "version 1"

    listed = client.get("/snapshots")
    assert listed.status_code == 200
    assert len(listed.json()) == 2

    assert client.post("/snapshots/snap_missing/restore").status_code == 404


def test_doctor_reports_environment(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    client.post("/project/open", json={"path": str(game)})

    response = client.get("/doctor")
    assert response.status_code == 200
    checks = {item["name"]: item for item in response.json()}
    assert checks["Структура .hub"]["status"] == "passed"
    assert checks["Изоляция агентов"]["status"] in {"passed", "warning"}
    assert checks["Локальный режим"]["status"] in {"passed", "warning"}
    assert checks["Сетевой щит"]["status"] in {"passed", "warning"}
    assert checks["Токен Core API"]["status"] in {"passed", "warning"}
    assert checks["Корзина проектов"]["status"] in {"passed", "warning"}
    assert checks["Process containment"]["status"] in {"passed", "warning"}
    assert checks["OS sandbox"]["status"] in {"passed", "warning"}
    assert checks["Права на запись"]["status"] == "passed"
    assert checks["Порты Kova"]["details"]["8765"] in {"занят", "свободен"}
    assert checks["Пакеты проекта"]["status"] == "passed"
    assert "Свободное место" in checks
    assert "Blender" in checks


def test_doctor_reports_english_display_fields(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    client.post("/project/open", json={"path": str(game)})

    rows = client.get(
        "/doctor", headers={"X-Kova-Language": "en"}
    ).json()
    checks = {item["name"]: item for item in rows}
    assert checks["Структура .hub"]["display_name"] == ".hub structure"
    assert checks["Структура .hub"]["display_message"] == "Project memory is present"
    assert checks["Пакеты проекта"]["display_name"] == "Project packages"
    assert "installed packages are OK" in checks["Пакеты проекта"]["display_message"]
    # Grouping keys stay canonical regardless of the display language.
    assert "Пакеты проекта" in checks


def test_snapshot_diff(tmp_path: Path) -> None:
    game = tmp_path / "game"
    game.mkdir()
    (game / ".hub").mkdir()
    (game / "keep.txt").write_text("same", encoding="utf-8")
    (game / "change.txt").write_text("before", encoding="utf-8")
    (game / "remove.txt").write_text("old", encoding="utf-8")

    snapshot = create_snapshot(game / ".hub", "diff test")
    (game / "change.txt").write_text("after", encoding="utf-8")
    (game / "remove.txt").unlink()
    (game / "new.txt").write_text("new", encoding="utf-8")

    result = diff_snapshot(
        game / ".hub",
        snapshot.id,
        patch_dir=game / ".hub" / "agents" / "diffs" / "test",
    )
    changes = {item["path"]: item["status"] for item in result["changes"]}
    assert changes["change.txt"] == "modified"
    assert changes["remove.txt"] == "deleted"
    assert changes["new.txt"] == "added"
    assert "keep.txt" not in changes
    for item in result["changes"]:
        if item["path"] == "change.txt":
            assert item["patch_path"]
            assert item["additions"] == 1
            assert item["deletions"] == 1
            patch = (game / ".hub" / item["patch_path"]).read_text(encoding="utf-8")
            assert "-before" in patch
            assert "+after" in patch


def test_snapshot_delete_and_cleanup(tmp_path: Path, monkeypatch) -> None:
    import json

    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    (game / "a.txt").write_text("a", encoding="utf-8")
    client.post("/project/open", json={"path": str(game)})
    first = client.post("/snapshots", json={"reason": "first"}).json()
    second = client.post("/snapshots", json={"reason": "second"}).json()

    meta = game / ".hub" / "snapshots" / f"{first['id']}.json"
    data = json.loads(meta.read_text(encoding="utf-8"))
    data["created_at"] = "2020-01-01T00:00:00+00:00"
    meta.write_text(json.dumps(data), encoding="utf-8")

    cleaned = client.post("/snapshots/cleanup?keep=1&days=1")
    assert cleaned.status_code == 200, cleaned.text
    assert cleaned.json()["removed"] == 1
    assert [item["id"] for item in client.get("/snapshots").json()] == [second["id"]]

    deleted = client.delete(f"/snapshots/{second['id']}")
    assert deleted.status_code == 204
    assert client.get("/snapshots").json() == []


def test_snapshot_diff_api(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    client.post("/project/open", json={"path": str(game)})
    hub = game / ".hub"
    (game / "keep.txt").write_text("same", encoding="utf-8")
    (game / "change.txt").write_text("before", encoding="utf-8")
    (game / "remove.txt").write_text("old", encoding="utf-8")
    created = client.post("/snapshots", json={"reason": "diff api"})
    assert created.status_code == 201, created.text
    snapshot = created.json()
    (game / "change.txt").write_text("after", encoding="utf-8")
    (game / "remove.txt").unlink()
    (game / "new.txt").write_text("new", encoding="utf-8")

    response = client.get(f"/snapshots/{snapshot['id']}/diff")
    assert response.status_code == 200, response.text
    payload = response.json()
    statuses = {row["path"]: row["status"] for row in payload["changes"]}
    assert statuses["new.txt"] == "added"
    assert statuses["change.txt"] == "modified"
    assert statuses["remove.txt"] == "deleted"
    assert "keep.txt" not in statuses
    assert payload["total"] == 3
    assert client.get("/snapshots/snap_missing/diff").status_code == 404


def test_doctor_repair_restores_structure(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    client.post("/project/open", json={"path": str(game)})
    hub = game / ".hub"
    import shutil

    shutil.rmtree(hub / "review")
    (hub / "ledger" / "events.jsonl").unlink(missing_ok=True)

    repaired = client.post("/doctor/repair")
    assert repaired.status_code == 200, repaired.text
    payload = repaired.json()
    assert (hub / "review" / "comments").is_dir()
    assert (hub / "ledger" / "events.jsonl").is_file()
    assert any("review" in action for action in payload["actions"])
    assert isinstance(payload["checks"], list)


def test_diary_groups_events(tmp_path: Path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    game = tmp_path / "game"
    game.mkdir()
    client.post("/project/open", json={"path": str(game)})
    task = client.post("/tasks", json={"title": "Diary task"}).json()
    client.post("/tasks", json={"title": "Done task"})
    done = next(item for item in client.get("/tasks").json() if item["title"] == "Done task")
    client.patch(f"/tasks/{done['id']}", json={"status": "done"})
    source = tmp_path / "prop.glb"
    source.write_bytes(b"glb")
    client.post("/assets/import", json={"path": str(source)})
    client.post("/snapshots", json={"reason": "diary"})

    response = client.get("/diary?days=7")
    assert response.status_code == 200, response.text
    payload = response.json()
    assert len(payload["days"]) == 7
    today = payload["days"][0]
    assert today["tasks_created"] >= 1
    assert today["tasks_done"] >= 1
    assert today["assets"] >= 1
    assert today["snapshots"] >= 1
    assert "task.created" in today["highlights"]
    assert payload["totals"]["events"] >= 4
    assert task["id"]
    assert client.get("/diary?days=0").status_code == 422
