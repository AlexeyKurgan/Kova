import json
import threading
from pathlib import Path
from typing import Any

from ..config import app_data_dir
from ..domain.ids import new_id

CONFIG_FILE = "routing.json"
LOCK = threading.Lock()


def _path() -> Path:
    return app_data_dir() / CONFIG_FILE


def load() -> dict[str, list[dict[str, Any]]]:
    try:
        payload = json.loads(_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        payload = {}
    if not isinstance(payload, dict):
        payload = {}
    rules = payload.get("rules")
    roles = payload.get("roles")
    return {
        "rules": [row for row in rules if isinstance(row, dict)] if isinstance(rules, list) else [],
        "roles": [row for row in roles if isinstance(row, dict)] if isinstance(roles, list) else [],
    }


def save(rules: list[dict[str, Any]], roles: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    with LOCK:
        path = _path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps({"version": 1, "rules": rules, "roles": roles}, ensure_ascii=False, indent=2)
            + "\n",
            encoding="utf-8",
        )
    return {"rules": rules, "roles": roles}


def normalize_rules(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in rows:
        tag = str(row.get("tag") or "").strip().lower()
        provider_id = str(row.get("provider_id") or "").strip()
        if not tag or not provider_id or tag in seen:
            continue
        seen.add(tag)
        result.append(
            {
                "id": str(row.get("id") or new_id("rule")),
                "tag": tag[:60],
                "provider_id": provider_id,
            }
        )
    return result[:100]


def normalize_roles(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in rows:
        name = str(row.get("name") or "").strip()
        if not name or name.lower() in seen:
            continue
        seen.add(name.lower())
        result.append(
            {
                "id": str(row.get("id") or new_id("role")),
                "name": name[:80],
                "prompt": str(row.get("prompt") or "").strip()[:4000],
                "provider_id": str(row.get("provider_id") or "").strip(),
            }
        )
    return result[:50]


def get_role(role_id: str) -> dict[str, Any] | None:
    if not role_id:
        return None
    for row in load()["roles"]:
        if str(row.get("id")) == role_id:
            return row
    return None


def recommend(task, providers: list[dict[str, Any]]) -> dict[str, Any]:
    available = {
        str(provider.get("id")): provider
        for provider in providers
        if provider.get("installed") and provider.get("enabled", True)
    }
    tags = {str(tag).strip().lower() for tag in (task.tags or []) if str(tag).strip()}
    for rule in load()["rules"]:
        tag = str(rule.get("tag") or "").lower()
        provider_id = str(rule.get("provider_id") or "")
        if tag in tags and provider_id in available:
            return {
                "provider_id": provider_id,
                "provider_name": str(available[provider_id].get("name") or provider_id),
                "reason": f"правило по тегу «{tag}»",
            }
    return {"provider_id": "", "provider_name": "", "reason": "правил нет"}
