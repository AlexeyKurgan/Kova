import ctypes
import json
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any

from ..config import local_data_dir


def _windows_recycle(path: Path) -> bool:
    if not hasattr(ctypes, "windll"):
        return False

    class SHFILEOPSTRUCTW(ctypes.Structure):
        _fields_ = [
            ("hwnd", ctypes.c_void_p),
            ("wFunc", ctypes.c_uint),
            ("pFrom", ctypes.c_wchar_p),
            ("pTo", ctypes.c_wchar_p),
            ("fFlags", ctypes.c_ushort),
            ("fAnyOperationsAborted", ctypes.c_int),
            ("hNameMappings", ctypes.c_void_p),
            ("lpszProgressTitle", ctypes.c_wchar_p),
        ]

    FO_DELETE = 3
    FOF_SILENT = 0x0004
    FOF_NOCONFIRMATION = 0x0010
    FOF_ALLOWUNDO = 0x0040
    FOF_NOERRORUI = 0x0400
    FOF_WANTNUKEWARNING = 0x4000

    operation = SHFILEOPSTRUCTW()
    operation.hwnd = None
    operation.wFunc = FO_DELETE
    operation.pFrom = str(path) + "\0"
    operation.pTo = None
    operation.fFlags = (
        FOF_SILENT
        | FOF_NOCONFIRMATION
        | FOF_ALLOWUNDO
        | FOF_NOERRORUI
        | FOF_WANTNUKEWARNING
    )
    try:
        result = ctypes.windll.shell32.SHFileOperationW(ctypes.byref(operation))
    except (AttributeError, OSError):
        return False
    return result == 0 and not operation.fAnyOperationsAborted


def _fallback_trash(path: Path) -> Path:
    root = local_data_dir() / "trash"
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    target = root / f"{stamp}-{path.name}"
    counter = 1
    while target.exists():
        counter += 1
        target = root / f"{stamp}-{path.name}-{counter}"
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(path), str(target))
    return target


def move_to_trash(path: Path) -> dict[str, Any]:
    """Move a file or directory to the OS recycle bin, with a local fallback.

    Returns {"ok": True, "path": ...} on success. The fallback keeps data under
    %LOCALAPPDATA%/KovaHub/trash instead of deleting it permanently.
    """
    target = path.resolve()
    if not target.exists():
        return {"ok": False, "error": "path not found"}
    if target.parent == target:
        return {"ok": False, "error": "refusing to trash a filesystem root"}
    if _windows_recycle(target):
        return {"ok": True, "path": str(target), "method": "recycle-bin"}
    try:
        moved = _fallback_trash(target)
    except OSError as exc:
        return {"ok": False, "error": str(exc)}
    return {"ok": True, "path": str(moved), "method": "kova-trash"}


def _project_trash_root() -> Path:
    return local_data_dir() / "trash" / "projects"


def _project_trash_id() -> str:
    import uuid

    return "trash_" + uuid.uuid4().hex[:12]


def _safe_name(value: str) -> str:
    cleaned = "".join("_" if ch in '<>:"/\|?*' else ch for ch in value).strip()
    return (cleaned or "project")[:80]


def move_project_to_trash(path: Path, name: str, engine: str = "") -> dict[str, Any]:
    root = path.resolve()
    if not root.is_dir():
        raise FileNotFoundError(f"project folder not found: {path}")
    trash_root = _project_trash_root()
    trash_root.mkdir(parents=True, exist_ok=True)
    trash_id = _project_trash_id()
    target = trash_root / f"{trash_id}-{_safe_name(name)}"
    shutil.move(str(root), str(target))
    meta = {
        "id": trash_id,
        "name": name,
        "engine": engine,
        "original_path": str(root),
        "deleted_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "path": str(target),
    }
    (target / ".kova-trash.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return meta


def _trash_entry(trash_id: str) -> tuple[Path, dict[str, Any]] | None:
    if Path(trash_id).name != trash_id:
        return None
    root = _project_trash_root()
    matches = list(root.glob(f"{trash_id}-*")) if root.is_dir() else []
    if not matches:
        return None
    target = matches[0]
    meta_file = target / ".kova-trash.json"
    try:
        meta = json.loads(meta_file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return target, meta


def list_project_trash() -> list[dict[str, Any]]:
    root = _project_trash_root()
    if not root.is_dir():
        return []
    rows: list[dict[str, Any]] = []
    for target in root.iterdir():
        if not target.is_dir():
            continue
        try:
            meta = json.loads((target / ".kova-trash.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if not meta.get("id"):
            continue
        meta["path"] = str(target)
        rows.append(meta)
    rows.sort(key=lambda item: str(item.get("deleted_at") or ""), reverse=True)
    return rows


def restore_project_trash(trash_id: str) -> dict[str, Any]:
    entry = _trash_entry(trash_id)
    if entry is None:
        return {"ok": False, "error": "trash entry not found"}
    target, meta = entry
    original = Path(str(meta.get("original_path") or "")).resolve()
    if not str(meta.get("original_path") or "").strip():
        return {"ok": False, "error": "original path is missing"}
    if original.exists():
        return {"ok": False, "error": f"папка уже существует: {original}"}
    original.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(target), str(original))
    meta_file = original / ".kova-trash.json"
    meta_file.unlink(missing_ok=True)
    meta["path"] = str(original)
    meta["ok"] = True
    return meta


def purge_project_trash(trash_id: str) -> bool:
    entry = _trash_entry(trash_id)
    if entry is None:
        return False
    target, _meta = entry
    shutil.rmtree(target, ignore_errors=True)
    return True


def cleanup_project_trash(days: int = 30) -> dict[str, int]:
    days = max(1, min(3650, int(days)))
    cutoff = datetime.now().astimezone().timestamp() - days * 86400
    removed = 0
    for item in list_project_trash():
        deleted_at = str(item.get("deleted_at") or "")
        try:
            stamp = datetime.fromisoformat(deleted_at).timestamp()
        except (ValueError, TypeError):
            continue
        if stamp >= cutoff:
            continue
        trash_id = str(item.get("id") or "")
        if trash_id and purge_project_trash(trash_id):
            removed += 1
    return {"removed": removed}
