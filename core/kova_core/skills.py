import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import app_data_dir
from .domain.ids import new_id
from .integrations.blender import skills as blender_skills

CONFIG_FILE = "skills.json"
LOCK = threading.Lock()
MAX_CONTENT = 200_000
MAX_TOTAL_PROMPT = 48_000

CATEGORIES = {
    "blender": "Blender",
    "code": "Код",
    "roblox": "Roblox",
    "unity": "Unity",
    "godot": "Godot",
    "unreal": "Unreal",
    "general": "Общее",
}


def _now() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def _path() -> Path:
    return app_data_dir() / CONFIG_FILE


def _read() -> dict[str, Any]:
    try:
        payload = json.loads(_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        payload = {}
    if not isinstance(payload, dict):
        payload = {}
    user = payload.get("user")
    overrides = payload.get("overrides")
    return {
        "version": 1,
        "user": [row for row in user if isinstance(row, dict)] if isinstance(user, list) else [],
        "overrides": overrides if isinstance(overrides, dict) else {},
    }


def _write(payload: dict[str, Any]) -> None:
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _builtin_rows() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for row in blender_skills.list_skills():
        path = str(row.get("path") or "")
        rows.append(
            {
                "id": path,
                "name": str(row.get("name") or path),
                "description": str(row.get("description") or ""),
                "category": "blender",
                "category_label": CATEGORIES["blender"],
                "group": str(row.get("group") or "other"),
                "group_label": str(row.get("group_label") or "Дополнительно"),
                "path": path,
                "source": "builtin",
                "locked": False,
                "files": list(row.get("files") or []),
                "scripts": list(row.get("scripts") or []),
            }
        )
    return rows


def _user_entry(item: dict[str, Any]) -> dict[str, Any]:
    category = str(item.get("category") or "general")
    return {
        "id": str(item.get("id") or ""),
        "name": str(item.get("name") or ""),
        "description": str(item.get("description") or ""),
        "category": category,
        "category_label": CATEGORIES.get(category, CATEGORIES["general"]),
        "group": category,
        "group_label": CATEGORIES.get(category, CATEGORIES["general"]),
        "path": "",
        "source": "user",
        "locked": bool(item.get("locked", False)),
        "files": [],
        "scripts": [],
        "updated_at": str(item.get("updated_at") or ""),
    }


def list_skills() -> list[dict[str, Any]]:
    store = _read()
    overrides = store["overrides"]
    rows: list[dict[str, Any]] = []
    for base in _builtin_rows():
        override = overrides.get(base["path"])
        if isinstance(override, dict):
            if override.get("hidden"):
                continue
            base["description"] = str(override.get("description", base["description"]))
            base["locked"] = bool(override.get("locked", False))
        rows.append(base)
    for item in store["user"]:
        rows.append(_user_entry(item))
    rows.sort(key=lambda row: (row["category"] != "blender", row["category"], row["name"]))
    return rows


def _find_row(skill_id: str) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    store = _read()
    for item in store["user"]:
        if str(item.get("id")) == skill_id or str(item.get("name")) == skill_id:
            return {**_user_entry(item), "content": str(item.get("content") or "")}, None
    for row in _builtin_rows():
        if row["id"] == skill_id or row["name"] == skill_id:
            override = store["overrides"].get(row["id"])
            return row, override if isinstance(override, dict) else None
    return None, None


def get_skill(skill_id: str) -> dict[str, Any] | None:
    row, override = _find_row(skill_id)
    if row is None:
        return None
    if row.get("source") == "user":
        return {
            **_user_entry(row),
            "content": str(row.get("content") or ""),
        }
    content_path = blender_skills.SKILLS_DIR / str(row["path"]) / "SKILL.md"
    try:
        content = content_path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        content = ""
    if override and isinstance(override.get("content"), str):
        content = override["content"]
    return {
        **row,
        "description": str(override.get("description", row["description"])) if override else row["description"],
        "locked": bool(override.get("locked", False)) if override else bool(row["locked"]),
        "content": content,
    }


def _validate_name(name: str, skill_id: str = "") -> str:
    value = name.strip()
    if not value:
        raise RuntimeError("название скилла не может быть пустым")
    if len(value) > 80:
        raise RuntimeError("название слишком длинное")
    for row in list_skills():
        if row["name"].lower() == value.lower() and row["id"] != skill_id:
            raise RuntimeError("скилл с таким названием уже есть")
    return value


def create_skill(payload: dict[str, Any]) -> dict[str, Any]:
    name = _validate_name(str(payload.get("name") or ""))
    category = str(payload.get("category") or "general")
    if category not in CATEGORIES:
        raise RuntimeError("неизвестная категория")
    content = str(payload.get("content") or "")
    if len(content) > MAX_CONTENT:
        raise RuntimeError("скилл слишком большой")
    with LOCK:
        store = _read()
        item = {
            "id": new_id("skill"),
            "name": name,
            "description": str(payload.get("description") or "")[:500],
            "category": category,
            "content": content,
            "locked": bool(payload.get("locked", False)),
            "created_at": _now(),
            "updated_at": _now(),
        }
        store["user"].append(item)
        _write(store)
    return get_skill(str(item["id"])) or item


def update_skill(skill_id: str, payload: dict[str, Any], unlock: bool = False) -> dict[str, Any] | None:
    row, override = _find_row(skill_id)
    if row is None:
        return None
    locked = bool(override.get("locked", False)) if override else bool(row.get("locked", False))
    wants_content = any(key in payload for key in ("content", "name", "description", "category"))
    wants_lock = "locked" in payload
    if locked and wants_content and not (unlock or (wants_lock and not wants_content and not payload.get("locked"))):
        raise RuntimeError("скилл защищён от изменений. Сначала сними защиту.")
    with LOCK:
        store = _read()
        if row.get("source") == "user":
            for item in store["user"]:
                if str(item.get("id")) != skill_id:
                    continue
                if "name" in payload:
                    item["name"] = _validate_name(str(payload["name"]), skill_id)
                if "description" in payload:
                    item["description"] = str(payload["description"])[:500]
                if "category" in payload:
                    category = str(payload["category"])
                    if category not in CATEGORIES:
                        raise RuntimeError("неизвестная категория")
                    item["category"] = category
                if "content" in payload:
                    content = str(payload["content"])
                    if len(content) > MAX_CONTENT:
                        raise RuntimeError("скилл слишком большой")
                    item["content"] = content
                if "locked" in payload:
                    item["locked"] = bool(payload["locked"])
                item["updated_at"] = _now()
                break
        else:
            override = dict(store["overrides"].get(str(row["id"])) or {})
            for key in ("description", "content", "locked"):
                if key in payload:
                    override[key] = payload[key]
            override["hidden"] = False
            store["overrides"][str(row["id"])] = override
        _write(store)
    return get_skill(skill_id)


def delete_skill(skill_id: str, unlock: bool = False) -> bool:
    row, override = _find_row(skill_id)
    if row is None:
        return False
    locked = bool(override.get("locked", False)) if override else bool(row.get("locked", False))
    if locked and not unlock:
        raise RuntimeError("скилл защищён от удаления. Сначала сними защиту.")
    with LOCK:
        store = _read()
        if row.get("source") == "user":
            store["user"] = [item for item in store["user"] if str(item.get("id")) != skill_id]
        else:
            current = dict(store["overrides"].get(str(row["id"])) or {})
            current["hidden"] = True
            store["overrides"][str(row["id"])] = current
        _write(store)
    return True


def skill_prompt(names: list[str]) -> str:
    if not names:
        return ""
    wanted = {str(name).strip().lower() for name in names if str(name).strip()}
    parts: list[str] = ["## Скиллы задачи\n"]
    used = 0
    for skill_id in names:
        skill = get_skill(str(skill_id))
        if skill is None or str(skill.get("name", "")).lower() not in wanted:
            continue
        content = str(skill.get("content") or "").strip()
        if not content:
            continue
        block = (
            f"### {skill.get('name')}\n"
            f"{skill.get('description') or ''}\n\n"
            f"{content}\n"
        )
        if used + len(block) > MAX_TOTAL_PROMPT:
            break
        parts.append(block)
        used += len(block)
    if len(parts) == 1:
        return ""
    parts.append(
        "\nКаталог всех скиллов доступен через GET http://127.0.0.1:8765/skills. "
        "Используй только скиллы, релевантные задаче; не меняй скиллы, если они защищены.\n"
    )
    return "\n".join(parts)
