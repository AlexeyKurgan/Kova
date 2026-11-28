import signal
from pathlib import Path

from kova_core import config
from kova_core.security import job, secrets


def test_config_linux_paths(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.delenv("KOVA_DATA_DIR", raising=False)
    monkeypatch.delenv("KOVA_LOCAL_DATA_DIR", raising=False)
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path / "data"))
    monkeypatch.setenv("XDG_CACHE_HOME", str(tmp_path / "cache"))
    monkeypatch.setattr(config, "_is_windows", lambda: False)
    monkeypatch.setattr(config, "_platform", lambda: "linux")
    assert config.app_data_dir() == tmp_path / "data" / "KovaHub"
    assert config.local_data_dir() == tmp_path / "cache" / "KovaHub"


def test_config_macos_paths(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.delenv("KOVA_DATA_DIR", raising=False)
    monkeypatch.setattr(config, "_is_windows", lambda: False)
    monkeypatch.setattr(config, "_platform", lambda: "darwin")
    assert "Library/Application Support/KovaHub" in config.app_data_dir().as_posix()
    assert "Library/Caches/KovaHub" in config.local_data_dir().as_posix()


def test_secret_file_fallback(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("KOVA_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setattr(secrets, "_is_windows", lambda: False)
    monkeypatch.setattr(secrets, "_platform", lambda: "linux")
    monkeypatch.setattr(secrets.shutil, "which", lambda _name: None)
    assert secrets.secret_backend() == "file-0600"
    secrets.set_secret("api_key", "secret-value")
    assert secrets.has_secret("api_key")
    assert secrets.get_secret("api_key") == "secret-value"
    assert (tmp_path / "data" / "secrets.fallback.json").is_file()
    secrets.delete_secret("api_key")
    assert not secrets.has_secret("api_key")


def test_secret_macos_keychain_backend(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("KOVA_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setattr(secrets, "_is_windows", lambda: False)
    monkeypatch.setattr(secrets, "_platform", lambda: "darwin")
    monkeypatch.setattr(secrets.shutil, "which", lambda _name: "/usr/bin/security")
    values: dict[str, str] = {}
    monkeypatch.setattr(
        secrets, "_mac_set", lambda name, value: bool(values.setdefault(name, value))
    )
    monkeypatch.setattr(secrets, "_mac_get", lambda name: values.get(name, ""))
    monkeypatch.setattr(secrets, "_mac_delete", lambda name: values.pop(name, None))
    assert secrets.secret_backend() == "keychain"
    secrets.set_secret("token", "abc")
    assert values == {"token": "abc"}
    assert secrets.get_secret("token") == "abc"
    secrets.delete_secret("token")
    assert values == {}


def test_ensure_cli_path_adds_missing_dirs(tmp_path, monkeypatch) -> None:
    from kova_core import config

    home = tmp_path / "home"
    extra = home / ".local" / "bin"
    extra.mkdir(parents=True)
    monkeypatch.setattr(config, "_is_windows", lambda: False)
    monkeypatch.setattr(config.Path, "home", staticmethod(lambda: home))
    monkeypatch.setenv("PATH", "/usr/bin")
    config.ensure_cli_path()
    parts = config.os.environ["PATH"].split(config.os.pathsep)
    assert str(extra) in parts
    assert parts[0] == "/usr/bin"


def test_spawn_kwargs_per_platform(monkeypatch) -> None:
    monkeypatch.setattr(job, "_is_windows", lambda: True)
    assert "creationflags" in job.spawn_kwargs()
    monkeypatch.setattr(job, "_is_windows", lambda: False)
    assert job.spawn_kwargs() == {"start_new_session": True}


def test_posix_process_group_kill(monkeypatch) -> None:
    class Process:
        pid = 123

        def poll(self):
            return None

    calls: list[tuple[int, int]] = []
    monkeypatch.setattr(job, "_is_windows", lambda: False)
    monkeypatch.setattr(job.os, "getpgid", lambda pid: 55, raising=False)
    monkeypatch.setattr(
        job.os,
        "killpg",
        lambda pgid, sig: calls.append((pgid, sig)),
        raising=False,
    )
    job.kill_process_group(Process())
    assert calls[0] == (55, signal.SIGTERM)
    assert calls[-1] == (55, getattr(signal, "SIGKILL", signal.SIGTERM))


def test_blender_bridge_uses_local_data(tmp_path, monkeypatch) -> None:
    import importlib.util

    from kova_core.integrations.blender import discovery

    addon_paths = (
        Path(__file__).resolve().parents[1]
        / "kova_core"
        / "integrations"
        / "blender"
        / "addon"
        / "paths.py"
    )
    spec = importlib.util.spec_from_file_location("kova_addon_paths", addon_paths)
    assert spec and spec.loader
    addon = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(addon)

    monkeypatch.setenv("KOVA_LOCAL_DATA_DIR", str(tmp_path / "local"))
    monkeypatch.delenv("KOVA_HUB_BLENDER_DATA", raising=False)
    expected = tmp_path / "local" / "blender"
    assert discovery.data_dir() == expected
    assert addon.data_dir() == expected
    assert discovery.bridge_file() == expected / "bridge.json"
    assert addon.discovery_path() == expected / "bridge.json"


def test_platform_default_blender_paths(monkeypatch) -> None:
    from kova_core.integrations.blender import discovery

    monkeypatch.delenv("KOVA_LOCAL_DATA_DIR", raising=False)
    monkeypatch.delenv("KOVA_HUB_BLENDER_DATA", raising=False)
    monkeypatch.setattr(discovery, "_is_windows", lambda: False)
    monkeypatch.setattr(discovery, "_platform", lambda: "linux")
    monkeypatch.setenv("XDG_CACHE_HOME", "/tmp/cache")
    assert discovery.data_dir() == Path("/tmp/cache/KovaHub/blender")
