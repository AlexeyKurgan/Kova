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
