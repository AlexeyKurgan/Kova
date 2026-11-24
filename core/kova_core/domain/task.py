from datetime import datetime

from pydantic import Field

from .common import DomainModel, utc_now
from .enums import AgentMode, Engine, TaskStatus, TaskType
from .ids import new_id


class Criterion(DomainModel):
    id: str = Field(default_factory=lambda: new_id("crit"))
    text: str
    done: bool = False
    check_id: str | None = None


class Reference(DomainModel):
    label: str
    uri: str
    kind: str = "link"


class ArtifactRef(DomainModel):
    id: str = Field(default_factory=lambda: new_id("art"))
    kind: str
    path: str
    created_at: datetime = Field(default_factory=utc_now)


class Task(DomainModel):
    id: str = Field(default_factory=lambda: new_id("task"))
    title: str
    status: TaskStatus = TaskStatus.draft
    type: TaskType = TaskType.model
    engine: Engine = Engine.generic
    goal: str = ""
    criteria: list[Criterion] = Field(default_factory=list)
    constraints: list[str] = Field(default_factory=list)
    references: list[Reference] = Field(default_factory=list)
    assigned_agent: str | None = None
    mode: AgentMode = AgentMode.clipboard
    skills: list[str] = Field(default_factory=list)
    asset_ids: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
    current_snapshot: str | None = None
    artifacts: list[ArtifactRef] = Field(default_factory=list)
    checks: list[str] = Field(default_factory=list)
    decisions: list[str] = Field(default_factory=list)
    next_step: str = ""
    tags: list[str] = Field(default_factory=list)
    deleted_at: datetime | None = None

    def touch(self) -> None:
        self.updated_at = utc_now()
