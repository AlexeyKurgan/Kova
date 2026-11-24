from pydantic import Field

from .common import DomainModel
from .enums import Engine, PackageType, Permission, TrustLevel
from .ids import new_id


class KovaPackage(DomainModel):
    id: str = Field(default_factory=lambda: new_id("pkg"))
    name: str
    version: str = "0.0.0"
    type: PackageType
    author: str = ""
    engines: list[Engine] = Field(default_factory=list)
    permissions: list[Permission] = Field(default_factory=list)
    tools: list[str] = Field(default_factory=list)
    checks: list[str] = Field(default_factory=list)
    templates: list[str] = Field(default_factory=list)
    ui: list[str] = Field(default_factory=list)
    signature: str = ""
    trust: TrustLevel = TrustLevel.local
    compatibility: str = ""
