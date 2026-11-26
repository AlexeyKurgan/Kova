import difflib
import hashlib
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

from ..domain.enums import SnapshotScope
from ..domain.ids import new_id
from ..domain.snapshot import Snapshot, SnapshotFile
from ..security.paths import resolve_inside

EXCLUDE_DIRS = {".git", ".hub", "node_modules", "__pycache__", ".venv"}
MAX_FILE_SIZE = 20 * 1024 * 1024


def _walk(root: Path):
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(root)
        if any(part in EXCLUDE_DIRS for part in rel.parts):
            continue
        if path.stat().st_size > MAX_FILE_SIZE:
            continue
        yield path, rel


def list_snapshots(hub: Path) -> list[Snapshot]:
    directory = hub / "snapshots"
    if not directory.is_dir():
        return []
    snapshots: list[Snapshot] = []
    for path in directory.glob("snap_*.json"):
        try:
            snapshots.append(Snapshot.model_validate_json(path.read_text(encoding="utf-8")))
        except (OSError, ValueError):
            continue
    snapshots.sort(key=lambda item: item.created_at, reverse=True)
    return snapshots


def get_snapshot(hub: Path, snapshot_id: str) -> Snapshot | None:
    try:
        path = resolve_inside(hub, Path("snapshots") / f"{snapshot_id}.json")
    except ValueError:
        return None
    if not path.is_file():
        return None
    return Snapshot.model_validate_json(path.read_text(encoding="utf-8"))


def create_snapshot(
    hub: Path,
    reason: str,
    scope: SnapshotScope = SnapshotScope.project,
    created_by: str = "human",
    root: Path | None = None,
) -> Snapshot:
    root = root or hub.parent
    snapshot_id = new_id("snap")
    files: list[SnapshotFile] = []

    for path, rel in _walk(root):
        data = path.read_bytes()
        files.append(
            SnapshotFile(path=rel.as_posix(), hash=hashlib.sha256(data).hexdigest(), size=len(data))
        )
        target = resolve_inside(hub, Path("snapshots") / snapshot_id / "tree" / rel)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)

    snapshot = Snapshot(
        id=snapshot_id,
        reason=reason,
        scope=scope,
        files=files,
        restore_point=True,
        created_by=created_by,
    )
    (hub / "snapshots" / f"{snapshot_id}.json").write_text(
        snapshot.model_dump_json(indent=2) + "\n", encoding="utf-8"
    )

    index_path = hub / "snapshots" / "index.json"
    index = json.loads(index_path.read_text(encoding="utf-8")) if index_path.is_file() else {}
    index[snapshot_id] = {
        "reason": reason,
        "at": snapshot.created_at.isoformat(),
        "files": len(files),
    }
    index_path.write_text(json.dumps(index, indent=2) + "\n", encoding="utf-8")
    return snapshot


def restore_snapshot(hub: Path, snapshot_id: str) -> Snapshot:
    snapshot = get_snapshot(hub, snapshot_id)
    if snapshot is None:
        raise FileNotFoundError(f"snapshot not found: {snapshot_id}")

    create_snapshot(hub, f"before restore {snapshot_id}", created_by="kova")

    root = hub.parent
    tree = hub / "snapshots" / snapshot_id / "tree"
    for item in snapshot.files:
        source = resolve_inside(hub, Path("snapshots") / snapshot_id / "tree" / item.path)
        target = resolve_inside(root, item.path)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
    return snapshot


