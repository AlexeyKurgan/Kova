"""Remote package index and signed-download helpers.

A marketplace entry is metadata plus a SHA256-pinned ``.zip``. Kova never
executes package code: the archive goes through the same manifest validation
and zip-slip protection as a manually imported package.
"""
from __future__ import annotations

import hashlib
import ipaddress
import json
import re
import socket
import ssl
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from ..security.paths import resolve_inside
from . import custom

DEFAULT_INDEX_URL = (
    "https://raw.githubusercontent.com/AlexeyKurgan/Kova/main/packages/index.json"
)
MAX_INDEX_BYTES = 2 * 1024 * 1024
MAX_ARCHIVE_BYTES = 100 * 1024 * 1024
MAX_INDEX_ENTRIES = 200
SHA256_RE = re.compile(r"^[a-f0-9]{64}$")


class RemoteError(ValueError):
    pass


class _SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[no-untyped-def]
        _validate_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _validate_url(url: str) -> urllib.parse.ParseResult:
    parsed = urllib.parse.urlparse(url.strip())
    if parsed.scheme != "https":
        raise RemoteError("разрешены только HTTPS-адреса")
    if not parsed.hostname:
        raise RemoteError("в адресе нет хоста")
    if parsed.username or parsed.password:
        raise RemoteError("адрес не должен содержать логин или пароль")
    host = parsed.hostname.lower().strip(".")
    if host in {"localhost", "localhost.localdomain"} or host.endswith(".local"):
        raise RemoteError("локальные адреса запрещены")
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        try:
            infos = socket.getaddrinfo(host, parsed.port or 443, type=socket.SOCK_STREAM)
        except OSError:
            infos = []
        for info in infos:
            try:
                resolved = ipaddress.ip_address(info[4][0])
            except ValueError:
                continue
            if not resolved.is_global:
                raise RemoteError("адрес указывает на локальную сеть")
    else:
        if not address.is_global:
            raise RemoteError("адрес указывает на локальную сеть")
    return parsed


def _ssl_context() -> ssl.SSLContext:
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except (ImportError, OSError):
        return ssl.create_default_context()


def _open(url: str):
    _validate_url(url)
    opener = urllib.request.build_opener(
        _SafeRedirect,
        urllib.request.HTTPSHandler(context=_ssl_context()),
    )
    request = urllib.request.Request(url, headers={"User-Agent": "Kova-Hub-Packages"})
    return opener.open(request, timeout=15)


def _read_url(url: str, limit: int) -> bytes:
    try:
        with _open(url) as response:
            final = response.geturl()
            _validate_url(final)
            chunks: list[bytes] = []
            total = 0
            while True:
                chunk = response.read(64 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > limit:
                    raise RemoteError(f"ответ больше {limit // (1024 * 1024)} МБ")
                chunks.append(chunk)
    except RemoteError:
        raise
    except urllib.error.HTTPError as exc:
        raise RemoteError(f"сервер вернул HTTP {exc.code}") from exc
    except urllib.error.URLError as exc:
        raise RemoteError(f"нет связи с сервером: {exc.reason}") from exc
    except (TimeoutError, OSError) as exc:
        raise RemoteError(f"ошибка сети: {exc}") from exc
    return b"".join(chunks)


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value]


