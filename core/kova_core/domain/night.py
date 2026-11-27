from datetime import datetime

from pydantic import Field

from .common import DomainModel, utc_now
from .ids import new_id


class NightEntry(DomainModel):
    task_id: str
    task_title: str
    status: str = "queued"
    run_id: str = ""
    review_id: str = ""
    message: str = ""


class NightShiftConfig(DomainModel):
    enabled: bool = False
    start_at: str = "23:00"
    provider_id: str = ""
    task_ids: list[str] = Field(default_factory=list)
    max_tasks: int = 5
    stop_on_error: bool = True


class NightShiftRun(DomainModel):
    id: str = Field(default_factory=lambda: new_id("night"))
    status: str = "queued"
    started_at: datetime | None = None
    finished_at: datetime | None = None
    entries: list[NightEntry] = Field(default_factory=list)
    current_index: int = 0
    error: str = ""


class NightShiftState(DomainModel):
    config: NightShiftConfig = Field(default_factory=NightShiftConfig)
    run: NightShiftRun | None = None
    updated_at: datetime = Field(default_factory=utc_now)
