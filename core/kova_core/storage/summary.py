from pathlib import Path

from ..checks.assets import get_asset_checks
from ..domain.enums import AssetVersionStatus, CheckStatus, TaskStatus
from .assets import list_assets
from .tasks import list_tasks

ACTIVE_TASK_STATUSES = {
    TaskStatus.draft,
    TaskStatus.ready,
    TaskStatus.working,
    TaskStatus.checking,
    TaskStatus.review,
    TaskStatus.blocked,
}


def project_stats(hub: Path) -> dict[str, int]:
    tasks = list_tasks(hub)
    assets = list_assets(hub)

    return {
        "assets_total": len(assets),
        "assets_review": sum(
            1
            for asset in assets
            if any(version.status is AssetVersionStatus.review for version in asset.versions)
        ),
        "assets_accepted": sum(
            1
            for asset in assets
            if any(version.status is AssetVersionStatus.accepted for version in asset.versions)
        ),
        "assets_problems": sum(
            1
            for asset in assets
            if any(
                result.status in {CheckStatus.failed, CheckStatus.error}
                for result in get_asset_checks(hub, asset.id)
            )
        ),
        "tasks_total": len(tasks),
        "tasks_active": sum(1 for task in tasks if task.status in ACTIVE_TASK_STATUSES),
        "tasks_review": sum(1 for task in tasks if task.status is TaskStatus.review),
        "tasks_done": sum(1 for task in tasks if task.status is TaskStatus.done),
    }
