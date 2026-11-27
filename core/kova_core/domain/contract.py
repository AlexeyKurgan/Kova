from pydantic import Field

from .check import CheckResult
from .common import DomainModel
from .enums import Engine


class EngineContract(DomainModel):
    engine: Engine
    title: str
    formats: list[str] = Field(default_factory=list)
    up_axis: str = ""
    forward_axis: str = ""
    scale: str = ""
    pivot: str = ""
    max_triangles: int | None = None
    max_materials: int | None = None
    max_textures: int | None = None
    required_sockets: list[str] = Field(default_factory=list)
    notes: str = ""


class ContractReport(DomainModel):
    contract: EngineContract
    checks: list[CheckResult] = Field(default_factory=list)
