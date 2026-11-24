import hashlib
import json
import shutil
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
) -> Snapshot:
    root = hub.parent
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
