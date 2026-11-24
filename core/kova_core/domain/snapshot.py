from datetime import datetime

from pydantic import Field

from .common import DomainModel, utc_now
from .enums import SnapshotScope
from .ids import new_id


class SnapshotFile(DomainModel):
    path: str
    hash: str
    size: int = 0


class Snapshot(DomainModel):
    id: str = Field(default_factory=lambda: new_id("snap"))
    reason: str
    scope: SnapshotScope = SnapshotScope.project
    parent: str | None = None
    created_at: datetime = Field(default_factory=utc_now)
    created_by: str = "human"
    files: list[SnapshotFile] = Field(default_factory=list)
    manifest: str = ""
    hash: str = ""
    restore_point: bool = False
    label: str = ""
