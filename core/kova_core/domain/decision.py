from datetime import datetime

from pydantic import Field

from .common import DomainModel, utc_now
from .ids import new_id


class Decision(DomainModel):
    id: str = Field(default_factory=lambda: new_id("dec"))
    title: str
    reason: str = ""
    task_id: str | None = None
    snapshot_id: str | None = None
    created_at: datetime = Field(default_factory=utc_now)
    tags: list[str] = Field(default_factory=list)
