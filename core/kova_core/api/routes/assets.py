from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from ...checks.assets import get_asset_checks, run_asset_checks, save_asset_checks
from ...checks.blender import blender_checks
from ...checks.contracts import contract_checks, contract_for
from ...checks.style import style_checks
from ...domain.asset import AssetDependency, AssetPassport, ExportProfile
from ...domain.check import CheckResult
from ...domain.contract import ContractReport
from ...domain.enums import AssetType, Engine
from ...domain.ledger import LedgerEvent
from ...integrations.blender.bridge import inspect_asset
from ...integrations.blender.viewer import viewer_glb
from ...security.paths import resolve_inside
from ...storage.assets import (
    activate_asset_version,
    add_asset_version,
    delete_asset,
    duplicate_asset,
    get_asset,
    import_asset,
    list_assets,
    save_asset,
    set_asset_tasks,
    sync_current_version,
)
from ...storage.ledger import append_event
from ...storage.style import load_style
from ...storage.tasks import get_task
from ..deps import require_hub

router = APIRouter(prefix="/assets", tags=["assets"])


class ImportAssetRequest(BaseModel):
    path: str
    name: str | None = None
    type: AssetType | None = None
    engine: Engine | None = None
    license: str = ""
    task_id: str | None = None


class ExportProfileInput(BaseModel):
    engine: Engine
    format: str
    options: dict[str, str] = {}


class AssetDependencyInput(BaseModel):
    kind: str = "asset"
    target_id: str
    label: str = ""


class UpdateAssetRequest(BaseModel):
    task_id: str | None = None
    task_ids: list[str] | None = None
    description: str | None = None
    license: str | None = None
    export_profiles: list[ExportProfileInput] | None = None
    dependencies: list[AssetDependencyInput] | None = None


class AddVersionRequest(BaseModel):
    path: str
    reason: str = ""
    make_current: bool = True


class BlenderInspectResponse(BaseModel):
    asset: AssetPassport
    checks: list[CheckResult]


@router.get("", response_model=list[AssetPassport])
def get_assets(hub: Path = Depends(require_hub)) -> list[AssetPassport]:
    return list_assets(hub)


