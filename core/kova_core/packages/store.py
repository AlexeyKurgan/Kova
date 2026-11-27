from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..domain.ledger import LedgerEvent
from ..domain.enums import Engine
from ..storage.ledger import append_event
from .catalog import CATALOG, get_catalog_entry
from .custom import get_custom_package, import_custom_package, list_custom_packages
from ..integrations.engines import detect_engine

STATE_FILE = "installed.json"
CORE_PACKAGE = "kova-core"


def _now() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def _state_path(hub: Path) -> Path:
    return hub / "packages" / STATE_FILE


def _defaults() -> dict[str, Any]:
    return {
        "version": 1,
        "installed": [row["id"] for row in CATALOG if row.get("installed_by_default")],
        "disabled": [],
        "updated_at": _now(),
    }


def _read(hub: Path) -> dict[str, Any]:
    try:
        payload = json.loads(_state_path(hub).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        payload = {}
    if not isinstance(payload, dict):
        payload = {}
    installed = payload.get("installed")
    disabled = payload.get("disabled")
    state = {
        "version": 1,
        "installed": [str(item) for item in installed] if isinstance(installed, list) else [],
        "disabled": [str(item) for item in disabled] if isinstance(disabled, list) else [],
        "updated_at": str(payload.get("updated_at") or _now()),
    }
    if not state["installed"]:
        state = _defaults()
    return state


def _write(hub: Path, state: dict[str, Any]) -> None:
    path = _state_path(hub)
    path.parent.mkdir(parents=True, exist_ok=True)
    state["updated_at"] = _now()
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _row(hub: Path, item: dict[str, Any], state: dict[str, Any]) -> dict[str, Any]:
    installed = item["id"] in state["installed"]
    enabled = installed and item["id"] not in state["disabled"]
    if not item.get("available", True):
        status = "coming_soon"
    elif not installed:
        status = "available"
    elif enabled:
        status = "installed"
    else:
        status = "disabled"
    row = {
        **item,
        "installed": installed,
        "enabled": enabled,
        "status": status,
        "installed_version": item["version"] if installed else "",
        "update_available": False,
    }
    if item.get("type") == "engine" and item.get("engines"):
        try:
            info = detect_engine(Engine(item["engines"][0]), hub.parent)
            row["engine_info"] = info.model_dump(mode="json")
        except (OSError, ValueError):
            row["engine_info"] = None
    return row


def _all_items(hub: Path) -> list[dict[str, Any]]:
    rows = [dict(item) for item in CATALOG]
    rows.extend(list_custom_packages(hub))
    return rows


def list_packages(hub: Path) -> list[dict[str, Any]]:
    state = _read(hub)
    return [_row(hub, dict(item), state) for item in _all_items(hub)]


def get_package(hub: Path, package_id: str) -> dict[str, Any] | None:
    item = get_catalog_entry(package_id) or get_custom_package(hub, package_id)
    if item is None:
        return None
    return _row(hub, item, _read(hub))


def install_package(hub: Path, package_id: str) -> dict[str, Any]:
    item = get_catalog_entry(package_id) or get_custom_package(hub, package_id)
    if item is None:
        raise KeyError(package_id)
    if not item.get("available", True):
        raise RuntimeError("пакет ещё не готов к установке")
    state = _read(hub)
    if package_id not in state["installed"]:
        state["installed"].append(package_id)
    state["disabled"] = [value for value in state["disabled"] if value != package_id]
    _write(hub, state)
    append_event(
        hub,
        LedgerEvent(
            type="package.installed",
            subject=package_id,
            actor="Kova",
            data={"name": item["name"], "version": item["version"]},
        ),
    )
    return _row(hub, item, state)


def uninstall_package(hub: Path, package_id: str) -> bool:
    item = get_catalog_entry(package_id) or get_custom_package(hub, package_id)
    if item is None:
        return False
    if package_id == CORE_PACKAGE:
        raise RuntimeError("Kova Core нельзя удалить")
    state = _read(hub)
    if package_id not in state["installed"]:
        return False
    state["installed"] = [value for value in state["installed"] if value != package_id]
    state["disabled"] = [value for value in state["disabled"] if value != package_id]
    _write(hub, state)
    append_event(
        hub,
        LedgerEvent(
            type="package.uninstalled",
            subject=package_id,
            actor="Kova",
            data={"name": item["name"]},
        ),
    )
    return True


def set_package_enabled(hub: Path, package_id: str, enabled: bool) -> dict[str, Any]:
    item = get_catalog_entry(package_id) or get_custom_package(hub, package_id)
    if item is None:
        raise KeyError(package_id)
    state = _read(hub)
    if package_id not in state["installed"]:
        raise RuntimeError("пакет не установлен")
    if enabled:
        state["disabled"] = [value for value in state["disabled"] if value != package_id]
    elif package_id not in state["disabled"]:
        state["disabled"].append(package_id)
    _write(hub, state)
    append_event(
        hub,
        LedgerEvent(
            type="package.enabled" if enabled else "package.disabled",
            subject=package_id,
            actor="Kova",
            data={"name": item["name"]},
        ),
    )
    return _row(hub, item, state)
