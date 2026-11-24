from pathlib import Path

from fastapi import APIRouter, Depends, Query

from ...domain.ledger import LedgerEvent
from ...storage.ledger import list_events
from ..deps import require_hub

router = APIRouter(tags=["ledger"])


@router.get("/ledger", response_model=list[LedgerEvent])
def get_ledger(
    limit: int = Query(default=30, ge=1, le=2000),
    hub: Path = Depends(require_hub),
) -> list[LedgerEvent]:
    return list_events(hub, limit)
