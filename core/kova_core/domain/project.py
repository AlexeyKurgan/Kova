from datetime import datetime

from pydantic import Field

from .common import DomainModel, utc_now
from .enums import Engine, IsolationMode


class Project(DomainModel):
    schema_version: int = 1
    name: str
    engine: Engine = Engine.generic
    max_parallel_runs: int = Field(default=1, ge=1, le=4)
    isolation: IsolationMode = IsolationMode.direct
    token_budget: int = Field(default=0, ge=0, le=100_000_000)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
