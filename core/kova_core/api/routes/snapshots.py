from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ...domain.enums import SnapshotScope
from ...domain.ledger import LedgerEvent
from ...domain.snapshot import Snapshot
from ...storage.ledger import append_event
from ...storage.snapshots import create_snapshot, list_snapshots, restore_snapshot
from ..deps import require_hub

router = APIRouter(prefix="/snapshots", tags=["snapshots"])


class CreateSnapshotRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=200)
    scope: SnapshotScope = SnapshotScope.project


@router.get("", response_model=list[Snapshot])
def get_snapshots(hub: Path = Depends(require_hub)) -> list[Snapshot]:
    return list_snapshots(hub)


@router.post("", response_model=Snapshot, status_code=201)
def post_snapshot(
    payload: CreateSnapshotRequest,
    hub: Path = Depends(require_hub),
) -> Snapshot:
    snapshot = create_snapshot(hub, payload.reason, payload.scope)
    append_event(
        hub,
        LedgerEvent(
            type="snapshot.created",
            subject=snapshot.id,
            data={"reason": snapshot.reason, "files": len(snapshot.files)},
        ),
    )
    return snapshot


@router.post("/{snapshot_id}/restore", response_model=Snapshot)
def post_restore(snapshot_id: str, hub: Path = Depends(require_hub)) -> Snapshot:
    try:
        snapshot = restore_snapshot(hub, snapshot_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    append_event(
        hub,
        LedgerEvent(type="snapshot.restored", subject=snapshot.id, data={}),
    )
    return snapshot
