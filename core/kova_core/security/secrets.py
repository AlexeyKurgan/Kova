"""Provider secret storage.

Windows keeps the existing DPAPI file format. macOS uses the Keychain CLI and
Linux uses Secret Service via ``secret-tool`` when available. If no OS keyring
is available, a 0600 file fallback is used and reported explicitly by
``secret_backend()``.
"""
from __future__ import annotations

import base64
import json
import os
import shutil
import subprocess
import sys
import threading
from pathlib import Path

from ..config import app_data_dir

SECRETS_FILE = "secrets.json"
FALLBACK_FILE = "secrets.fallback.json"
LOCK = threading.Lock()
SERVICE = "KovaHub"

if os.name == "nt":
    import ctypes
    from ctypes import wintypes

    class _Blob(ctypes.Structure):
        _fields_ = [
            ("cbData", wintypes.DWORD),
            ("pbData", ctypes.POINTER(ctypes.c_char)),
        ]

    def _to_blob(data: bytes) -> tuple[_Blob, ctypes.Array]:
        buffer = ctypes.create_string_buffer(data, len(data))
        blob = _Blob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_char)))
        return blob, buffer

    def _protect(data: bytes) -> bytes:
        blob_in, _buffer = _to_blob(data)
        blob_out = _Blob()
        ok = ctypes.windll.crypt32.CryptProtectData(
            ctypes.byref(blob_in),
            None,
            None,
            None,
            None,
            0,
            ctypes.byref(blob_out),
        )
        if not ok:
            raise RuntimeError("CryptProtectData failed")
        try:
            return ctypes.string_at(blob_out.pbData, blob_out.cbData)
        finally:
            ctypes.windll.kernel32.LocalFree(blob_out.pbData)

    def _unprotect(data: bytes) -> bytes:
        blob_in, _buffer = _to_blob(data)
        blob_out = _Blob()
        ok = ctypes.windll.crypt32.CryptUnprotectData(
            ctypes.byref(blob_in),
            None,
            None,
            None,
            None,
            0,
            ctypes.byref(blob_out),
        )
        if not ok:
            raise RuntimeError("CryptUnprotectData failed")
        try:
            return ctypes.string_at(blob_out.pbData, blob_out.cbData)
        finally:
            ctypes.windll.kernel32.LocalFree(blob_out.pbData)


def _is_windows() -> bool:
    return os.name == "nt"


def _platform() -> str:
    return sys.platform


def secret_backend() -> str:
    if _is_windows():
        return "dpapi"
    if _platform() == "darwin" and shutil.which("security"):
        return "keychain"
    if shutil.which("secret-tool"):
        return "secret-service"
    return "file-0600"


def _path(file_name: str = SECRETS_FILE) -> Path:
    return app_data_dir() / file_name


def _read_file(path: Path) -> dict[str, str]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(payload, dict):
        return {}
    return {str(key): str(value) for key, value in payload.items() if isinstance(value, str)}


def _write_file(path: Path, rows: dict[str, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(rows, indent=2) + "\n", encoding="utf-8")
    if not _is_windows():
        try:
            os.chmod(path, 0o600)
            os.chmod(path.parent, 0o700)
        except OSError:
            pass


def _mac_call(args: list[str], stdin: str | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        input=stdin,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=10,
    )


def _mac_get(name: str) -> str:
    result = _mac_call(
        ["security", "find-generic-password", "-a", name, "-s", SERVICE, "-w"]
    )
    if result.returncode != 0:
        return ""
    return (result.stdout or "").strip()


def _mac_set(name: str, value: str) -> bool:
    result = _mac_call(
        [
            "security",
            "add-generic-password",
            "-a",
            name,
            "-s",
            SERVICE,
            "-w",
            value,
            "-U",
        ]
    )
    return result.returncode == 0


def _mac_delete(name: str) -> None:
    _mac_call(["security", "delete-generic-password", "-a", name, "-s", SERVICE])


def _secret_tool_get(name: str) -> str:
    result = _mac_call(
        ["secret-tool", "lookup", "service", SERVICE, "name", name]
    )
    if result.returncode != 0:
        return ""
    return (result.stdout or "").rstrip("\n")


def _secret_tool_set(name: str, value: str) -> bool:
    result = _mac_call(
        ["secret-tool", "store", "--label=KovaHub", "service", SERVICE, "name", name],
        stdin=value,
    )
    return result.returncode == 0


def _secret_tool_delete(name: str) -> None:
    _mac_call(["secret-tool", "clear", "service", SERVICE, "name", name])


def _fallback_get(name: str) -> str:
    encoded = _read_file(_path(FALLBACK_FILE)).get(name)
    if not encoded:
        return ""
    try:
        return base64.b64decode(encoded.encode("ascii")).decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        return ""


def _fallback_set(name: str, value: str) -> None:
    path = _path(FALLBACK_FILE)
    rows = _read_file(path)
    if value:
        rows[name] = base64.b64encode(value.encode("utf-8")).decode("ascii")
    else:
        rows.pop(name, None)
    _write_file(path, rows)


def set_secret(name: str, value: str) -> None:
    with LOCK:
        if _is_windows():
            rows = _read_file(_path())
            if value:
                rows[name] = base64.b64encode(_protect(value.encode("utf-8"))).decode("ascii")
            else:
                rows.pop(name, None)
            _write_file(_path(), rows)
            return

        backend = secret_backend()
        if backend == "keychain":
            if value and _mac_set(name, value):
                _fallback_set(name, "")
                return
            if not value:
                _mac_delete(name)
                _fallback_set(name, "")
                return
        elif backend == "secret-service":
            if value and _secret_tool_set(name, value):
                _fallback_set(name, "")
                return
            if not value:
                _secret_tool_delete(name)
                _fallback_set(name, "")
                return
        _fallback_set(name, value)


def has_secret(name: str) -> bool:
    return bool(get_secret(name))


def get_secret(name: str) -> str:
    with LOCK:
        if _is_windows():
            encoded = _read_file(_path()).get(name)
            if not encoded:
                return ""
            try:
                data = base64.b64decode(encoded.encode("ascii"))
                return _unprotect(data).decode("utf-8")
            except (ValueError, RuntimeError, OSError):
                return ""

        backend = secret_backend()
        if backend == "keychain":
            value = _mac_get(name)
            if value:
                return value
        elif backend == "secret-service":
            value = _secret_tool_get(name)
            if value:
                return value
        return _fallback_get(name)


def delete_secret(name: str) -> None:
    set_secret(name, "")
