import hashlib
import shutil
import subprocess
from pathlib import Path
from typing import Any

from ..config import app_data_dir
from ..security.paths import resolve_inside

EXCLUDE_FROM_APPLY = {".git", ".hub", "node_modules", "__pycache__", ".venv"}


def is_git_repo(root: Path) -> bool:
    return (root / ".git").exists()


def _git(root: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=str(root),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=60,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )


def worktrees_root(root: Path) -> Path:
    digest = hashlib.sha256(str(root.resolve()).lower().encode("utf-8")).hexdigest()[:10]
    slug = "".join(ch if ch.isalnum() or ch in "-_" else "-" for ch in root.name).strip("-")
    return app_data_dir() / "worktrees" / f"{slug or 'project'}-{digest}"


def sandboxes_root(root: Path) -> Path:
    digest = hashlib.sha256(str(root.resolve()).lower().encode("utf-8")).hexdigest()[:10]
    slug = "".join(ch if ch.isalnum() or ch in "-_" else "-" for ch in root.name).strip("-")
    return app_data_dir() / "sandboxes" / f"{slug or 'project'}-{digest}"


def create_sandbox(root: Path, run_id: str) -> Path:
    target = sandboxes_root(root) / run_id
    if target.exists():
        shutil.rmtree(target, ignore_errors=True)
    target.parent.mkdir(parents=True, exist_ok=True)
    ignore = shutil.ignore_patterns(
        ".git",
        ".hub",
        "node_modules",
        "__pycache__",
        ".venv",
        "dist",
        "build",
        ".pytest_cache",
    )
    shutil.copytree(root, target, ignore=ignore)
    return target


def remove_sandbox(root: Path, sandbox: Path) -> None:
    sandbox_base = sandboxes_root(root).resolve()
    target = sandbox.resolve()
    if target != sandbox_base and sandbox_base in target.parents and target.is_dir():
        shutil.rmtree(target, ignore_errors=True)


def create_worktree(root: Path, run_id: str) -> Path:
    if not is_git_repo(root):
        raise RuntimeError("проект не является git-репозиторием")
    target = worktrees_root(root) / run_id
    if target.exists():
        shutil.rmtree(target, ignore_errors=True)
    target.parent.mkdir(parents=True, exist_ok=True)
    head = _git(root, "rev-parse", "--verify", "HEAD")
    if head.returncode != 0:
        raise RuntimeError("в репозитории нет коммитов — worktree создать нельзя")
    result = _git(root, "worktree", "add", "--detach", str(target), "HEAD")
    if result.returncode != 0:
        message = (result.stderr or result.stdout or "git worktree add failed").strip()
        raise RuntimeError(message.splitlines()[-1][:300])
    return target


def remove_worktree(root: Path, worktree: Path) -> None:
    if not worktree.exists():
        return
    result = _git(root, "worktree", "remove", "--force", str(worktree))
    if result.returncode != 0 or worktree.exists():
        shutil.rmtree(worktree, ignore_errors=True)
    _git(root, "worktree", "prune")


def _conflicts(root: Path, paths: list[str]) -> list[str]:
    if not paths or not is_git_repo(root):
        return []
    result = _git(root, "status", "--porcelain", "--", *paths)
    if result.returncode != 0:
        return []
    requested = {path.replace("\\", "/") for path in paths}
    conflicts: set[str] = set()
    for line in result.stdout.splitlines():
        raw = line[3:].strip()
        if " -> " in raw:
            raw = raw.split(" -> ", 1)[1]
        raw = raw.strip('"').replace("\\", "/")
        if raw in requested:
            conflicts.add(raw)
    return sorted(conflicts)


def apply_changes(
    root: Path,
    worktree: Path,
    changes: list[dict[str, object]],
) -> dict[str, Any]:
    counters: dict[str, Any] = {"applied": 0, "deleted": 0, "skipped": 0, "conflicts": []}
    requested = [
        str(item.get("path") or "")
        for item in changes
        if item.get("path")
        and not (set(Path(str(item.get("path"))).parts) & EXCLUDE_FROM_APPLY)
    ]
    conflicts = _conflicts(root, requested)
    if conflicts:
        counters["conflicts"] = conflicts
        return counters
    for item in changes:
        rel = str(item.get("path") or "")
        if not rel:
            counters["skipped"] += 1
            continue
        parts = set(Path(rel).parts)
        if parts & EXCLUDE_FROM_APPLY:
            counters["skipped"] += 1
            continue
        try:
            source = resolve_inside(worktree, rel)
            target = resolve_inside(root, rel)
        except ValueError:
            counters["skipped"] += 1
            continue
        if item.get("status") == "deleted":
            target.unlink(missing_ok=True)
            counters["deleted"] += 1
            continue
        if not source.is_file():
            counters["skipped"] += 1
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        counters["applied"] += 1
    return counters
