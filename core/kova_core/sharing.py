"""Portable project export/import (``.kovaproj``).

The archive is a regular zip with a ``kova-share.json`` manifest at the root.
It contains project files and ``.hub`` metadata, but never local caches,
virtualenvs, Git data, node_modules or obvious secret files.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any

from . import __version__
from .domain.enums import Engine
from .i18n import tr
from .security.paths import resolve_inside
from .storage.projects import load_project
from .storage.registry import default_parent, register

SHARE_FILE = "kova-share.json"
SHARE_FORMAT = "kova-project"
SHARE_VERSION = 1
MAX_FILES = 20_000
MAX_BYTES = 2 * 1024**3

EXCLUDED_DIRS = {
    ".git",
    ".hg",
    ".svn",
    "node_modules",
    ".venv",
    "venv",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    "dist",
    "build",
    "target",
    "release",
    ".idea",
    ".vscode",
}
EXCLUDED_NAMES = {
    ".env",
    ".git-credentials",
    "secrets.enc",
    "id_rsa",
    "id_ed25519",
}
EXCLUDED_SUFFIXES = {".pyc", ".pyo", ".pem", ".key"}


class ShareError(ValueError):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def _skip_dir(relative: PurePosixPath) -> bool:
    parts = relative.parts
    if any(part in EXCLUDED_DIRS for part in parts):
        return True
    if any(part.endswith(".backup") for part in parts):
        return True
    if len(parts) >= 2 and parts[0] == ".hub" and parts[1] in {".local", ".trash"}:
        return True
    return False


def _skip_file(relative: PurePosixPath, target: Path | None) -> bool:
    if relative.name in EXCLUDED_NAMES:
        return True
    if relative.name.startswith(".env."):
        return True
    if relative.suffix.lower() in EXCLUDED_SUFFIXES:
        return True
    if len(relative.parts) >= 2 and relative.parts[0] == ".hub" and relative.parts[1] in {
        ".local",
        ".trash",
    }:
        return True
    if target is not None and target.exists():
        return True
    return False


def _iter_project_files(root: Path, target: Path | None = None):
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        current = Path(dirpath)
        relative_dir = PurePosixPath(current.relative_to(root).as_posix())
        dirnames[:] = sorted(
            name
            for name in dirnames
            if not _skip_dir(relative_dir / name)
            and not (current / name).is_symlink()
        )
        for name in sorted(filenames):
            path = current / name
            if path.is_symlink():
                continue
            relative = PurePosixPath(path.relative_to(root).as_posix())
            if _skip_file(relative, target if target and target.resolve() == path.resolve() else None):
                continue
            yield path, relative


def export_project(project_root: Path, target_file: Path) -> dict[str, Any]:
    root = project_root.expanduser().resolve()
    if not root.is_dir():
        raise ShareError(tr("папка проекта не найдена", "project folder not found"))
    if not (root / ".hub").is_dir():
        raise ShareError(tr("в проекте нет .hub", "the project has no .hub"))
    target = target_file.expanduser().resolve()
    if target.suffix.lower() != ".kovaproj":
        target = target.with_suffix(".kovaproj")
    target.parent.mkdir(parents=True, exist_ok=True)

    project = load_project(root / ".hub")
    files = list(_iter_project_files(root, target))
    total = 0
    for path, relative in files:
        try:
            total += path.stat().st_size
        except OSError as exc:
            raise ShareError(tr(f"не удалось прочитать {relative}: {exc}", f"could not read {relative}: {exc}")) from exc
        if total > MAX_BYTES:
            raise ShareError(tr("проект больше 2 ГБ — экспорт остановлен", "the project is larger than 2 GB — export stopped"))

    manifest = {
        "format": SHARE_FORMAT,
        "version": SHARE_VERSION,
        "name": project.name,
        "engine": project.engine.value,
        "exported_at": _now(),
        "app_version": __version__,
        "files": len(files),
        "bytes": total,
    }

    fd, temporary_name = tempfile.mkstemp(
        prefix=".kova-export-",
        suffix=".kovaproj",
        dir=target.parent,
    )
    os.close(fd)
    temporary = Path(temporary_name)
    try:
        with zipfile.ZipFile(
            temporary,
            "w",
            compression=zipfile.ZIP_DEFLATED,
            compresslevel=6,
        ) as archive:
            archive.writestr(
                SHARE_FILE,
                json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            )
            for path, relative in files:
                archive.write(path, relative.as_posix())
        os.replace(temporary, target)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise
    return {
        "path": str(target),
        "files": len(files),
        "bytes": total,
        "name": project.name,
        "engine": project.engine.value,
    }


def _safe_name(value: str) -> str:
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", value).strip(" .")
    return cleaned[:120] or "Kova Project"


def _unique_folder(parent: Path, name: str) -> Path:
    candidate = parent / name
    index = 2
    while candidate.exists():
        candidate = parent / f"{name} ({index})"
        index += 1
    return candidate


def _read_manifest(archive: zipfile.ZipFile) -> dict[str, Any]:
    try:
        info = archive.getinfo(SHARE_FILE)
    except KeyError as exc:
        raise ShareError(tr(f"в архиве нет {SHARE_FILE}", f"the archive has no {SHARE_FILE}")) from exc
    if info.file_size > 512 * 1024:
        raise ShareError(tr("манифест слишком большой", "the manifest is too large"))
    try:
        payload = json.loads(archive.read(info).decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise ShareError(tr("манифест не является корректным JSON", "the manifest is not valid JSON")) from exc
    if not isinstance(payload, dict):
        raise ShareError(tr("манифест должен быть объектом", "the manifest must be an object"))
    if payload.get("format") != SHARE_FORMAT:
        raise ShareError(tr("это не проект Kova", "this is not a Kova project"))
    if int(payload.get("version") or 0) != SHARE_VERSION:
        raise ShareError(tr("неподдерживаемая версия формата проекта", "unsupported project format version"))
    return payload


def _extract_archive(archive: zipfile.ZipFile, destination: Path) -> None:
    total = 0
    files = 0
    for info in archive.infolist():
        name = info.filename.replace("\\", "/")
        if name.endswith("/"):
            continue
        if info.is_dir():
            continue
        relative = PurePosixPath(name)
        if relative.is_absolute() or ".." in relative.parts:
            raise ShareError(tr(f"небезопасный путь в архиве: {name}", f"unsafe path in archive: {name}"))
        if (info.external_attr >> 16) & 0o170000 == 0o120000:
            raise ShareError(tr(f"символические ссылки запрещены: {name}", f"symbolic links are not allowed: {name}"))
        files += 1
        total += info.file_size
        if files > MAX_FILES:
            raise ShareError(tr("в архиве слишком много файлов", "the archive contains too many files"))
        if info.file_size > MAX_BYTES or total > MAX_BYTES:
            raise ShareError(tr("архив больше 2 ГБ", "the archive is larger than 2 GB"))
        target = resolve_inside(destination, relative.as_posix())
        target.parent.mkdir(parents=True, exist_ok=True)
        with archive.open(info) as reader, target.open("wb") as writer:
            shutil.copyfileobj(reader, writer)


def import_project(archive_path: Path, parent: Path | None = None) -> dict[str, Any]:
    source = archive_path.expanduser().resolve()
    if not source.is_file():
        raise ShareError(tr("архив проекта не найден", "project archive not found"))
    if source.suffix.lower() != ".kovaproj":
        raise ShareError(tr("поддерживается формат .kovaproj", "only .kovaproj is supported"))
    parent_dir = (parent or default_parent()).expanduser().resolve()
    parent_dir.mkdir(parents=True, exist_ok=True)

    staging = Path(tempfile.mkdtemp(prefix=".kova-import-", dir=parent_dir))
    try:
        with zipfile.ZipFile(source) as archive:
            manifest = _read_manifest(archive)
            _extract_archive(archive, staging)
        if not (staging / ".hub").is_dir():
            raise ShareError(tr("в архиве нет .hub", "the archive has no .hub"))
        name = _safe_name(str(manifest.get("name") or "Kova Project"))
        engine_raw = str(manifest.get("engine") or "generic")
        try:
            engine = Engine(engine_raw)
        except ValueError:
            engine = Engine.generic
        destination = _unique_folder(parent_dir, name)
        staging.rename(destination)
        row = register(destination, name, engine)
        if row is None:
            raise ShareError(tr("проект распакован, но не зарегистрирован", "the project was extracted but not registered"))
        return row
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise
