from datetime import datetime

from pydantic import Field

from .common import DomainModel
from .enums import Permission, ProviderKind
from .ids import new_id


class Provider(DomainModel):
    id: str = Field(default_factory=lambda: new_id("prov"))
    kind: ProviderKind
    name: str = ""
    command: str | None = None
    endpoint: str | None = None
    models: list[str] = Field(default_factory=list)
    limits: dict[str, str] = Field(default_factory=dict)
    privacy: str = ""
    permissions: list[Permission] = Field(default_factory=list)
    last_used: datetime | None = None
