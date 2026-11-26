from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, Query

from ..deps import require_hub
from ...memory import search_memory

router = APIRouter(prefix="/memory", tags=["memory"])


@router.get("/search")
def search(
    q: str = Query(default="", max_length=200),
    limit: int = Query(default=50, ge=1, le=200),
    hub: Path = Depends(require_hub),
) -> dict[str, Any]:
    return search_memory(hub, q, limit)
