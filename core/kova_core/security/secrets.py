import base64
import ctypes
import json
import os
import threading
from ctypes import wintypes
from pathlib import Path

from ..config import app_data_dir

SECRETS_FILE = "secrets.json"
LOCK = threading.Lock()


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
    if os.name != "nt":
        raise RuntimeError("DPAPI доступен только на Windows")
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
    if os.name != "nt":
        raise RuntimeError("DPAPI доступен только на Windows")
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


def _path() -> Path:
    return app_data_dir() / SECRETS_FILE


def _read() -> dict[str, str]:
    try:
        payload = json.loads(_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(payload, dict):
        return {}
    return {str(key): str(value) for key, value in payload.items() if isinstance(value, str)}


def _write(rows: dict[str, str]) -> None:
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(rows, indent=2) + "\n", encoding="utf-8")


def set_secret(name: str, value: str) -> None:
    with LOCK:
        rows = _read()
        if value:
            rows[name] = base64.b64encode(_protect(value.encode("utf-8"))).decode("ascii")
        else:
            rows.pop(name, None)
        _write(rows)


def has_secret(name: str) -> bool:
    return bool(_read().get(name))


def get_secret(name: str) -> str:
    with LOCK:
        encoded = _read().get(name)
    if not encoded:
        return ""
    try:
        data = base64.b64decode(encoded.encode("ascii"))
        return _unprotect(data).decode("utf-8")
    except (ValueError, RuntimeError, OSError):
        return ""


def delete_secret(name: str) -> None:
    with LOCK:
        rows = _read()
        if name in rows:
            rows.pop(name, None)
            _write(rows)
