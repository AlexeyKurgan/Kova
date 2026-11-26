from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ...domain.enums import SnapshotScope
from ...domain.ledger import LedgerEvent
from ...domain.snapshot import Snapshot
from ...storage.ledger import append_event
from ...storage.snapshots import (
    cleanup_snapshots,
    create_snapshot,
    delete_snapshot,
    diff_snapshot,
    list_snapshots,
    restore_snapshot,
)
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


@router.post("/cleanup")
def post_cleanup(keep: int = 10, days: int = 30, hub: Path = Depends(require_hub)) -> dict[str, int]:
    return cleanup_snapshots(hub, keep, days)


@router.delete("/{snapshot_id}", status_code=204)
def delete_snapshot_route(snapshot_id: str, hub: Path = Depends(require_hub)) -> None:
    if not delete_snapshot(hub, snapshot_id):
        raise HTTPException(status_code=404, detail="snapshot not found")


@router.get("/{snapshot_id}/diff")
def get_snapshot_diff(
    snapshot_id: str,
    hub: Path = Depends(require_hub),
) -> dict[str, object]:
    from ...storage.snapshots import get_snapshot

    if get_snapshot(hub, snapshot_id) is None:
        raise HTTPException(status_code=404, detail="snapshot not found")
    return diff_snapshot(hub, snapshot_id)


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
