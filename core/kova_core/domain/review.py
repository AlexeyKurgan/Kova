from datetime import datetime

from pydantic import Field

from .common import DomainModel, utc_now
from .enums import ReviewStatus
from .ids import new_id


class ReviewItem(DomainModel):
    id: str = Field(default_factory=lambda: new_id("rev"))
    task_id: str
    asset_id: str | None = None
    status: ReviewStatus = ReviewStatus.pending
    summary: str = ""
    artifact_path: str | None = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class ReviewComment(DomainModel):
    id: str = Field(default_factory=lambda: new_id("rcm"))
    review_id: str
    asset_id: str | None = None
    version_id: str | None = None
    x: float = Field(default=0.5, ge=0, le=1)
    y: float = Field(default=0.5, ge=0, le=1)
    body: str = Field(min_length=1, max_length=2000)
    author: str = "human"
    resolved: bool = False
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
