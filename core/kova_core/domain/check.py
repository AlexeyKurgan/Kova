from datetime import datetime
from typing import Any

from pydantic import Field

from .common import DomainModel, utc_now
from .enums import CheckStatus, Engine
from .ids import new_id


class CheckResult(DomainModel):
    id: str = Field(default_factory=lambda: new_id("chk"))
    name: str
    display_name: str = ""
    status: CheckStatus = CheckStatus.pending
    message: str = ""
    display_message: str = ""
    details: dict[str, Any] = Field(default_factory=dict)
    task_id: str | None = None
    asset_id: str | None = None
    engine: Engine = Engine.generic
    created_at: datetime = Field(default_factory=utc_now)
