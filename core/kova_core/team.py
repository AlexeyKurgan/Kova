"""Team spaces: bundle-based collaboration over a folder or a Git remote.

A team space is a transport, not a server. It stores immutable ``.kovaproj``
bundles plus a small index. Two transports are supported:

* ``folder`` — any local, network or cloud-synced folder (OneDrive, Dropbox,
  iCloud Drive, Nextcloud, NAS).
* ``git`` — any Git remote reachable with HTTPS/SSH. Bundles travel on a
  dedicated branch; the project's own Git history is not touched.

Applying incoming work is an explicit three-way file diff against the last
synced state. Conflicts are never overwritten silently, every apply is backed
up, and the last apply can be rolled back.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any, Literal
from urllib.parse import quote, urlsplit, urlunsplit

from .config import app_data_dir, local_data_dir
from .domain.ledger import LedgerEvent
from .i18n import tr
from .security.paths import resolve_inside
from .security.secrets import delete_secret, get_secret, set_secret
from .sharing import (
    SHARE_FILE,
    ShareError,
    _extract_archive,
    _iter_project_files,
    _read_manifest,
    export_project,
)
from .storage.ledger import append_event
from .storage.projects import load_project

TEAM_DIR = "team"
SHARED_FILE = "team-project.json"
SPACE_FILE = "space.json"
STATE_FILE = "state.json"
LOCAL_CACHE = "local-cache.json"
STORE_INDEX = "kova-team.json"
STORE_FORMAT = "kova-team"
STORE_VERSION = 1
IDENTITY_FILE = "team-identity.json"
MAX_BUNDLE_BYTES = 2 * 1024**3 + 64 * 1024**2
MAX_INCOMING = 3
LEDGER_PATH = ".hub/ledger/events.jsonl"
BUNDLE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")
BRANCH = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,120}$")
LOCK = threading.Lock()


class TeamError(ValueError):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def _json(path: Path, fallback: dict[str, Any]) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return fallback
    return payload if isinstance(payload, dict) else fallback


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    os.replace(temporary, path)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


# ---------------------------------------------------------------------------
# Identity and project identity


def _identity_path() -> Path:
    return app_data_dir() / IDENTITY_FILE


def team_identity() -> dict[str, str]:
    with LOCK:
        path = _identity_path()
        data = _json(path, {})
        device = str(data.get("device_id") or "")
        member = str(data.get("member") or "").strip()
        changed = False
        if not device:
            device = f"dev_{uuid.uuid4().hex[:12]}"
            changed = True
        if not member:
            member = _default_member()
            changed = True
        if changed:
            _write_json(path, {"device_id": device, "member": member})
        return {"device_id": device, "member": member}


def _default_member() -> str:
    for name in ("USERNAME", "USER", "LOGNAME"):
        value = os.environ.get(name)
        if value and value.strip():
            return value.strip()[:60]
    return "member"


def set_member(member: str) -> dict[str, str]:
    clean = member.strip()
    if not clean:
        raise TeamError(tr("имя участника не может быть пустым", "member name cannot be empty"))
    if len(clean) > 60:
        raise TeamError(tr("имя участника длиннее 60 символов", "member name is longer than 60 characters"))
    identity = team_identity()
    _write_json(
        _identity_path(),
        {"device_id": identity["device_id"], "member": clean},
    )
    return {"device_id": identity["device_id"], "member": clean}


def project_uid(root: Path) -> str:
    """Stable project identity shared through bundles (not device-specific)."""
    path = root / ".hub" / SHARED_FILE
    data = _json(path, {})
    uid = str(data.get("uid") or "")
    if uid:
        return uid
    uid = f"tprj_{uuid.uuid4().hex[:20]}"
    _write_json(path, {"uid": uid, "created_at": _now()})
    return uid


# ---------------------------------------------------------------------------
# Space configuration


def _team_dir(root: Path) -> Path:
    return root / ".hub" / TEAM_DIR


def _space_path(root: Path) -> Path:
    return _team_dir(root) / SPACE_FILE


def _state_path(root: Path) -> Path:
    return _team_dir(root) / STATE_FILE


def _space_id(kind: str, location: str, branch: str) -> str:
    digest = hashlib.sha1(
        f"{kind}\n{location}\n{branch}".encode("utf-8")
    ).hexdigest()
    return f"tsp_{digest[:12]}"


def _folder_index_id(location: Path) -> str | None:
    path = location / STORE_INDEX
    if not path.is_file():
        return None
    payload = _json(path, {})
    if not payload:
        raise TeamError(
            tr("индекс пространства повреждён", "the space index is damaged")
        )
    if payload.get("format") != STORE_FORMAT:
        raise TeamError(
            tr("папка не является командным пространством Kova", "the folder is not a Kova team space")
        )
    if int(payload.get("version") or 0) != STORE_VERSION:
        raise TeamError(
            tr("неподдерживаемая версия командного пространства", "unsupported team space version")
        )
    space_id = str(payload.get("space_id") or "")
    if not space_id:
        raise TeamError(
            tr("в индексе пространства нет идентификатора", "the space index has no identifier")
        )
    return space_id


def _normalize_location(kind: str, location: str) -> str:
    value = location.strip()
    if not value or "\n" in value or "\r" in value:
        raise TeamError(tr("укажи папку или Git-адрес", "provide a folder or a Git URL"))
    if value.startswith("-"):
        raise TeamError(tr("некорректный адрес пространства", "invalid space address"))
    if kind == "folder":
        path = Path(value).expanduser()
        if not path.is_absolute():
            raise TeamError(tr("нужен абсолютный путь к папке", "an absolute folder path is required"))
        return str(path.resolve())
    if kind != "git":
        raise TeamError(tr("неизвестный тип пространства", "unknown space type"))
    if value.startswith("file://"):
        return value
    parsed = urlsplit(value)
    if parsed.scheme in {"https", "ssh", "git"}:
        if not parsed.netloc:
            raise TeamError(tr("в Git-адресе нет хоста", "the Git URL has no host"))
        return value
    if re.match(r"^[\w.-]+@[\w.-]+:.+$", value):
        return value
    path = Path(value).expanduser()
    if path.is_absolute() or path.exists():
        return str(path.resolve())
    raise TeamError(
        tr(
            "Git-адрес должен начинаться с https://, ssh:// или git@",
            "the Git URL must start with https://, ssh:// or git@",
        )
    )


def load_space(root: Path) -> dict[str, Any] | None:
    data = _json(_space_path(root), {})
    if not data.get("id") or data.get("kind") not in {"folder", "git"}:
        return None
    if not data.get("location"):
        return None
    return data


def require_space(root: Path) -> dict[str, Any]:
    space = load_space(root)
    if space is None:
        raise TeamError(
            tr("проект не подключён к командному пространству", "the project is not connected to a team space")
        )
    return space


def _token_key(space_id: str) -> str:
    return f"team_token_{space_id}"


def connect_space(
    root: Path,
    kind: Literal["folder", "git"],
    location: str,
    name: str = "",
    branch: str = "kova-team",
    token: str | None = None,
    member: str | None = None,
) -> dict[str, Any]:
    root = root.resolve()
    if not (root / ".hub").is_dir():
        raise TeamError(tr("в проекте нет .hub", "the project has no .hub"))
    location = _normalize_location(kind, location)
    branch = (branch or "kova-team").strip()
    if kind == "git":
        if not BRANCH.match(branch) or ".." in branch or branch.endswith("/"):
            raise TeamError(tr("некорректное имя ветки", "invalid branch name"))
    else:
        branch = ""

    if kind == "folder":
        target = Path(location)
        inside = target == root or root in target.parents
        if inside:
            raise TeamError(
                tr(
                    "папка пространства не может быть внутри проекта",
                    "the space folder cannot be inside the project",
                )
            )

    # A folder can be mounted at different paths on different machines, so the
    # identifier stored in the shared index wins over the local path hash.
    space_id = _folder_index_id(Path(location)) if kind == "folder" else None
    if not space_id:
        space_id = _space_id(kind, location, branch)
    if token is not None:
        if token.strip():
            set_secret(_token_key(space_id), token.strip())
        else:
            delete_secret(_token_key(space_id))
    if member is not None:
        set_member(member)

    store = _store(
        {
            "id": space_id,
            "kind": kind,
            "location": location,
            "branch": branch,
        }
    )
    store.validate()

    previous = load_space(root)
    if previous and previous.get("id") == space_id:
        label = str(previous.get("name") or name or "").strip()
    else:
        label = name.strip()
    if not label:
        label = Path(location).name if kind == "folder" else f"{location.split('/')[-1] or 'team'}#{branch}"
    label = label[:80]

    space = {
        "id": space_id,
        "kind": kind,
        "name": label,
        "location": location,
        "branch": branch,
        "connected_at": _now(),
        "app_version": _version(),
    }
    _write_json(_space_path(root), space)
    if previous and previous.get("id") != space_id:
        _reset_state(root, space_id)
    state = _state(root, space_id)
    if not state.get("head") and not state.get("applied") and not state.get("base"):
        state["base"] = _local_manifest(root)
        _save_state(root, space_id, state)
    _event(
        root,
        "team.connected",
        subject=space_id,
        data={"kind": kind, "name": label},
    )
    return space_info(root)


def leave_space(root: Path) -> dict[str, Any]:
    space = require_space(root)
    _space_path(root).unlink(missing_ok=True)
    _event(root, "team.left", subject=space["id"], data={"name": space.get("name")})
    return {"ok": True, "space": None}


def space_info(root: Path) -> dict[str, Any]:
    identity = team_identity()
    space = load_space(root)
    if space is None:
        return {
            "connected": False,
            "space": None,
            "identity": identity,
            "project_uid": project_uid(root),
        }
    state = _state(root, space["id"])
    return {
        "connected": True,
        "space": {
            "id": space["id"],
            "kind": space["kind"],
            "name": space.get("name") or "",
            "location": space["location"],
            "branch": space.get("branch") or "",
            "connected_at": space.get("connected_at") or "",
            "has_token": bool(get_secret(_token_key(space["id"]))),
        },
        "identity": identity,
        "project_uid": project_uid(root),
        "head": state.get("head") or "",
        "applied": len(state.get("applied") or []),
        "base_files": len(state.get("base") or {}),
        "last_apply_at": state.get("last_apply_at") or "",
        "can_rollback": _rollback_pointer(root, space["id"]),
    }


def _rollback_pointer(root: Path, space_id: str) -> bool:
    pointer = _json(_team_dir(root) / "last-apply.json", {})
    return (
        bool(pointer.get("bundle_id"))
        and str(pointer.get("space_id") or "") == space_id
    )


def _version() -> str:
    from . import __version__

    return __version__


# ---------------------------------------------------------------------------
# Device-local state


def _fresh_state() -> dict[str, Any]:
    return {
        "head": "",
        "base": {},
        "applied": [],
        "events": [],
        "last_apply_at": "",
        "last_check_at": "",
    }


def _load_all_state(root: Path) -> dict[str, Any]:
    data = _json(_state_path(root), {})
    spaces = data.get("spaces")
    return {"version": 1, "spaces": spaces if isinstance(spaces, dict) else {}}


def _state(root: Path, space_id: str) -> dict[str, Any]:
    all_state = _load_all_state(root)
    current = all_state["spaces"].get(space_id)
    if not isinstance(current, dict):
        current = _fresh_state()
        all_state["spaces"][space_id] = current
        _write_json(_state_path(root), all_state)
    for key, value in _fresh_state().items():
        current.setdefault(key, value)
    return current


def _save_state(root: Path, space_id: str, state: dict[str, Any]) -> None:
    all_state = _load_all_state(root)
    all_state["spaces"][space_id] = state
    _write_json(_state_path(root), all_state)


def _reset_state(root: Path, space_id: str) -> None:
    _save_state(root, space_id, _fresh_state())


def _event(root: Path, kind: str, subject: str = "", data: dict[str, Any] | None = None) -> None:
    try:
        append_event(
            root / ".hub",
            LedgerEvent(type=kind, actor="human", subject=subject, data=data or {}),
        )
    except OSError:
        pass


# ---------------------------------------------------------------------------
# Local manifest (hashes used for the three-way diff)


def _local_manifest(root: Path) -> dict[str, dict[str, Any]]:
    cache_path = _team_dir(root) / LOCAL_CACHE
    cached = _json(cache_path, {})
    result: dict[str, dict[str, Any]] = {}
    fresh: dict[str, Any] = {}
    for path, relative in _iter_project_files(root):
        key = relative.as_posix()
        try:
            stat = path.stat()
        except OSError:
            continue
        entry = cached.get(key)
        if (
            isinstance(entry, dict)
            and entry.get("mtime") == stat.st_mtime_ns
            and entry.get("size") == stat.st_size
            and isinstance(entry.get("sha256"), str)
        ):
            digest = entry["sha256"]
        else:
            try:
                digest = _sha256(path)
            except OSError:
                continue
        result[key] = {"sha256": digest, "size": stat.st_size}
        fresh[key] = {
            "mtime": stat.st_mtime_ns,
            "size": stat.st_size,
            "sha256": digest,
        }
    try:
        _write_json(cache_path, fresh)
    except OSError:
        pass
    return result


def _archive_manifest(extracted: Path) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for path, relative in _iter_project_files(extracted):
        key = relative.as_posix()
        if key == SHARE_FILE:
            continue
        try:
            stat = path.stat()
            result[key] = {"sha256": _sha256(path), "size": stat.st_size}
        except OSError:
            continue
    return result


def _diff(
    base: dict[str, dict[str, Any]],
    local: dict[str, dict[str, Any]],
    remote: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    changes: list[dict[str, Any]] = []
    for path in sorted(set(base) | set(local) | set(remote)):
        before = base.get(path)
        mine = local.get(path)
        theirs = remote.get(path)
        if theirs == before:
            continue
        conflict = mine != before and mine != theirs
        if theirs is None:
            status = "deleted"
        elif before is None or mine is None:
            status = "added"
        else:
            status = "modified"
        changes.append(
            {
                "path": path,
                "status": status,
                # The ledger is append-only and merged, never treated as a conflict.
                "conflict": bool(conflict) and path != LEDGER_PATH,
                "local": mine,
                "remote": theirs,
                "size": (theirs or mine or {}).get("size", 0),
            }
        )
    return changes


# ---------------------------------------------------------------------------
# Stores


def _store(space: dict[str, Any]):
    token = get_secret(_token_key(space["id"]))
    if space["kind"] == "git":
        return _GitStore(space, token)
    return _FolderStore(space)


def _empty_index(space_id: str) -> dict[str, Any]:
    return {
        "format": STORE_FORMAT,
        "version": STORE_VERSION,
        "space_id": space_id,
        "updated_at": _now(),
        "bundles": [],
    }


def _validate_index(payload: dict[str, Any], space_id: str) -> dict[str, Any]:
    if payload.get("format") != STORE_FORMAT:
        raise TeamError(
            tr("папка не является командным пространством Kova", "the folder is not a Kova team space")
        )
    if int(payload.get("version") or 0) != STORE_VERSION:
        raise TeamError(
            tr("неподдерживаемая версия командного пространства", "unsupported team space version")
        )
    if str(payload.get("space_id") or "") != space_id:
        raise TeamError(
            tr(
                "пространство принадлежит другому проекту или адресу",
                "the space belongs to another project or address",
            )
        )
    bundles = payload.get("bundles")
    if not isinstance(bundles, list):
        payload["bundles"] = []
    return payload


def _merge_index(
    index: dict[str, Any],
    meta: dict[str, Any],
) -> dict[str, Any]:
    entry = {key: value for key, value in meta.items() if key != "files"}
    rows = [
        row
        for row in index.get("bundles") or []
        if isinstance(row, dict) and row.get("id") != entry.get("id")
    ]
    rows.append(entry)
    rows.sort(key=lambda row: str(row.get("created_at") or ""), reverse=True)
    index["bundles"] = rows
    index["updated_at"] = _now()
    return index


class _FolderStore:
    def __init__(self, space: dict[str, Any]) -> None:
        self.space = space
        self.root = Path(space["location"])

    def validate(self) -> None:
        if self.root.exists() and not self.root.is_dir():
            raise TeamError(tr("путь пространства не является папкой", "the space path is not a folder"))
        index = self._read_index()
        if index is not None:
            _validate_index(index, self.space["id"])
        self.root.mkdir(parents=True, exist_ok=True)
        (self.root / "bundles").mkdir(parents=True, exist_ok=True)

    def _index_path(self) -> Path:
        return self.root / STORE_INDEX

    def _read_index(self) -> dict[str, Any] | None:
        if not self._index_path().is_file():
            return None
        payload = _json(self._index_path(), {})
        if not payload:
            raise TeamError(tr("индекс пространства повреждён", "the space index is damaged"))
        return _validate_index(payload, self.space["id"])

    def sync(self) -> None:
        self.validate()

    def index(self) -> dict[str, Any]:
        return self._read_index() or _empty_index(self.space["id"])

    def meta(self, bundle_id: str) -> dict[str, Any]:
        _check_bundle_id(bundle_id)
        path = self.root / "bundles" / f"{bundle_id}.json"
        if not path.is_file():
            raise TeamError(tr("описание бандла не найдено", "bundle metadata not found"))
        payload = _json(path, {})
        return self._check_meta(payload, bundle_id)

    def _check_meta(self, payload: dict[str, Any], bundle_id: str) -> dict[str, Any]:
        if payload.get("id") != bundle_id:
            raise TeamError(tr("бандл повреждён", "the bundle is damaged"))
        if payload.get("space_id") != self.space["id"]:
            raise TeamError(tr("бандл из другого пространства", "the bundle is from another space"))
        return payload

    def put(self, bundle: Path, meta: dict[str, Any]) -> None:
        self.validate()
        bundle_id = str(meta["id"])
        target = self.root / "bundles" / f"{bundle_id}.kovaproj"
        if target.exists():
            raise TeamError(tr("такой бандл уже существует", "this bundle already exists"))
        directory = target.parent
        temporary = directory / f".{bundle_id}.tmp"
        shutil.copy2(bundle, temporary)
        os.replace(temporary, target)
        sidecar = directory / f"{bundle_id}.json"
        _write_json(sidecar, meta)
        for _attempt in range(3):
            index = self._read_index() or _empty_index(self.space["id"])
            index = _merge_index(index, meta)
            _write_json(self._index_path(), index)
            current = self._read_index() or _empty_index(self.space["id"])
            if any(row.get("id") == bundle_id for row in current["bundles"]):
                return
        raise TeamError(
            tr(
                "не удалось обновить индекс пространства — повтори публикацию",
                "could not update the space index — publish again",
            )
        )

    def fetch(self, bundle_id: str, destination: Path) -> None:
        _check_bundle_id(bundle_id)
        source = self.root / "bundles" / f"{bundle_id}.kovaproj"
        if not source.is_file():
            raise TeamError(tr("бандл не найден в пространстве", "the bundle was not found in the space"))
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)


class _GitStore:
    def __init__(self, space: dict[str, Any], token: str) -> None:
        self.space = space
        self.token = token
        self.url = str(space["location"])
        self.branch = str(space.get("branch") or "kova-team")
        safe = re.sub(r"[^A-Za-z0-9_.-]", "-", space["id"])
        self.repo = local_data_dir() / "team" / "repos" / safe

    def _auth_url(self) -> str:
        if not self.token:
            return self.url
        parsed = urlsplit(self.url)
        if parsed.scheme != "https" or "@" in parsed.netloc:
            return self.url
        host = (parsed.hostname or "").lower()
        if "github" in host:
            user = "x-access-token"
        elif "gitlab" in host:
            user = "oauth2"
        else:
            user = "token"
        netloc = f"{user}:{quote(self.token, safe='')}@{parsed.netloc}"
        return urlunsplit((parsed.scheme, netloc, parsed.path, parsed.query, parsed.fragment))

    def _sanitize(self, text: str) -> str:
        clean = text
        if self.token:
            clean = clean.replace(self.token, "***")
            clean = clean.replace(quote(self.token, safe=""), "***")
        return clean.strip()

    def _git(self, args: list[str], check: bool = True) -> subprocess.CompletedProcess[str]:
        environment = os.environ.copy()
        environment["GIT_TERMINAL_PROMPT"] = "0"
        environment.setdefault("GIT_CONFIG_NOSYSTEM", "0")
        try:
            result = subprocess.run(
                ["git", *args],
                cwd=str(self.repo) if self.repo.is_dir() else None,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=300,
                env=environment,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            raise TeamError(
                tr(
                    f"не удалось запустить git: {exc}",
                    f"could not run git: {exc}",
                )
            ) from exc
        if check and result.returncode != 0:
            message = result.stderr or result.stdout or "git failed"
            raise TeamError(self._sanitize(message)[:800])
        return result

    def validate(self) -> None:
        if shutil.which("git") is None:
            raise TeamError(tr("Git не установлен", "Git is not installed"))
        result = self._git(
            ["ls-remote", "--heads", self._auth_url(), self.branch],
            check=False,
        )
        if result.returncode != 0:
            message = self._sanitize(result.stderr or result.stdout)
            raise TeamError(
                tr(
                    f"Git-пространство недоступно: {message}",
                    f"the Git space is unavailable: {message}",
                )
            )

    def _remote_has_branch(self) -> bool:
        result = self._git(
            ["ls-remote", "--exit-code", "--heads", self._auth_url(), self.branch],
            check=False,
        )
        return result.returncode == 0

    def _ensure_repo(self) -> None:
        if (self.repo / ".git").is_dir():
            self._git(["remote", "set-url", "origin", self.url], check=False)
            return
        self.repo.parent.mkdir(parents=True, exist_ok=True)
        if self.repo.exists() and any(self.repo.iterdir()):
            shutil.rmtree(self.repo, ignore_errors=True)
        clone = self._git(
            ["clone", "--quiet", "--no-checkout", self._auth_url(), str(self.repo)],
            check=False,
        )
        if clone.returncode != 0:
            if self.repo.exists():
                shutil.rmtree(self.repo, ignore_errors=True)
            self.repo.mkdir(parents=True, exist_ok=True)
            self._git(["init", "--quiet"], check=True)
            self._git(["remote", "add", "origin", self.url], check=False)
        else:
            # Never persist a token in .git/config.
            self._git(["remote", "set-url", "origin", self.url], check=False)

    def _checkout(self) -> None:
        if self._remote_has_branch():
            fetched = self._git(
                ["fetch", "--quiet", "--depth", "1", self._auth_url(), self.branch],
                check=False,
            )
            if fetched.returncode != 0:
                message = self._sanitize(fetched.stderr or fetched.stdout)
                raise TeamError(
                    tr(f"не удалось получить ветку: {message}", f"could not fetch the branch: {message}")
                )
            self._git(["reset", "--hard", "--quiet", "FETCH_HEAD"])
            self._git(["checkout", "--quiet", "-B", self.branch, "FETCH_HEAD"])
        else:
            self._git(["checkout", "--quiet", "--orphan", self.branch], check=False)
            for name in ("bundles", STORE_INDEX):
                path = self.repo / name
                if path.is_dir():
                    shutil.rmtree(path, ignore_errors=True)
                elif path.is_file():
                    path.unlink(missing_ok=True)

    def sync(self) -> None:
        self._ensure_repo()
        self._checkout()

    def index(self) -> dict[str, Any]:
        path = self.repo / STORE_INDEX
        if not path.is_file():
            return _empty_index(self.space["id"])
        payload = _json(path, {})
        if not payload:
            raise TeamError(tr("индекс пространства повреждён", "the space index is damaged"))
        return _validate_index(payload, self.space["id"])

    def meta(self, bundle_id: str) -> dict[str, Any]:
        _check_bundle_id(bundle_id)
        path = self.repo / "bundles" / f"{bundle_id}.json"
        if not path.is_file():
            raise TeamError(tr("описание бандла не найдено", "bundle metadata not found"))
        payload = _json(path, {})
        if payload.get("id") != bundle_id:
            raise TeamError(tr("бандл повреждён", "the bundle is damaged"))
        if payload.get("space_id") != self.space["id"]:
            raise TeamError(tr("бандл из другого пространства", "the bundle is from another space"))
        return payload

    def _commit(self, bundle: Path, meta: dict[str, Any]) -> None:
        bundle_id = str(meta["id"])
        directory = self.repo / "bundles"
        directory.mkdir(parents=True, exist_ok=True)
        target = directory / f"{bundle_id}.kovaproj"
        if target.exists():
            raise TeamError(tr("такой бандл уже существует", "this bundle already exists"))
        shutil.copy2(bundle, target)
        _write_json(directory / f"{bundle_id}.json", meta)
        index = self.index()
        index = _merge_index(index, meta)
        _write_json(self.repo / STORE_INDEX, index)
        identity = team_identity()
        self._git(["add", "--all"])
        self._git(
            [
                "-c",
                f"user.name={identity['member']}",
                "-c",
                f"user.email={identity['device_id']}@kova.local",
                "commit",
                "--quiet",
                "-m",
                f"kova team: {meta.get('message') or bundle_id}",
            ]
        )
        pushed = self._git(
            ["push", "--quiet", self._auth_url(), f"HEAD:refs/heads/{self.branch}"],
            check=False,
        )
        if pushed.returncode == 0:
            return
        # Another device may have published first: resync and replay once.
        self.sync()
        if (self.repo / "bundles" / f"{bundle_id}.kovaproj").exists():
            raise TeamError(
                tr("конфликт публикации — повтори", "publish conflict — try again")
            )
        shutil.copy2(bundle, target)
        _write_json(directory / f"{bundle_id}.json", meta)
        index = self.index()
        index = _merge_index(index, meta)
        _write_json(self.repo / STORE_INDEX, index)
        self._git(["add", "--all"])
        self._git(
            [
                "-c",
                f"user.name={identity['member']}",
                "-c",
                f"user.email={identity['device_id']}@kova.local",
                "commit",
                "--quiet",
                "-m",
                f"kova team: {meta.get('message') or bundle_id}",
            ]
        )
        pushed = self._git(
            ["push", "--quiet", self._auth_url(), f"HEAD:refs/heads/{self.branch}"],
            check=False,
        )
        if pushed.returncode != 0:
            message = self._sanitize(pushed.stderr or pushed.stdout)
            raise TeamError(
                tr(f"не удалось опубликовать: {message}", f"could not publish: {message}")
            )

    def put(self, bundle: Path, meta: dict[str, Any]) -> None:
        self.sync()
        self._commit(bundle, meta)

    def fetch(self, bundle_id: str, destination: Path) -> None:
        _check_bundle_id(bundle_id)
        self.sync()
        source = self.repo / "bundles" / f"{bundle_id}.kovaproj"
        if not source.is_file():
            raise TeamError(tr("бандл не найден в пространстве", "the bundle was not found in the space"))
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)


# ---------------------------------------------------------------------------
# Publish / check / preview / apply / rollback


def _check_bundle_id(bundle_id: str) -> None:
    if not BUNDLE_ID.match(bundle_id or ""):
        raise TeamError(tr("некорректный идентификатор бандла", "invalid bundle id"))


def _new_bundle_id() -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return f"{stamp}-{uuid.uuid4().hex[:8]}"


def publish(root: Path, message: str = "") -> dict[str, Any]:
    root = root.resolve()
    space = require_space(root)
    identity = team_identity()
    uid = project_uid(root)
    _check_bundle_id(_new_bundle_id())

    state = _state(root, space["id"])
    bundle_id = _new_bundle_id()
    files = _local_manifest(root)
    if len(files) > 20_000:
        raise TeamError(tr("в проекте больше 20 000 файлов", "the project has more than 20,000 files"))

    with tempfile.TemporaryDirectory(prefix="kova-team-") as temporary:
        bundle = Path(temporary) / f"{bundle_id}.kovaproj"
        export_project(
            root,
            bundle,
            extra={
                "project_uid": uid,
                "bundle_id": bundle_id,
                "author": identity["member"],
                "device": identity["device_id"],
                "team_space": space["id"],
            },
        )
        size = bundle.stat().st_size
        if size > MAX_BUNDLE_BYTES:
            raise TeamError(tr("бандл больше 2 ГБ", "the bundle is larger than 2 GB"))
        digest = _sha256(bundle)
        meta = {
            "format": STORE_FORMAT,
            "version": STORE_VERSION,
            "id": bundle_id,
            "space_id": space["id"],
            "project_uid": uid,
            "project": load_project(root / ".hub").name,
            "engine": load_project(root / ".hub").engine.value,
            "author": identity["member"],
            "device": identity["device_id"],
            "message": message.strip()[:200],
            "created_at": _now(),
            "sha256": digest,
            "bytes": size,
            "files": len(files),
            "file_map": files,
            "base": state.get("head") or "",
        }
        store = _store(space)
        store.put(bundle, meta)

    state["head"] = bundle_id
    state["base"] = files
    _remember(state, bundle_id, "publish")
    state["last_apply_at"] = ""
    _save_state(root, space["id"], state)
    _event(
        root,
        "team.published",
        subject=bundle_id,
        data={"files": len(files), "bytes": size, "message": meta["message"]},
    )
    return {
        "bundle": _public_meta(meta),
        "space": space_info(root),
    }


def _remember(state: dict[str, Any], bundle_id: str, action: str) -> None:
    applied = [str(item) for item in state.get("applied") or []]
    if bundle_id in applied:
        applied.remove(bundle_id)
    applied.insert(0, bundle_id)
    state["applied"] = applied[:500]
    events = [item for item in state.get("events") or [] if isinstance(item, dict)]
    events.insert(0, {"id": bundle_id, "action": action, "at": _now()})
    state["events"] = events[:200]


def _public_meta(meta: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in meta.items() if key != "file_map"}


def check_incoming(root: Path) -> dict[str, Any]:
    root = root.resolve()
    space = require_space(root)
    store = _store(space)
    store.sync()
    index = store.index()
    state = _state(root, space["id"])
    uid = project_uid(root)
    applied = set(str(item) for item in state.get("applied") or [])
    bundles: list[dict[str, Any]] = []
    for row in index.get("bundles") or []:
        if not isinstance(row, dict):
            continue
        if row.get("project_uid") != uid:
            continue
        bundle_id = str(row.get("id") or "")
        if not BUNDLE_ID.match(bundle_id):
            continue
        if bundle_id in applied:
            continue
        bundles.append(_public_meta(row))
    bundles.sort(key=lambda row: str(row.get("created_at") or ""), reverse=True)
    state["last_check_at"] = _now()
    _save_state(root, space["id"], state)
    return {"space": space_info(root), "bundles": bundles}


def _incoming_path(root: Path, bundle_id: str) -> Path:
    return _team_dir(root) / "incoming" / bundle_id


def _download(root: Path, space: dict[str, Any], bundle_id: str, meta: dict[str, Any]) -> Path:
    _check_bundle_id(bundle_id)
    directory = _incoming_path(root, bundle_id)
    archive = directory / f"{bundle_id}.kovaproj"
    if archive.is_file():
        return archive
    directory.mkdir(parents=True, exist_ok=True)
    temporary = directory / f".{bundle_id}.download"
    _store(space).fetch(bundle_id, temporary)
    size = temporary.stat().st_size
    if size > MAX_BUNDLE_BYTES:
        temporary.unlink(missing_ok=True)
        raise TeamError(tr("бандл больше 2 ГБ", "the bundle is larger than 2 GB"))
    if _sha256(temporary) != str(meta.get("sha256") or ""):
        temporary.unlink(missing_ok=True)
        raise TeamError(
            tr("контрольная сумма бандла не совпала", "bundle checksum mismatch")
        )
    os.replace(temporary, archive)
    return archive


def _extract_incoming(
    root: Path, space: dict[str, Any], bundle_id: str, meta: dict[str, Any]
) -> Path:
    directory = _incoming_path(root, bundle_id)
    extracted = directory / "tree"
    marker = directory / ".extracted"
    if marker.is_file() and extracted.is_dir():
        return extracted
    archive = _download(root, space, bundle_id, meta)
    if extracted.exists():
        shutil.rmtree(extracted, ignore_errors=True)
    extracted.mkdir(parents=True, exist_ok=True)
    try:
        with zipfile.ZipFile(archive) as bundle:
            manifest = _read_manifest(bundle)
            if manifest.get("project_uid") != meta.get("project_uid"):
                raise TeamError(
                    tr(
                        "бандл относится к другому проекту",
                        "the bundle belongs to another project",
                    )
                )
            if manifest.get("bundle_id") != bundle_id:
                raise TeamError(tr("идентификатор бандла не совпал", "bundle id mismatch"))
            _extract_archive(bundle, extracted)
    except (zipfile.BadZipFile, ShareError) as exc:
        shutil.rmtree(extracted, ignore_errors=True)
        raise TeamError(str(exc)) from exc
    marker.write_text(_now(), encoding="utf-8")
    _prune_incoming(root)
    return extracted


def _prune_incoming(root: Path) -> None:
    directory = _team_dir(root) / "incoming"
    if not directory.is_dir():
        return
    rows = sorted(
        (path for path in directory.iterdir() if path.is_dir()),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    for stale in rows[MAX_INCOMING:]:
        shutil.rmtree(stale, ignore_errors=True)


def _ledger_rows(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return rows
    for line in lines:
        if not line.strip():
            continue
        try:
            payload = json.loads(line)
        except ValueError:
            continue
        if isinstance(payload, dict):
            rows.append(payload)
    return rows


def _merge_ledger(root: Path, extracted: Path) -> None:
    """Union the append-only ledger so two devices never fight over history."""
    local = root / LEDGER_PATH
    remote = extracted / LEDGER_PATH
    if not local.is_file() and not remote.is_file():
        return
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    for source in (local, remote):
        for row in _ledger_rows(source):
            key = str(row.get("id") or json.dumps(row, sort_keys=True))
            if key in seen:
                continue
            seen.add(key)
            rows.append(row)
    rows.sort(key=lambda row: str(row.get("at") or ""))
    remote.parent.mkdir(parents=True, exist_ok=True)
    remote.write_text(
        "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows),
        encoding="utf-8",
    )


def preview_bundle(root: Path, bundle_id: str) -> dict[str, Any]:
    root = root.resolve()
    space = require_space(root)
    _check_bundle_id(bundle_id)
    meta = _store(space).meta(bundle_id)
    if meta.get("project_uid") != project_uid(root):
        raise TeamError(tr("бандл относится к другому проекту", "the bundle belongs to another project"))
    extracted = _extract_incoming(root, space, bundle_id, meta)
    _merge_ledger(root, extracted)
    state = _state(root, space["id"])
    local = _local_manifest(root)
    remote = _archive_manifest(extracted)
    changes = _diff(state.get("base") or {}, local, remote)
    conflicts = sum(1 for row in changes if row["conflict"])
    return {
        "bundle": _public_meta(meta),
        "changes": changes,
        "stats": {
            "added": sum(1 for row in changes if row["status"] == "added"),
            "modified": sum(1 for row in changes if row["status"] == "modified"),
            "deleted": sum(1 for row in changes if row["status"] == "deleted"),
            "conflicts": conflicts,
        },
        "can_apply": conflicts == 0,
        "base_bundle": state.get("head") or "",
    }


def apply_bundle(
    root: Path,
    bundle_id: str,
    resolutions: dict[str, str] | None = None,
    force: bool = False,
) -> dict[str, Any]:
    root = root.resolve()
    space = require_space(root)
    preview = preview_bundle(root, bundle_id)
    meta = preview["bundle"]
    state = _state(root, space["id"])
    decisions = resolutions or {}
    conflicts = [row["path"] for row in preview["changes"] if row["conflict"]]
    if conflicts and not force:
        if not decisions:
            raise TeamError(
                tr(
                    "есть конфликты — выбери, какие версии оставить",
                    "there are conflicts — choose which versions to keep",
                )
            )
        missing = [path for path in conflicts if decisions.get(path) not in {"local", "remote"}]
        if missing:
            raise TeamError(
                tr(
                    f"не решены конфликты: {len(missing)}",
                    f"unresolved conflicts: {len(missing)}",
                )
            )

    operations: list[tuple[str, str]] = []
    for row in preview["changes"]:
        if row["conflict"]:
            choice = "remote" if force else decisions.get(row["path"], "local")
            if choice != "remote":
                continue
        operations.append((row["path"], row["status"]))

    extracted = _incoming_path(root, bundle_id) / "tree"
    if operations:
        _backup(root, space, bundle_id, [path for path, _ in operations], state)
    written = 0
    deleted = 0
    for path, status in operations:
        target = resolve_inside(root, path)
        if status == "deleted":
            if target.is_file() or target.is_symlink():
                target.unlink()
                deleted += 1
            _prune_empty(root, target.parent)
            continue
        source = resolve_inside(extracted, path)
        if not source.is_file():
            raise TeamError(tr(f"в бандле нет файла {path}", f"the bundle has no file {path}"))
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_name(f".{target.name}.kova-tmp")
        shutil.copy2(source, temporary)
        os.replace(temporary, target)
        written += 1

    state["head"] = bundle_id
    state["base"] = _archive_manifest(extracted)
    state["last_apply_at"] = _now()
    _remember(state, bundle_id, "apply")
    _save_state(root, space["id"], state)
    _write_json(
        _team_dir(root) / "last-apply.json",
        {"bundle_id": bundle_id, "space_id": space["id"], "at": _now()},
    )
    _event(
        root,
        "team.applied",
        subject=bundle_id,
        data={
            "written": written,
            "deleted": deleted,
            "conflicts": len(conflicts),
            "author": meta.get("author") or "",
        },
    )
    return {
        "ok": True,
        "bundle": meta,
        "written": written,
        "deleted": deleted,
        "conflicts": len(conflicts),
        "space": space_info(root),
    }


def _backup(
    root: Path,
    space: dict[str, Any],
    bundle_id: str,
    paths: list[str],
    state: dict[str, Any],
) -> None:
    directory = _team_dir(root) / "backups" / bundle_id
    if directory.exists():
        shutil.rmtree(directory, ignore_errors=True)
    directory.mkdir(parents=True, exist_ok=True)
    rows: dict[str, Any] = {}
    for path in paths:
        target = resolve_inside(root, path)
        if target.is_file():
            destination = resolve_inside(directory / "files", path)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(target, destination)
            rows[path] = {"existed": True}
        else:
            rows[path] = {"existed": False}
    _write_json(
        directory / "manifest.json",
        {
            "bundle_id": bundle_id,
            "space_id": space["id"],
            "at": _now(),
            "paths": rows,
            "previous_state": state,
        },
    )


def _prune_empty(root: Path, directory: Path) -> None:
    current = directory
    while current != root and root in current.parents:
        try:
            if any(current.iterdir()):
                return
            current.rmdir()
        except OSError:
            return
        current = current.parent


def rollback_last(root: Path) -> dict[str, Any]:
    root = root.resolve()
    space = require_space(root)
    pointer = _json(_team_dir(root) / "last-apply.json", {})
    if str(pointer.get("space_id") or "") != space["id"]:
        raise TeamError(tr("нет применения для отката", "there is no apply to roll back"))
    bundle_id = str(pointer.get("bundle_id") or "")
    _check_bundle_id(bundle_id)
    directory = _team_dir(root) / "backups" / bundle_id
    manifest = _json(directory / "manifest.json", {})
    rows = manifest.get("paths")
    if not isinstance(rows, dict) or not rows:
        raise TeamError(tr("нет резервной копии для отката", "there is no backup to roll back"))
    restored = 0
    removed = 0
    for path, info in rows.items():
        if not isinstance(info, dict):
            continue
        target = resolve_inside(root, path)
        if info.get("existed"):
            source = resolve_inside(directory / "files", path)
            if not source.is_file():
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            temporary = target.with_name(f".{target.name}.kova-tmp")
            shutil.copy2(source, temporary)
            os.replace(temporary, target)
            restored += 1
        elif target.is_file() or target.is_symlink():
            target.unlink()
            removed += 1
            _prune_empty(root, target.parent)
    previous = manifest.get("previous_state")
    if isinstance(previous, dict):
        _save_state(root, space["id"], previous)
    (_team_dir(root) / "last-apply.json").unlink(missing_ok=True)
    shutil.rmtree(directory, ignore_errors=True)
    _event(
        root,
        "team.rolled_back",
        subject=bundle_id,
        data={"restored": restored, "removed": removed},
    )
    return {
        "ok": True,
        "bundle_id": bundle_id,
        "restored": restored,
        "removed": removed,
        "space": space_info(root),
    }


def history(root: Path, limit: int = 50) -> dict[str, Any]:
    root = root.resolve()
    space = require_space(root)
    state = _state(root, space["id"])
    index: dict[str, dict[str, Any]] = {}
    try:
        for row in _store(space).index().get("bundles") or []:
            if isinstance(row, dict) and row.get("id"):
                index[str(row["id"])] = _public_meta(row)
    except TeamError:
        pass
    rows: list[dict[str, Any]] = []
    for event in state.get("events") or []:
        if not isinstance(event, dict):
            continue
        bundle_id = str(event.get("id") or "")
        meta = index.get(bundle_id, {})
        rows.append(
            {
                "id": bundle_id,
                "action": event.get("action") or "",
                "at": event.get("at") or "",
                "author": meta.get("author") or "",
                "message": meta.get("message") or "",
                "files": meta.get("files") or 0,
            }
        )
        if len(rows) >= limit:
            break
    return {"space": space_info(root), "history": rows}
