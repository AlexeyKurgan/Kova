from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ...packages import custom, remote, store
from ...packages.catalog import get_catalog_entry
from ...i18n import get_language, tl
from ...domain.ledger import LedgerEvent
from ...storage.ledger import append_event
from ...security.paths import resolve_inside
from ..deps import require_hub

router = APIRouter(prefix="/packages", tags=["packages"])


class PackageToggle(BaseModel):
    enabled: bool


class PackageImportRequest(BaseModel):
    path: str


class RemoteInstallRequest(BaseModel):
    package_id: str
    url: str
    sha256: str
    version: str = ""


@router.get("")
def list_packages(hub: Path = Depends(require_hub)) -> list[dict[str, Any]]:
    return store.list_packages(hub)


@router.post("/import")
def import_package(payload: PackageImportRequest, hub: Path = Depends(require_hub)) -> dict[str, Any]:
    try:
        manifest = custom.import_custom_package(hub, Path(payload.path))
    except custom.PackageImportError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if store.get_package(hub, manifest["id"]) is None:
        target = resolve_inside(hub, Path("packages") / "custom" / manifest["id"])
        import shutil
        shutil.rmtree(target, ignore_errors=True)
        raise HTTPException(status_code=400, detail="пакет не появился в реестре")
    if get_catalog_entry(manifest["id"]) is not None:
        target = resolve_inside(hub, Path("packages") / "custom" / manifest["id"])
        import shutil
        shutil.rmtree(target, ignore_errors=True)
        raise HTTPException(status_code=409, detail="id занят встроенным пакетом")
    append_event(
        hub,
        LedgerEvent(
            type="package.imported",
            subject=manifest["id"],
            actor="human",
            data={"name": manifest["name"], "version": manifest["version"]},
        ),
    )
    return store.get_package(hub, manifest["id"]) or {}


@router.get("/templates")
def list_package_task_templates(hub: Path = Depends(require_hub)) -> list[dict[str, Any]]:
    templates: list[dict[str, Any]] = []
    for row in store.list_packages(hub):
        if not row.get("custom") or not row.get("installed") or not row.get("enabled"):
            continue
        for template in row.get("task_templates") or []:
            templates.append(
                {
                    **template,
                    "label": tl(template.get("label", ""), template.get("label_en", "")),
                    "title": tl(template.get("title", ""), template.get("title_en", "")),
                    "goal": tl(template.get("goal", ""), template.get("goal_en", "")),
                    "criteria": (
                        template.get("criteria_en")
                        if get_language() == "en" and template.get("criteria_en")
                        else template.get("criteria", [])
                    ),
                }
            )
    return templates


@router.get("/marketplace")
def get_marketplace(
    url: str = "",
    hub: Path = Depends(require_hub),
) -> dict[str, Any]:
    try:
        index = remote.fetch_index(url)
    except remote.RemoteError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    installed = {row["id"]: row for row in store.list_packages(hub)}
    for entry in index["packages"]:
        entry["name"] = tl(entry.get("name", ""), entry.get("name_en", ""))
        entry["description"] = tl(
            entry.get("description", ""),
            entry.get("description_en", ""),
        )
        current = installed.get(entry["id"])
        entry["installed"] = bool(current and current.get("installed"))
        entry["status"] = (
            current.get("status")
            if current
            else "available"
        )
        entry["builtin"] = get_catalog_entry(entry["id"]) is not None
        entry["installed_version"] = (
            str(current.get("installed_version") or "") if current else ""
        )
        if entry["builtin"]:
            entry["installed"] = True
        entry["update_available"] = bool(
            entry["installed"]
            and entry["installed_version"]
            and entry["installed_version"] != entry["version"]
        )
    return index


@router.post("/marketplace/install")
def install_from_marketplace(
    payload: RemoteInstallRequest,
    hub: Path = Depends(require_hub),
) -> dict[str, Any]:
    existing = store.get_package(hub, payload.package_id)
    if existing is not None and not existing.get("custom"):
        raise HTTPException(status_code=409, detail="id занят встроенным пакетом")
    was_enabled = (
        not (existing.get("installed") and not existing.get("enabled"))
        if existing is not None
        else True
    )
    remote_version = payload.version.strip()
    if existing is not None and (
        not remote_version
        or existing.get("installed_version") == remote_version
    ):
        try:
            return store.install_package(hub, payload.package_id)
        except (KeyError, RuntimeError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    try:
        manifest = remote.install_remote_package(
            hub,
            payload.package_id,
            payload.url,
            payload.sha256,
        )
    except remote.RemoteError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    target = resolve_inside(hub, Path("packages") / "custom" / manifest["id"])
    if get_catalog_entry(manifest["id"]) is not None:
        import shutil

        shutil.rmtree(target, ignore_errors=True)
        raise HTTPException(status_code=409, detail="id занят встроенным пакетом")
    if store.get_package(hub, manifest["id"]) is None:
        import shutil

        shutil.rmtree(target, ignore_errors=True)
        raise HTTPException(status_code=400, detail="пакет не появился в реестре")
    append_event(
        hub,
        LedgerEvent(
            type="package.imported",
            subject=manifest["id"],
            actor="human",
            data={
                "name": manifest["name"],
                "version": manifest["version"],
                "trust": "remote",
                "sha256": payload.sha256,
            },
        ),
    )
    try:
        result = store.install_package(hub, manifest["id"])
        if not was_enabled:
            result = store.set_package_enabled(hub, manifest["id"], False)
        return result
    except (KeyError, RuntimeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/{package_id}")
def get_package(package_id: str, hub: Path = Depends(require_hub)) -> dict[str, Any]:
    row = store.get_package(hub, package_id)
    if row is None:
        raise HTTPException(status_code=404, detail="package not found")
    return row


@router.post("/{package_id}/install")
def install_package(package_id: str, hub: Path = Depends(require_hub)) -> dict[str, Any]:
    try:
        return store.install_package(hub, package_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="package not found") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{package_id}/uninstall")
def uninstall_package(package_id: str, hub: Path = Depends(require_hub)) -> dict[str, Any]:
    try:
        removed = store.uninstall_package(hub, package_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="package not found") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not removed:
        raise HTTPException(status_code=404, detail="package is not installed")
    return {"ok": True, "id": package_id}


@router.patch("/{package_id}")
def update_package(
    package_id: str,
    payload: PackageToggle,
    hub: Path = Depends(require_hub),
) -> dict[str, Any]:
    try:
        return store.set_package_enabled(hub, package_id, payload.enabled)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="package not found") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
