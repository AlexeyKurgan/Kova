from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ...packages import custom, store
from ...domain.ledger import LedgerEvent
from ...storage.ledger import append_event
from ...security.paths import resolve_inside
from ..deps import require_hub

router = APIRouter(prefix="/packages", tags=["packages"])


class PackageToggle(BaseModel):
    enabled: bool


class PackageImportRequest(BaseModel):
    path: str


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
    from ...packages.catalog import get_catalog_entry
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
