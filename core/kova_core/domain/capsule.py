from datetime import datetime

from pydantic import Field

from .common import DomainModel, utc_now
from .enums import Engine
from .ids import new_id


class Capsule(DomainModel):
    id: str = Field(default_factory=lambda: new_id("cap"))
    task_id: str
    project_context: str = ""
    engine: Engine = Engine.generic
    rules: list[str] = Field(default_factory=list)
    done: list[str] = Field(default_factory=list)
    problems: list[str] = Field(default_factory=list)
    files: list[str] = Field(default_factory=list)
    constraints: list[str] = Field(default_factory=list)
    next_step: list[str] = Field(default_factory=list)
    output_format: str = ""
    forbidden: list[str] = Field(default_factory=list)
    references: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=utc_now)
