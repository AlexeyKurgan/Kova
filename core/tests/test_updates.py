from kova_core.api.routes.updates import _version


def test_version_comparison() -> None:
    assert _version("v1.2.3") == (1, 2, 3)
    assert _version("0.0.0") < _version("0.0.1")
    assert _version("1.10.0") > _version("1.9.9")
    assert _version("2.0.0-beta") == (2, 0, 0)


def test_update_download_rejects_foreign_urls(tmp_path, monkeypatch) -> None:
    from fastapi.testclient import TestClient

    from kova_core.api.server import create_app

    monkeypatch.setenv("KOVA_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.delenv("KOVA_CORE_TOKEN", raising=False)
    client = TestClient(create_app())
    assert (
        client.post(
            "/updates/download",
            json={"url": "https://example.com/setup.exe"},
        ).status_code
        == 400
    )
    assert (
        client.post(
            "/updates/download",
            json={
                "url": "https://github.com/other/repo/releases/download/v1/setup.exe"
            },
        ).status_code
        == 400
    )


def test_pick_release_uses_highest_semver() -> None:
    from kova_core.api.routes.updates import _pick_release

    releases = [
        {"tag_name": "v0.4.1", "draft": False, "prerelease": False},
        {"tag_name": "v0.4.0", "draft": False, "prerelease": False},
        {"tag_name": "v0.10.0", "draft": False, "prerelease": False},
        {"tag_name": "v0.9.0", "draft": True, "prerelease": False},
        {"tag_name": "v0.11.0", "draft": False, "prerelease": True},
    ]
    picked = _pick_release(releases)
    assert picked is not None
    assert picked["tag_name"] == "v0.10.0"
    assert _pick_release([{"tag_name": "v9.0.0", "draft": True}]) is None