@router.post("/import", response_model=AssetPassport, status_code=201)
def import_asset_route(
    payload: ImportAssetRequest,
    hub: Path = Depends(require_hub),
) -> AssetPassport:
    if payload.task_id and get_task(hub, payload.task_id) is None:
        raise HTTPException(status_code=404, detail="task not found")

    try:
        asset = import_asset(
            hub,
            Path(payload.path),
            name=payload.name,
            asset_type=payload.type,
            engine=payload.engine,
            license=payload.license,
            task_id=payload.task_id,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    append_event(
        hub,
        LedgerEvent(
            type="asset.imported",
            subject=asset.id,
            data={"name": asset.name, "path": asset.path},
        ),
    )
    return asset


@router.get("/{asset_id}", response_model=AssetPassport)
def get_asset_route(asset_id: str, hub: Path = Depends(require_hub)) -> AssetPassport:
    asset = get_asset(hub, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="asset not found")
    return asset


@router.patch("/{asset_id}", response_model=AssetPassport)
def update_asset_route(
    asset_id: str,
    payload: UpdateAssetRequest,
    hub: Path = Depends(require_hub),
) -> AssetPassport:
    asset = get_asset(hub, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="asset not found")

    updates = payload.model_dump(exclude_unset=True)
    if "task_ids" in updates:
        task_ids = updates.pop("task_ids") or []
        for task_id in task_ids:
            if get_task(hub, task_id) is None:
                raise HTTPException(status_code=404, detail=f"task not found: {task_id}")
        asset = set_asset_tasks(hub, asset, task_ids)
    elif "task_id" in updates:
        task_id = updates.pop("task_id")
        if task_id is not None and get_task(hub, task_id) is None:
            raise HTTPException(status_code=404, detail="task not found")
        asset = set_asset_tasks(hub, asset, [task_id] if task_id else [])

    if "description" in updates:
        asset.description = str(updates["description"] or "")
    if "license" in updates:
        asset.license = str(updates["license"] or "")
    if "export_profiles" in updates:
        asset.export_profiles = [
            ExportProfile(
                engine=item["engine"],
                format=str(item["format"]),
                options={str(key): str(value) for key, value in (item.get("options") or {}).items()},
            )
            for item in (updates["export_profiles"] or [])
        ]
    if "dependencies" in updates:
        dependencies = []
        for item in updates["dependencies"] or []:
            target = str(item.get("target_id") or "").strip()
            if not target:
                continue
            if target == asset.id:
                raise HTTPException(status_code=422, detail="asset cannot depend on itself")
            dependencies.append(
                AssetDependency(
                    kind=str(item.get("kind") or "asset"),
                    target_id=target,
                    label=str(item.get("label") or ""),
                )
            )
        asset.dependencies = dependencies

    saved = save_asset(hub, asset)
    append_event(
        hub,
        LedgerEvent(
            type="asset.linked" if saved.task_ids else "asset.unlinked",
            subject=saved.id,
            data={"task_id": saved.task_id, "task_ids": saved.task_ids},
        ),
    )
    return saved


@router.get("/{asset_id}/contract", response_model=ContractReport)
def get_contract_route(
    asset_id: str,
    hub: Path = Depends(require_hub),
) -> ContractReport:
    asset = get_asset(hub, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="asset not found")
    return ContractReport(
        contract=contract_for(asset.engine),
        checks=contract_checks(asset),
    )


@router.get("/{asset_id}/checks", response_model=list[CheckResult])
def get_checks_route(
    asset_id: str,
    version_id: str | None = None,
    hub: Path = Depends(require_hub),
) -> list[CheckResult]:
    if get_asset(hub, asset_id) is None:
        raise HTTPException(status_code=404, detail="asset not found")
    return get_asset_checks(hub, asset_id, version_id)


def _pick_version(asset: AssetPassport, version_id: str | None):
    if not version_id:
        return None
    version = next((item for item in asset.versions if item.id == version_id), None)
    if version is None:
        raise HTTPException(status_code=404, detail="version not found")
    return version


@router.get("/{asset_id}/preview")
def get_asset_preview(
    asset_id: str,
    version_id: str | None = None,
    frame: int | None = None,
    hub: Path = Depends(require_hub),
) -> FileResponse:
    asset = get_asset(hub, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="asset not found")
    version = _pick_version(asset, version_id)
    if frame is not None:
        frames = version.preview_frames if version else asset.preview_frames
        match = next((item for item in frames if item.frame == frame), None)
        if match is None:
            raise HTTPException(status_code=404, detail="preview frame not found")
        try:
            path = resolve_inside(hub, match.path)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail="preview frame not found") from exc
        if not path.is_file():
            raise HTTPException(status_code=404, detail="preview frame not found")
        return FileResponse(
            path,
            media_type="image/png",
            headers={"Cache-Control": "no-store"},
        )
    preview = version.preview if version else asset.preview
    if not preview:
        raise HTTPException(status_code=404, detail="preview not found")
    try:
        path = resolve_inside(hub, preview)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="preview not found") from exc
    if not path.is_file():
        raise HTTPException(status_code=404, detail="preview not found")
    return FileResponse(
        path,
        media_type="image/png",
        headers={"Cache-Control": "no-store"},
    )


@router.get("/{asset_id}/media")
def get_asset_media(
    asset_id: str,
    version_id: str | None = None,
    hub: Path = Depends(require_hub),
) -> FileResponse:
    asset = get_asset(hub, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="asset not found")
    version = _pick_version(asset, version_id)
    relative = (version.path if version and version.path else "") or asset.path
    if not relative:
        raise HTTPException(status_code=404, detail="file not found")
    try:
        path = resolve_inside(hub.parent, relative)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="file not found") from exc
    if not path.is_file():
        raise HTTPException(status_code=404, detail="file not found")
    media = {
        ".mp4": "video/mp4",
        ".webm": "video/webm",
        ".mov": "video/quicktime",
        ".mkv": "video/x-matroska",
        ".avi": "video/x-msvideo",
        ".wav": "audio/wav",
        ".mp3": "audio/mpeg",
        ".ogg": "audio/ogg",
        ".flac": "audio/flac",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
    }.get(path.suffix.lower(), "application/octet-stream")
    return FileResponse(path, media_type=media, headers={"Cache-Control": "no-store"})


@router.get("/{asset_id}/file")
def get_asset_file(asset_id: str, hub: Path = Depends(require_hub)) -> FileResponse:
    asset = get_asset(hub, asset_id)
    if asset is None or not asset.path:
        raise HTTPException(status_code=404, detail="file not found")
    try:
        path = resolve_inside(hub.parent, asset.path)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="file not found") from exc
    if not path.is_file():
        raise HTTPException(status_code=404, detail="file not found")
    media = {
        ".glb": "model/gltf-binary",
        ".gltf": "model/gltf+json",
        ".bin": "application/octet-stream",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
    }.get(path.suffix.lower(), "application/octet-stream")
    return FileResponse(path, media_type=media, headers={"Cache-Control": "no-store"})


