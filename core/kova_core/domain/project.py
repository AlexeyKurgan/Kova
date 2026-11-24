from datetime import datetime

from pydantic import Field

from .common import DomainModel, utc_now
from .enums import Engine


class Project(DomainModel):
    schema_version: int = 1
    name: str
    engine: Engine = Engine.generic
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
