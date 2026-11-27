from datetime import datetime

from pydantic import Field

from .common import DomainModel, utc_now
from .enums import AssetType, AssetVersionStatus, Engine
from .ids import new_id


class AssetMetrics(DomainModel):
    objects: int | None = None
    triangles: int | None = None
    vertices: int | None = None
    materials: int | None = None
    textures: int | None = None
    bones: int | None = None
    animations: int | None = None


class SceneObject(DomainModel):
    name: str
    type: str = "MESH"
    parent: str = ""
    vertices: int = 0
    triangles: int = 0
    materials: list[str] = Field(default_factory=list)
    location: list[float] = Field(default_factory=list)
    rotation: list[float] = Field(default_factory=list)
    scale: list[float] = Field(default_factory=list)
    dimensions: list[float] = Field(default_factory=list)


class AssetPreviewFrame(DomainModel):
    frame: int = 0
    path: str = ""


class AssetVersion(DomainModel):
    id: str = Field(default_factory=lambda: new_id("ver"))
    label: str
    status: AssetVersionStatus = AssetVersionStatus.draft
    reason: str = ""
    snapshot_id: str | None = None
    path: str = ""
    file_hash: str = ""
    file_size: int = 0
    preview: str = ""
    preview_frames: list[AssetPreviewFrame] = Field(default_factory=list)
    frame_start: int = 0
    frame_end: int = 0
    fps: float = 0
    metrics: AssetMetrics | None = None
    scene: list[SceneObject] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=utc_now)


class AssetDependency(DomainModel):
    kind: str
    target_id: str
    label: str = ""


class ExportProfile(DomainModel):
    engine: Engine
    format: str
    options: dict[str, str] = Field(default_factory=dict)


class AssetPassport(DomainModel):
    id: str = Field(default_factory=lambda: new_id("asst"))
    name: str
    type: AssetType
    engine: Engine = Engine.generic
    path: str = ""
    file_hash: str = ""
    file_size: int = 0
    preview: str = ""
    preview_frames: list[AssetPreviewFrame] = Field(default_factory=list)
    frame_start: int = 0
    frame_end: int = 0
    fps: float = 0
    current_version_id: str | None = None
    origin: str = ""
    task_id: str | None = None
    task_ids: list[str] = Field(default_factory=list)
    description: str = ""
    agent: str | None = None
    human_author: str | None = None
    license: str = ""
    metrics: AssetMetrics = Field(default_factory=AssetMetrics)
    scene: list[SceneObject] = Field(default_factory=list)
    materials: list[str] = Field(default_factory=list)
    textures: list[str] = Field(default_factory=list)
    sockets: list[str] = Field(default_factory=list)
    bones: list[str] = Field(default_factory=list)
    animations: list[str] = Field(default_factory=list)
    checks: list[str] = Field(default_factory=list)
    versions: list[AssetVersion] = Field(default_factory=list)
    dependencies: list[AssetDependency] = Field(default_factory=list)
    used_in: list[str] = Field(default_factory=list)
    export_profiles: list[ExportProfile] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    def touch(self) -> None:
        self.updated_at = utc_now()
