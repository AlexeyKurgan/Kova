from datetime import datetime
from typing import Any

from pydantic import Field

from .common import DomainModel, utc_now
from .ids import new_id


class LedgerEvent(DomainModel):
    id: str = Field(default_factory=lambda: new_id("evt"))
    type: str
    at: datetime = Field(default_factory=utc_now)
    actor: str = "human"
    subject: str = ""
    data: dict[str, Any] = Field(default_factory=dict)
