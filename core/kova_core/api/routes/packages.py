from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ...packages import store
from ..deps import require_hub

router = APIRouter(prefix="/packages", tags=["packages"])


class PackageToggle(BaseModel):
    enabled: bool


@router.get("")
def list_packages(hub: Path = Depends(require_hub)) -> list[dict[str, Any]]:
    return store.list_packages(hub)


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