@router.get("/{asset_id}/viewer")
def get_asset_viewer(
    asset_id: str,
    version_id: str | None = None,
    hub: Path = Depends(require_hub),
) -> FileResponse:
    asset = get_asset(hub, asset_id)
    if asset is None or not asset.path:
        raise HTTPException(status_code=404, detail="asset not found")
    version = _pick_version(asset, version_id)
    asset_path = version.path if version and version.path else asset.path
    suffix = Path(asset_path).suffix.lower()
    if suffix not in {".glb", ".gltf", ".blend", ".fbx", ".obj"}:
        raise HTTPException(status_code=415, detail="3D-просмотр недоступен для этого формата")
    try:
        if suffix == ".glb":
            path = resolve_inside(hub.parent, asset_path)
        else:
            path = viewer_glb(hub, asset, version)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not path.is_file():
        raise HTTPException(status_code=404, detail="3D-файл не найден")
    return FileResponse(
        path,
        media_type="model/gltf-binary",
        headers={"Cache-Control": "no-store"},
    )


@router.post("/{asset_id}/versions", response_model=AssetPassport, status_code=201)
def add_version_route(
    asset_id: str,
    payload: AddVersionRequest,
    hub: Path = Depends(require_hub),
) -> AssetPassport:
    asset = get_asset(hub, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="asset not found")
    try:
        add_asset_version(
            hub,
            asset,
            Path(payload.path),
            reason=payload.reason,
            make_current=payload.make_current,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    append_event(
        hub,
        LedgerEvent(
            type="asset.version",
            subject=asset.id,
            data={"label": asset.versions[-1].label, "make_current": payload.make_current},
        ),
    )
    return asset


@router.post("/{asset_id}/versions/{version_id}/activate", response_model=AssetPassport)
def activate_version_route(
    asset_id: str,
    version_id: str,
    hub: Path = Depends(require_hub),
) -> AssetPassport:
    asset = get_asset(hub, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="asset not found")
    try:
        version = activate_asset_version(hub, asset, version_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="version not found") from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    append_event(
        hub,
        LedgerEvent(
            type="asset.version",
            subject=asset.id,
            data={"label": version.label, "activated": True},
        ),
    )
    return asset


@router.post("/{asset_id}/blender", response_model=BlenderInspectResponse)
def run_blender_route(
    asset_id: str,
    hub: Path = Depends(require_hub),
) -> BlenderInspectResponse:
    asset = get_asset(hub, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="asset not found")

    try:
        info = inspect_asset(hub, asset)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    sync_current_version(asset)
    save_asset(hub, asset)
    basic = run_asset_checks(hub, asset)
    checks = basic + blender_checks(asset, info) + style_checks(asset, load_style(hub), hub)
    save_asset_checks(hub, asset, checks)
    append_event(
        hub,
        LedgerEvent(
            type="asset.blender",
            subject=asset.id,
            data={
                "triangles": asset.metrics.triangles,
                "preview": bool(asset.preview),
            },
        ),
    )
    return BlenderInspectResponse(asset=asset, checks=checks)


@router.post("/{asset_id}/checks", response_model=list[CheckResult])
def run_checks_route(asset_id: str, hub: Path = Depends(require_hub)) -> list[CheckResult]:
    asset = get_asset(hub, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="asset not found")

    results = run_asset_checks(hub, asset) + style_checks(asset, load_style(hub), hub)
    failed = sum(1 for result in results if result.status.value in {"failed", "error"})
    append_event(
        hub,
        LedgerEvent(
            type="asset.checked",
            subject=asset.id,
            data={"failed": failed, "total": len(results)},
        ),
    )
    return results


@router.delete("/{asset_id}", status_code=204)
def delete_asset_route(asset_id: str, hub: Path = Depends(require_hub)) -> None:
    if not delete_asset(hub, asset_id):
        raise HTTPException(status_code=404, detail="asset not found")
    append_event(
        hub,
        LedgerEvent(
            type="asset.deleted",
            subject=asset_id,
            data={"recoverable": False},
        ),
    )


@router.post("/{asset_id}/duplicate", response_model=AssetPassport, status_code=201)
def duplicate_asset_route(asset_id: str, hub: Path = Depends(require_hub)) -> AssetPassport:
    try:
        asset = duplicate_asset(hub, asset_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if asset is None:
        raise HTTPException(status_code=404, detail="asset not found")
    append_event(
        hub,
        LedgerEvent(
            type="asset.duplicated",
            subject=asset.id,
            data={"source": asset_id},
        ),
    )
    return asset