def _patch_text(
    hub: Path,
    snapshot_id: str,
    path: str,
    status: str,
    patch_dir: Path | None,
    index: int,
    root: Path | None = None,
) -> tuple[str, bool, bool, int, int]:
    before_path = resolve_inside(
        hub,
        Path("snapshots") / snapshot_id / "tree" / Path(path),
    )
    after_path = resolve_inside(root or hub.parent, Path(path))
    before_bytes = before_path.read_bytes() if before_path.is_file() else b""
    after_bytes = after_path.read_bytes() if after_path.is_file() else b""
    if b"\x00" in before_bytes or b"\x00" in after_bytes:
        return "", True, False, 0, 0
    before = before_bytes.decode("utf-8", errors="replace").splitlines()
    after = after_bytes.decode("utf-8", errors="replace").splitlines()
    patch = "\n".join(
        difflib.unified_diff(
            before,
            after,
            fromfile=f"a/{path}",
            tofile=f"b/{path}",
            n=3,
            lineterm="",
        )
    )
    if patch:
        patch += "\n"
    additions = sum(
        1
        for line in patch.splitlines()
        if line.startswith("+") and not line.startswith("+++")
    )
    deletions = sum(
        1
        for line in patch.splitlines()
        if line.startswith("-") and not line.startswith("---")
    )
    truncated = len(patch) > 120_000
    if truncated:
        patch = patch[:120_000] + "\n\n[diff обрезан]\n"
    if patch_dir is None or not patch:
        return "", False, truncated, additions, deletions
    patch_dir.mkdir(parents=True, exist_ok=True)
    target = patch_dir / f"{index:04d}.diff"
    target.write_text(patch, encoding="utf-8")
    return target.relative_to(hub).as_posix(), False, truncated, additions, deletions


def diff_snapshot(
    hub: Path,
    snapshot_id: str,
    limit: int = 500,
    patch_dir: Path | None = None,
    root: Path | None = None,
) -> dict[str, object]:
    snapshot = get_snapshot(hub, snapshot_id)
    if snapshot is None:
        raise FileNotFoundError(f"snapshot not found: {snapshot_id}")

    before = {item.path: item for item in snapshot.files}
    after: dict[str, tuple[str, int]] = {}
    source_root = root or hub.parent
    for path, rel in _walk(source_root):
        data = path.read_bytes()
        after[rel.as_posix()] = (hashlib.sha256(data).hexdigest(), len(data))

    changes: list[dict[str, object]] = []
    for path, (digest, size) in after.items():
        previous = before.get(path)
        if previous is None:
            changes.append(
                {"path": path, "status": "added", "size": size, "previous_size": 0}
            )
        elif previous.hash != digest:
            changes.append(
                {
                    "path": path,
                    "status": "modified",
                    "size": size,
                    "previous_size": previous.size,
                }
            )
    for path, previous in before.items():
        if path not in after:
            changes.append(
                {
                    "path": path,
                    "status": "deleted",
                    "size": 0,
                    "previous_size": previous.size,
                }
            )

    changes.sort(key=lambda item: (str(item["status"]), str(item["path"])))
    for index, change in enumerate(changes):
        patch_path, binary, truncated, additions, deletions = _patch_text(
            hub,
            snapshot_id,
            str(change["path"]),
            str(change["status"]),
            patch_dir,
            index,
            root,
        )
        change["patch_path"] = patch_path
        change["binary"] = binary
        change["patch_truncated"] = truncated
        change["additions"] = additions
        change["deletions"] = deletions
    total = len(changes)
    return {
        "snapshot_id": snapshot_id,
        "changes": changes[:limit],
        "total": total,
        "truncated": total > limit,
    }


def delete_snapshot(hub: Path, snapshot_id: str) -> bool:
    if not snapshot_id.startswith("snap_"):
        return False
    path = hub / "snapshots" / f"{snapshot_id}.json"
    if not path.is_file():
        return False
    path.unlink(missing_ok=True)
    shutil.rmtree(hub / "snapshots" / snapshot_id, ignore_errors=True)
    index_path = hub / "snapshots" / "index.json"
    if index_path.is_file():
        try:
            index = json.loads(index_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            index = {}
        if isinstance(index, dict):
            index.pop(snapshot_id, None)
            index_path.write_text(json.dumps(index, indent=2) + "\n", encoding="utf-8")
    return True


def cleanup_snapshots(hub: Path, keep: int = 10, days: int = 30) -> dict[str, int]:
    keep = max(1, min(200, int(keep)))
    days = max(1, min(3650, int(days)))
    now = datetime.now(timezone.utc).timestamp()
    cutoff = now - days * 86400
    removed = 0
    for index, snapshot in enumerate(list_snapshots(hub)):
        if index < keep:
            continue
        try:
            stamp = snapshot.created_at.timestamp()
        except (AttributeError, ValueError):
            continue
        if stamp < cutoff and delete_snapshot(hub, snapshot.id):
            removed += 1
    return {"removed": removed}
