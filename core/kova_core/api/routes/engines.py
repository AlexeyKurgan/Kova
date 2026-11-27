from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from ...domain.enums import Engine
from ...domain.ledger import LedgerEvent
from ...integrations.engines import IMPORT_FORMATS, detect_engine, import_asset_to_engine
from ...packages import store
from ...storage.assets import get_asset
from ...storage.ledger import append_event
from ..deps import require_hub

router = APIRouter(prefix="/engines", tags=["engines"])

SUPPORTED = [Engine.godot, Engine.unity, Engine.unreal, Engine.rpgmaker, Engine.web]


@router.get("")
def list_engines(hub: Path = Depends(require_hub)) -> list[dict[str, object]]:
    return [
        detect_engine(engine, hub.parent).model_dump(mode="json")
        for engine in SUPPORTED
    ]


@router.get("/{engine}")
def get_engine(engine: Engine, hub: Path = Depends(require_hub)) -> dict[str, object]:
    if engine not in SUPPORTED:
        raise HTTPException(status_code=404, detail="engine is not supported")
    return detect_engine(engine, hub.parent).model_dump(mode="json")


@router.post("/{engine}/import/{asset_id}")
def import_asset(
    engine: Engine,
    asset_id: str,
    hub: Path = Depends(require_hub),
) -> dict[str, object]:
    if engine not in IMPORT_FORMATS:
        raise HTTPException(status_code=404, detail="engine is not supported")
    package = store.get_package(hub, f"{engine.value}-core")
    if package is None or not package.get("installed") or not package.get("enabled"):
        raise HTTPException(
            status_code=400,
            detail=f"Установи и включи пакет {engine.value}-core в разделе «Пакеты»",
        )
    asset = get_asset(hub, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="asset not found")
    try:
        result = import_asset_to_engine(engine, hub.parent, hub, asset)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    append_event(
        hub,
        LedgerEvent(
            type="engine.imported",
            subject=asset.id,
            data={"engine": engine.value, **result},
        ),
    )
    return result
