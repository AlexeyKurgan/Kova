from pathlib import Path

from fastapi import HTTPException

from ..storage.projects import read_active_hub


def require_hub() -> Path:
    hub = read_active_hub()
    if hub is None:
        raise HTTPException(status_code=404, detail="no active project")
    return hub
