from __future__ import annotations

import json
import re
import shutil
import zipfile
from pathlib import Path
from typing import Any

from ..domain.enums import Engine, TaskType
from ..security.paths import resolve_inside

CUSTOM_ROOT = Path("packages") / "custom"
MANIFEST = "kova-package.json"
REMOTE_MARKER = ".kova-remote.json"
ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{1,63}$")


class PackageImportError(ValueError):
    pass


def _custom_root(hub: Path) -> Path:
    return resolve_inside(hub, CUSTOM_ROOT)


def _normalize_template(raw: Any, package_id: str) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    template_id = str(raw.get("id") or "").strip()
    if not ID_RE.match(template_id):
        return None
    label = str(raw.get("label") or "").strip()
    title = str(raw.get("title") or "").strip()
    if not label or not title:
        return None
    task_type = str(raw.get("type") or "model")
    if task_type not in {item.value for item in TaskType}:
        task_type = TaskType.model.value
    engine = str(raw.get("engine") or "generic")
    if engine not in {item.value for item in Engine}:
        engine = Engine.generic.value
    criteria = raw.get("criteria") or []
    if not isinstance(criteria, list):
        criteria = []
    criteria_en = raw.get("criteria_en") or []
    if not isinstance(criteria_en, list):
        criteria_en = []
    return {
        "id": f"{package_id}::{template_id}",
        "label": label[:80],
        "label_en": str(raw.get("label_en") or "")[:80],
        "title": title[:200],
        "title_en": str(raw.get("title_en") or "")[:200],
        "type": task_type,
        "engine": engine,
        "goal": str(raw.get("goal") or "")[:4000],
        "goal_en": str(raw.get("goal_en") or "")[:4000],
        "criteria": [str(item)[:300] for item in criteria[:12]],
        "criteria_en": [str(item)[:300] for item in criteria_en[:12]],
    }


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
    raw_templates = manifest.get("task_templates") or []
    if not isinstance(raw_templates, list):
        raw_templates = []
    task_templates = []
    seen_templates: set[str] = set()
    for raw in raw_templates[:20]:
        template = _normalize_template(raw, package_id)
        if template is None or template["id"] in seen_templates:
            continue
        seen_templates.add(template["id"])
        task_templates.append(template)
    return {
        "id": package_id,
        "name": name,
        "name_en": str(manifest.get("name_en") or ""),
        "version": str(manifest.get("version") or "0.1.0"),
        "type": str(manifest.get("type") or "tool_adapter"),
        "author": str(manifest.get("author") or "Local"),
        "engines": [str(item) for item in engines],
        "permissions": [str(item) for item in permissions],
        "tools": [str(item) for item in (manifest.get("tools") or [])],
        "checks": [str(item) for item in (manifest.get("checks") or [])],
        "templates": [str(item) for item in (manifest.get("templates") or [])],
        "task_templates": task_templates,
        "ui": [str(item) for item in (manifest.get("ui") or [])],
        "trust": "local",
        "description": str(manifest.get("description") or ""),
        "description_en": str(manifest.get("description_en") or ""),
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
