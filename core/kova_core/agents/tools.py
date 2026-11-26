import json
import shutil
import subprocess
from pathlib import Path
from typing import Any

from ..security.paths import resolve_inside
from ..security.trash import move_to_trash

EXCLUDE_DIRS = {".git", ".hub", "node_modules", "__pycache__", ".venv", "dist", "build"}
MAX_READ = 120_000
MAX_WRITE = 1_000_000
MAX_OUTPUT = 20_000


DANGEROUS = {"write_file", "delete_file", "run_command"}


def needs_approval(name: str) -> bool:
    return name in DANGEROUS


def permitted(name: str, policy: str) -> bool:
    if name in {"list_dir", "read_file"}:
        return True
    if name in {"write_file", "delete_file"}:
        return policy in {"workspace", "auto"}
    if name == "run_command":
        return policy == "auto"
    return False


def _safe(root: Path, value: str) -> Path:
    return resolve_inside(root, value or ".")


def tool_specs(policy: str) -> str:
    lines = [
        "Доступные инструменты:",
        '- list_dir: {"path": "."} — список файлов и папок.',
        '- read_file: {"path": "src/app.ts"} — прочитать текстовый файл.',
    ]
    if policy in {"workspace", "auto"}:
        lines.append(
            '- write_file: {"path": "src/app.ts", "content": "..."} — создать или перезаписать файл.'
        )
        lines.append('- delete_file: {"path": "old.ts"} — удалить файл.')
    if policy == "auto":
        lines.append(
            '- run_command: {"command": "npm test", "timeout": 120} — выполнить команду в папке проекта.'
        )
    return "\n".join(lines)


def run_tool(
    name: str,
    args: dict[str, Any],
    root: Path,
    policy: str,
) -> dict[str, Any]:
    if name == "list_dir":
        target = _safe(root, str(args.get("path") or "."))
        if not target.is_dir():
            return {"ok": False, "error": "папка не найдена"}
        entries = []
        for path in sorted(target.iterdir()):
            rel = path.relative_to(root).as_posix()
            if any(part in EXCLUDE_DIRS for part in Path(rel).parts):
                continue
            entries.append(
                {
                    "path": rel,
                    "type": "dir" if path.is_dir() else "file",
                    "size": path.stat().st_size if path.is_file() else 0,
                }
            )
        return {"ok": True, "path": target.relative_to(root).as_posix() or ".", "entries": entries[:300]}

    if name == "read_file":
        target = _safe(root, str(args.get("path") or ""))
        if not target.is_file():
            return {"ok": False, "error": "файл не найден"}
        data = target.read_bytes()[:MAX_READ]
        if b"\x00" in data:
            return {"ok": False, "error": "бинарный файл"}
        text = data.decode("utf-8", errors="replace")
        return {
            "ok": True,
            "path": target.relative_to(root).as_posix(),
            "content": text,
            "truncated": target.stat().st_size > MAX_READ,
        }

    if name == "write_file":
        if policy not in {"workspace", "auto"}:
            return {"ok": False, "error": "политика запуска запрещает запись файлов"}
        target = _safe(root, str(args.get("path") or ""))
        content = args.get("content")
        if not isinstance(content, str):
            return {"ok": False, "error": "content должен быть строкой"}
        data = content.encode("utf-8")
        if len(data) > MAX_WRITE:
            return {"ok": False, "error": "файл слишком большой"}
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        return {"ok": True, "path": target.relative_to(root).as_posix(), "bytes": len(data)}

    if name == "delete_file":
        if policy not in {"workspace", "auto"}:
            return {"ok": False, "error": "политика запуска запрещает удаление файлов"}
        target = _safe(root, str(args.get("path") or ""))
        if not target.is_file():
            return {"ok": False, "error": "файл не найден"}
        relative = target.relative_to(root).as_posix()
        result = move_to_trash(target)
        if not result.get("ok"):
            return {"ok": False, "error": str(result.get("error") or "не удалось удалить")}
        return {"ok": True, "path": relative, "trash": result.get("method")}

    if name == "run_command":
        if policy != "auto":
            return {"ok": False, "error": "политика запуска запрещает команды"}
        command = str(args.get("command") or "").strip()
        if not command:
            return {"ok": False, "error": "команда пустая"}
        timeout = max(5, min(600, int(args.get("timeout") or 120)))
        result = subprocess.run(
            command,
            cwd=str(root),
            shell=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        )
        output = ((result.stdout or "") + "\n" + (result.stderr or "")).strip()
        clipped = output[:MAX_OUTPUT]
        return {
            "ok": result.returncode == 0,
            "exit_code": result.returncode,
            "output": clipped,
            "truncated": len(output) > MAX_OUTPUT,
        }

    return {"ok": False, "error": f"неизвестный инструмент: {name}"}
