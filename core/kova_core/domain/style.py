from datetime import datetime

from pydantic import Field

from .common import DomainModel, utc_now


class StyleBible(DomainModel):
    enabled: bool = False
    name: str = "Style Bible"
    description: str = ""
    palette: list[str] = Field(default_factory=list)
    max_triangles: int | None = None
    max_vertices: int | None = None
    max_materials: int | None = None
    max_textures: int | None = None
    max_bones: int | None = None
    require_license: bool = False
    naming_pattern: str = ""
    updated_at: datetime = Field(default_factory=utc_now)
