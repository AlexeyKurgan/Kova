from __future__ import annotations

import json
import re
import shutil
import zipfile
from pathlib import Path
from typing import Any

from ..security.paths import resolve_inside

CUSTOM_ROOT = Path("packages") / "custom"
MANIFEST = "kova-package.json"
REMOTE_MARKER = ".kova-remote.json"
ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{1,63}$")


class PackageImportError(ValueError):
    pass


def _custom_root(hub: Path) -> Path:
    return resolve_inside(hub, CUSTOM_ROOT)


def _normalize(manifest: dict[str, Any]) -> dict[str, Any]:
    package_id = str(manifest.get("id") or "").strip()
    if not ID_RE.match(package_id):
        raise PackageImportError("id должен быть 2-64 символа: a-z0-9_-")
    name = str(manifest.get("name") or "").strip()
    if not name:
        raise PackageImportError("name обязателен")
    permissions = manifest.get("permissions") or []
    if not isinstance(permissions, list):
        raise PackageImportError("permissions должен быть списком")
    engines = manifest.get("engines") or ["generic"]
    if not isinstance(engines, list):
        raise PackageImportError("engines должен быть списком")
    return {
        "id": package_id,
        "name": name,
        "version": str(manifest.get("version") or "0.1.0"),
        "type": str(manifest.get("type") or "tool_adapter"),
        "author": str(manifest.get("author") or "Local"),
        "engines": [str(item) for item in engines],
        "permissions": [str(item) for item in permissions],
        "tools": [str(item) for item in (manifest.get("tools") or [])],
        "checks": [str(item) for item in (manifest.get("checks") or [])],
        "templates": [str(item) for item in (manifest.get("templates") or [])],
        "ui": [str(item) for item in (manifest.get("ui") or [])],
        "trust": "local",
        "description": str(manifest.get("description") or ""),
        "installed_by_default": False,
        "available": True,
        "custom": True,
    }


def list_custom_packages(hub: Path) -> list[dict[str, Any]]:
    root = _custom_root(hub)
    if not root.is_dir():
        return []
    rows: list[dict[str, Any]] = []
    for directory in root.iterdir():
        if not directory.is_dir():
            continue
        manifest = directory / MANIFEST
        if not manifest.is_file():
            continue
        try:
            row = _normalize(json.loads(manifest.read_text(encoding="utf-8")))
            if (directory / REMOTE_MARKER).is_file():
                row["trust"] = "remote"
            rows.append(row)
        except (OSError, ValueError, PackageImportError):
            continue
    return rows


def get_custom_package(hub: Path, package_id: str) -> dict[str, Any] | None:
    return next(
        (row for row in list_custom_packages(hub) if row["id"] == package_id),
        None,
    )


def _extract_zip(source: Path, target: Path, manifest_target: Path) -> None:
    with zipfile.ZipFile(source) as archive:
        names = archive.namelist()
        if MANIFEST not in names:
            raise PackageImportError(f"в архиве нет {MANIFEST} в корне")
        total = 0
        for info in archive.infolist():
            if info.is_dir():
                continue
            name = info.filename.replace("\\", "/")
            if name.startswith("/") or ".." in Path(name).parts:
                raise PackageImportError(f"небезопасный путь в архиве: {name}")
            if Path(name).name == REMOTE_MARKER:
                continue
            if info.file_size > 20 * 1024 * 1024:
                raise PackageImportError(f"файл слишком большой: {name}")
            total += info.file_size
            if total > 100 * 1024 * 1024:
                raise PackageImportError("архив больше 100 МБ")
            destination = resolve_inside(target, name)
            destination.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(info) as reader, destination.open("wb") as writer:
                shutil.copyfileobj(reader, writer)
    if not manifest_target.is_file():
        raise PackageImportError(f"не удалось распаковать {MANIFEST}")


def _copy_folder(source: Path, target: Path) -> None:
    files = [path for path in source.rglob("*") if path.is_file()]
    if len(files) > 500:
        raise PackageImportError("в пакете больше 500 файлов")
    total = sum(path.stat().st_size for path in files)
    if total > 100 * 1024 * 1024:
        raise PackageImportError("пакет больше 100 МБ")
    for path in files:
        relative = path.relative_to(source)
        if relative.name == REMOTE_MARKER:
            continue
        destination = resolve_inside(target, relative.as_posix())
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, destination)


def import_custom_package(hub: Path, source_path: Path) -> dict[str, Any]:
    source = source_path.expanduser().resolve()
    if not source.exists():
        raise PackageImportError("файл пакета не найден")

    staging = resolve_inside(hub, Path("packages") / ".import")
    if staging.exists():
        shutil.rmtree(staging, ignore_errors=True)
    staging.mkdir(parents=True, exist_ok=True)

    if source.is_dir():
        manifest_file = source / MANIFEST
        if not manifest_file.is_file():
            raise PackageImportError(f"в папке нет {MANIFEST}")
        try:
            manifest = _normalize(json.loads(manifest_file.read_text(encoding="utf-8")))
        except ValueError as exc:
            raise PackageImportError(f"некорректный {MANIFEST}: {exc}") from exc
        _copy_folder(source, staging)
    elif source.suffix.lower() == ".zip":
        manifest_target = staging / MANIFEST
        _extract_zip(source, staging, manifest_target)
        try:
            manifest = _normalize(json.loads(manifest_target.read_text(encoding="utf-8")))
        except ValueError as exc:
            raise PackageImportError(f"некорректный {MANIFEST}: {exc}") from exc
    else:
        raise PackageImportError("поддерживается .zip или папка с kova-package.json")

    package_id = manifest["id"]
    target = resolve_inside(_custom_root(hub), package_id)
    if target.exists():
        shutil.rmtree(staging, ignore_errors=True)
        raise PackageImportError(f"пакет {package_id} уже установлен")
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(staging), str(target))
    return manifest