def _normalize_entry(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    package_id = str(raw.get("id") or "").strip()
    if not custom.ID_RE.match(package_id):
        return None
    name = str(raw.get("name") or "").strip()
    if not name:
        return None
    download_url = str(raw.get("download_url") or "").strip()
    try:
        _validate_url(download_url)
    except RemoteError:
        return None
    sha256 = str(raw.get("sha256") or "").strip().lower()
    if not SHA256_RE.match(sha256):
        return None
    try:
        size = int(raw.get("size") or 0)
    except (TypeError, ValueError):
        size = 0
    if size < 0 or size > MAX_ARCHIVE_BYTES:
        return None
    engines = _string_list(raw.get("engines")) or ["generic"]
    permissions = _string_list(raw.get("permissions"))
    homepage = str(raw.get("homepage") or "").strip()
    if homepage and urllib.parse.urlparse(homepage).scheme not in {"https", "http"}:
        homepage = ""
    return {
        "id": package_id,
        "name": name,
        "version": str(raw.get("version") or "0.1.0"),
        "type": str(raw.get("type") or "tool_adapter"),
        "author": str(raw.get("author") or "Community"),
        "engines": engines,
        "permissions": permissions,
        "tools": _string_list(raw.get("tools")),
        "checks": _string_list(raw.get("checks")),
        "templates": _string_list(raw.get("templates")),
        "ui": _string_list(raw.get("ui")),
        "description": str(raw.get("description") or ""),
        "homepage": homepage,
        "download_url": download_url,
        "sha256": sha256,
        "size": size,
        "trust": "remote",
    }


def fetch_index(url: str = "") -> dict[str, Any]:
    index_url = (url or DEFAULT_INDEX_URL).strip()
    _validate_url(index_url)
    body = _read_url(index_url, MAX_INDEX_BYTES)
    try:
        payload = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise RemoteError("индекс не является корректным JSON") from exc
    if not isinstance(payload, dict):
        raise RemoteError("индекс должен быть JSON-объектом")
    try:
        schema = int(payload.get("schema") or 1)
    except (TypeError, ValueError) as exc:
        raise RemoteError("некорректная версия индекса") from exc
    if schema != 1:
        raise RemoteError("неподдерживаемая версия индекса")
    rows = payload.get("packages")
    if not isinstance(rows, list):
        raise RemoteError("в индексе нет списка packages")
    packages: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw in rows[:MAX_INDEX_ENTRIES]:
        entry = _normalize_entry(raw)
        if entry is None or entry["id"] in seen:
            continue
        seen.add(entry["id"])
        packages.append(entry)
    return {
        "index_url": index_url,
        "name": str(payload.get("name") or "Kova Package Index"),
        "updated_at": str(payload.get("updated_at") or ""),
        "packages": packages,
    }


def _download_archive(url: str, target: Path, sha256: str) -> None:
    _validate_url(url)
    if not SHA256_RE.match(sha256):
        raise RemoteError("в индексе нет корректного SHA256")
    digest = hashlib.sha256()
    total = 0
    try:
        with _open(url) as response:
            _validate_url(response.geturl())
            with target.open("wb") as handle:
                while True:
                    chunk = response.read(256 * 1024)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > MAX_ARCHIVE_BYTES:
                        raise RemoteError("архив больше 100 МБ")
                    digest.update(chunk)
                    handle.write(chunk)
    except RemoteError:
        target.unlink(missing_ok=True)
        raise
    except urllib.error.HTTPError as exc:
        target.unlink(missing_ok=True)
        raise RemoteError(f"сервер вернул HTTP {exc.code}") from exc
    except urllib.error.URLError as exc:
        target.unlink(missing_ok=True)
        raise RemoteError(f"нет связи с сервером: {exc.reason}") from exc
    except (TimeoutError, OSError) as exc:
        target.unlink(missing_ok=True)
        raise RemoteError(f"ошибка загрузки: {exc}") from exc
    actual = digest.hexdigest()
    if actual != sha256.lower():
        target.unlink(missing_ok=True)
        raise RemoteError("SHA256 не совпал — пакет не установлен")


def install_remote_package(
    hub: Path,
    package_id: str,
    url: str,
    sha256: str,
) -> dict[str, Any]:
    if not custom.ID_RE.match(package_id):
        raise RemoteError("некорректный id пакета")
    target = resolve_inside(hub, custom.CUSTOM_ROOT / package_id)
    backup = target.with_name(target.name + ".backup")
    with tempfile.TemporaryDirectory(prefix="kova-market-") as temporary:
        archive = Path(temporary) / "package.zip"
        _download_archive(url, archive, sha256)
        import shutil

        if backup.exists():
            shutil.rmtree(backup, ignore_errors=True)
        if target.exists():
            target.rename(backup)
        try:
            manifest = custom.import_custom_package(hub, archive)
            if manifest["id"] != package_id:
                raise RemoteError(
                    f"манифест пакета содержит id {manifest['id']}, а индекс — {package_id}"
                )
        except custom.PackageImportError as exc:
            if target.exists():
                shutil.rmtree(target, ignore_errors=True)
            if backup.exists():
                backup.rename(target)
            raise RemoteError(str(exc)) from exc
        except Exception:
            if target.exists():
                shutil.rmtree(target, ignore_errors=True)
            if backup.exists():
                backup.rename(target)
            raise
        (target / custom.REMOTE_MARKER).write_text(
            json.dumps({"url": url, "sha256": sha256}, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        if backup.exists():
            shutil.rmtree(backup, ignore_errors=True)
    manifest["trust"] = "remote"
    return manifest
