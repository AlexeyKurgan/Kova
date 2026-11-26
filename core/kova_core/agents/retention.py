import json
import shutil
from pathlib import Path
from typing import Any

from ..config import app_data_dir


def _read(path: Path) -> dict[str, Any] | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return payload if isinstance(payload, dict) else None


def cleanup(hub: Path, keep: int = 50) -> dict[str, int]:
    keep = max(1, min(500, int(keep)))
    counters = {
        "runs_removed": 0,
        "sessions_removed": 0,
        "logs_removed": 0,
        "diffs_removed": 0,
        "worktrees_removed": 0,
    }
    worktrees_base = (app_data_dir() / "worktrees").resolve()
    sandboxes_base = (app_data_dir() / "sandboxes").resolve()

    runs_dir = hub / "agents" / "runs"
    if runs_dir.is_dir():
        rows = []
        for path in runs_dir.glob("run_*.json"):
            payload = _read(path)
            if payload is None:
                continue
            rows.append((str(payload.get("started_at") or payload.get("created_at") or ""), path, payload))
        rows.sort(key=lambda item: item[0], reverse=True)
        for _, path, payload in rows[keep:]:
            run_id = str(payload.get("id") or path.stem)
            path.unlink(missing_ok=True)
            counters["runs_removed"] += 1
            log_path = str(payload.get("log_path") or "")
            if log_path:
                target = (hub / log_path).resolve()
                try:
                    target.relative_to(hub.resolve())
                except ValueError:
                    target = None
                if target and target.is_file():
                    target.unlink(missing_ok=True)
                    counters["logs_removed"] += 1
            diff_dir = hub / "agents" / "diffs" / run_id
            if diff_dir.is_dir():
                shutil.rmtree(diff_dir, ignore_errors=True)
                counters["diffs_removed"] += 1
            worktree_path = str(payload.get("worktree_path") or "")
            if worktree_path:
                target = Path(worktree_path).resolve()
                if (worktrees_base in target.parents or sandboxes_base in target.parents) and target.is_dir():
                    shutil.rmtree(target, ignore_errors=True)
                    counters["worktrees_removed"] += 1

    sessions_dir = hub / "agents" / "sessions"
    if sessions_dir.is_dir():
        rows = []
        for path in sessions_dir.glob("ses_*.json"):
            payload = _read(path)
            if payload is None:
                continue
            rows.append((str(payload.get("created_at") or ""), path))
        rows.sort(key=lambda item: item[0], reverse=True)
        for _, path in rows[keep:]:
            path.unlink(missing_ok=True)
            counters["sessions_removed"] += 1

    return counters
