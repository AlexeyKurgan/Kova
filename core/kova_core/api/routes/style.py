from pathlib import Path

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ...checks.style import style_checks
from ...domain.check import CheckResult
from ...domain.ledger import LedgerEvent
from ...domain.style import StyleBible
from ...storage.assets import list_assets
from ...storage.ledger import append_event
from ...storage.style import load_style, save_style
from ..deps import require_hub

router = APIRouter(prefix="/style", tags=["style"])


class StyleUpdate(BaseModel):
    enabled: bool | None = None
    name: str | None = None
    description: str | None = None
    palette: list[str] | None = None
    max_triangles: int | None = None
    max_vertices: int | None = None
    max_materials: int | None = None
    max_textures: int | None = None
    max_bones: int | None = None
    require_license: bool | None = None
    naming_pattern: str | None = None


class StyleViolation(BaseModel):
    asset_id: str
    asset_name: str
    checks: list[CheckResult] = Field(default_factory=list)


@router.get("", response_model=StyleBible)
def get_style(hub: Path = Depends(require_hub)) -> StyleBible:
    return load_style(hub)


@router.patch("", response_model=StyleBible)
def update_style(
    payload: StyleUpdate,
    hub: Path = Depends(require_hub),
) -> StyleBible:
    bible = load_style(hub)
    updates = payload.model_dump(exclude_unset=True)
    for key, value in updates.items():
        setattr(bible, key, value)
    if bible.max_triangles is not None:
        bible.max_triangles = max(0, bible.max_triangles)
    if bible.max_vertices is not None:
        bible.max_vertices = max(0, bible.max_vertices)
    if bible.max_materials is not None:
        bible.max_materials = max(0, bible.max_materials)
    if bible.max_textures is not None:
        bible.max_textures = max(0, bible.max_textures)
    if bible.max_bones is not None:
        bible.max_bones = max(0, bible.max_bones)
    saved = save_style(hub, bible)
    append_event(
        hub,
        LedgerEvent(
            type="style.updated",
            subject="style",
            data={"enabled": saved.enabled, "name": saved.name},
        ),
    )
    return saved


@router.get("/violations", response_model=list[StyleViolation])
def get_violations(hub: Path = Depends(require_hub)) -> list[StyleViolation]:
    bible = load_style(hub)
    if not bible.enabled:
        return []
    rows: list[StyleViolation] = []
    for asset in list_assets(hub):
        checks = style_checks(asset, bible, hub)
        if checks:
            rows.append(
                StyleViolation(
                    asset_id=asset.id,
                    asset_name=asset.name,
                    checks=checks,
                )
            )
    return rows
