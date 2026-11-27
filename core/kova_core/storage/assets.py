import hashlib
import shutil
from pathlib import Path

from ..domain.asset import AssetMetrics, AssetPassport, AssetVersion
from ..domain.enums import AssetType, AssetVersionStatus, Engine
from ..security.paths import resolve_inside


def _normalize(asset: AssetPassport) -> AssetPassport:
    if asset.task_id and asset.task_id not in asset.task_ids:
        asset.task_ids.append(asset.task_id)
    if asset.versions:
        if not asset.current_version_id:
            asset.current_version_id = asset.versions[-1].id
        for version in asset.versions:
            if version.path:
                continue
            version.path = asset.path
            version.file_hash = asset.file_hash
            version.file_size = asset.file_size
            version.preview = asset.preview
            version.metrics = asset.metrics.model_copy(deep=True)
    return asset


def list_assets(hub: Path) -> list[AssetPassport]:
    directory = hub / "assets"
    if not directory.is_dir():
        return []

    assets: list[AssetPassport] = []
    for path in directory.glob("*.json"):
        try:
            assets.append(_normalize(AssetPassport.model_validate_json(path.read_text(encoding="utf-8"))))
        except (OSError, ValueError):
            continue
    assets.sort(key=lambda asset: asset.updated_at, reverse=True)
    return assets


def get_asset(hub: Path, asset_id: str) -> AssetPassport | None:
    try:
        path = resolve_inside(hub, Path("assets") / f"{asset_id}.json")
    except ValueError:
        return None
    if not path.is_file():
        return None
    return _normalize(AssetPassport.model_validate_json(path.read_text(encoding="utf-8")))


def save_asset(hub: Path, asset: AssetPassport) -> AssetPassport:
    from ..domain.common import utc_now

    asset.updated_at = utc_now()
    target = resolve_inside(hub, Path("assets") / f"{asset.id}.json")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(asset.model_dump_json(indent=2) + "\n", encoding="utf-8")
    return asset


def _sync_task_asset(hub: Path, task_id: str, asset_id: str, linked: bool) -> None:
    from .tasks import get_task, save_task

    task = get_task(hub, task_id)
    if task is None:
        return
    current = list(task.asset_ids)
    if linked and asset_id not in current:
        current.append(asset_id)
        task.asset_ids = current
        save_task(hub, task)
    elif not linked and asset_id in current:
        task.asset_ids = [item for item in current if item != asset_id]
        save_task(hub, task)


def set_asset_tasks(
    hub: Path,
    asset: AssetPassport,
    task_ids: list[str],
) -> AssetPassport:
    from .tasks import get_task

    wanted = list(dict.fromkeys(item for item in task_ids if get_task(hub, item) is not None))
    current = set(asset.task_ids)
    target = set(wanted)
    for task_id in current - target:
        _sync_task_asset(hub, task_id, asset.id, False)
    for task_id in target - current:
        _sync_task_asset(hub, task_id, asset.id, True)
    asset.task_ids = wanted
    asset.task_id = wanted[0] if wanted else None
    return save_asset(hub, asset)


def link_asset_task(hub: Path, asset: AssetPassport, task_id: str) -> AssetPassport:
    return set_asset_tasks(hub, asset, [*asset.task_ids, task_id])


def unlink_task_from_assets(hub: Path, task_id: str) -> None:
    for asset in list_assets(hub):
        if task_id in asset.task_ids or asset.task_id == task_id:
            asset.task_ids = [item for item in asset.task_ids if item != task_id]
            asset.task_id = asset.task_ids[0] if asset.task_ids else None
            save_asset(hub, asset)


def _version_target(project_root: Path, asset: AssetPassport, source: Path, number: int) -> Path:
    directory = project_root / "assets"
    directory.mkdir(parents=True, exist_ok=True)
    stem = Path(asset.path).stem if asset.path else asset.id
    target = directory / f"{stem}_v{number}{source.suffix}"
    counter = 1
    while target.exists():
        target = directory / f"{stem}_v{number}_{counter}{source.suffix}"
        counter += 1
    return target


def add_asset_version(
    hub: Path,
    asset: AssetPassport,
    source_path: Path,
    reason: str = "",
    make_current: bool = True,
) -> AssetVersion:
    source = source_path.expanduser().resolve()
    if not source.is_file():
        raise FileNotFoundError(f"file not found: {source_path}")

    project_root = hub.parent
    number = len(asset.versions) + 1
    target = _version_target(project_root, asset, source, number)
    shutil.copy2(source, target)
    data = target.read_bytes()
    relative = target.relative_to(project_root).as_posix()
    version = AssetVersion(
        label=f"v{number}",
        status=AssetVersionStatus.draft,
        reason=reason or "Новая версия",
        path=relative,
        file_hash=hashlib.sha256(data).hexdigest(),
        file_size=len(data),
        preview="",
        metrics=AssetMetrics(),
    )
    asset.versions.append(version)
    if make_current:
        asset.current_version_id = version.id
        asset.path = version.path
        asset.file_hash = version.file_hash
        asset.file_size = version.file_size
        asset.preview = ""
        asset.metrics = AssetMetrics()
        asset.scene = []
    save_asset(hub, asset)
    return version


def activate_asset_version(hub: Path, asset: AssetPassport, version_id: str) -> AssetVersion:
    version = next((item for item in asset.versions if item.id == version_id), None)
    if version is None:
        raise KeyError("version not found")
    if not version.path:
        raise FileNotFoundError("у версии нет файла")
    target = resolve_inside(hub.parent, version.path)
    if not target.is_file():
        raise FileNotFoundError("файл версии не найден")
    asset.current_version_id = version.id
    asset.path = version.path
    asset.file_hash = version.file_hash
    asset.file_size = version.file_size
    asset.preview = version.preview
    asset.metrics = version.metrics.model_copy(deep=True) if version.metrics else AssetMetrics()
    asset.scene = [item.model_copy(deep=True) for item in version.scene]
    save_asset(hub, asset)
    return version


def sync_current_version(asset: AssetPassport) -> AssetVersion | None:
    version = next(
        (item for item in asset.versions if item.id == asset.current_version_id),
        asset.versions[-1] if asset.versions else None,
    )
    if version is None:
        return None
    version.path = asset.path
    version.file_hash = asset.file_hash
    version.file_size = asset.file_size
    version.preview = asset.preview
    version.metrics = asset.metrics.model_copy(deep=True)
    version.scene = [item.model_copy(deep=True) for item in asset.scene]
    return version


def infer_asset_type(path: Path) -> AssetType:
    suffix = path.suffix.lower()
    if suffix in {".blend", ".fbx", ".glb", ".gltf", ".obj", ".rbxm", ".rbxmx", ".usd", ".usdz"}:
        return AssetType.model
    if suffix in {".png", ".jpg", ".jpeg", ".tga", ".exr", ".psd", ".webp"}:
        return AssetType.texture
    if suffix in {".wav", ".mp3", ".ogg", ".flac"}:
        return AssetType.audio
    if suffix in {".lua", ".py", ".cs", ".gd", ".ts", ".tsx", ".js", ".jsx"}:
        return AssetType.code
    if suffix in {".anim", ".fbx.anim"}:
        return AssetType.animation
    if suffix in {".vfx", ".efx"}:
        return AssetType.effect
    return AssetType.other


def _copy_target(project_root: Path, source: Path) -> Path:
    directory = project_root / "assets"
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / source.name
    counter = 1
    while target.exists():
        target = directory / f"{source.stem} ({counter}){source.suffix}"
        counter += 1
    return target


def import_asset(
    hub: Path,
    source_path: Path,
    name: str | None = None,
    asset_type: AssetType | None = None,
    engine: Engine | None = None,
    license: str = "",
    task_id: str | None = None,
) -> AssetPassport:
    source = source_path.expanduser().resolve()
    if not source.is_file():
        raise FileNotFoundError(f"file not found: {source_path}")

    project_root = hub.parent
    target = _copy_target(project_root, source)
    shutil.copy2(source, target)

    data = target.read_bytes()
    relative = target.relative_to(project_root).as_posix()
    digest = hashlib.sha256(data).hexdigest()
    version = AssetVersion(
        label="v1",
        status=AssetVersionStatus.draft,
        reason="Импорт в проект",
        path=relative,
        file_hash=digest,
        file_size=len(data),
        metrics=AssetMetrics(),
    )
    asset = AssetPassport(
        name=name or source.stem,
        type=asset_type or infer_asset_type(source),
        engine=engine or Engine.generic,
        path=relative,
        file_hash=digest,
        file_size=len(data),
        current_version_id=version.id,
        origin=str(source),
        license=license,
        task_id=task_id,
        task_ids=[task_id] if task_id else [],
        versions=[version],
    )
    saved = save_asset(hub, asset)
    if task_id:
        _sync_task_asset(hub, task_id, saved.id, True)
    return saved


def delete_asset(hub: Path, asset_id: str) -> bool:
    """Delete an asset passport, its copied files and previews.

    Files are removed only when they are inside the project's assets folder,
    were created for this asset, and are not referenced by another asset.
    """
    asset = get_asset(hub, asset_id)
    if asset is None:
        return False

    project_root = hub.parent
    other_paths: set[str] = set()
    other_previews: set[str] = set()
    for other in list_assets(hub):
        if other.id == asset_id:
            continue
        for version in other.versions:
            if version.path:
                other_paths.add(version.path)
            if version.preview:
                other_previews.add(version.preview)
        if other.path:
            other_paths.add(other.path)
        if other.preview:
            other_previews.add(other.preview)

    paths: set[str] = set(other_paths)
    previews: set[str] = set()
    for version in asset.versions:
        if version.path:
            paths.add(version.path)
        if version.preview:
            previews.add(version.preview)
    if asset.path:
        paths.add(asset.path)
    if asset.preview:
        previews.add(asset.preview)

    for relative in paths - other_paths:
        try:
            target = resolve_inside(project_root, relative)
        except ValueError:
            continue
        try:
            inside = target.relative_to(project_root).as_posix()
        except ValueError:
            continue
        if not inside.startswith("assets/"):
            continue
        if target.is_file():
            target.unlink(missing_ok=True)

    for relative in previews - other_previews:
        try:
            target = resolve_inside(hub, relative)
        except ValueError:
            continue
        if target.is_file() and "artifacts" in target.relative_to(hub).parts:
            target.unlink(missing_ok=True)

    from ..checks.assets import checks_file
    from .tasks import get_task, save_task

    checks_file(hub, asset_id).unlink(missing_ok=True)
    for task_id in list(asset.task_ids):
        task = get_task(hub, task_id)
        if task is None:
            continue
        if asset_id in task.asset_ids:
            task.asset_ids = [item for item in task.asset_ids if item != asset_id]
            save_task(hub, task)

    resolve_inside(hub, Path("assets") / f"{asset_id}.json").unlink(missing_ok=True)
    return True


def duplicate_asset(hub: Path, asset_id: str) -> AssetPassport | None:
    asset = get_asset(hub, asset_id)
    if asset is None:
        return None
    project_root = hub.parent
    source = resolve_inside(project_root, asset.path or "")
    if not source.is_file():
        raise FileNotFoundError("asset file not found")
    target = _copy_target(project_root, source)
    shutil.copy2(source, target)
    data = target.read_bytes()
    relative = target.relative_to(project_root).as_posix()
    digest = hashlib.sha256(data).hexdigest()
    version = AssetVersion(
        label="v1",
        status=AssetVersionStatus.draft,
        reason="Копия ассета",
        path=relative,
        file_hash=digest,
        file_size=len(data),
        metrics=asset.metrics.model_copy(deep=True) if asset.metrics else AssetMetrics(),
    )
    copy = AssetPassport(
        name=f"{asset.name} copy",
        type=asset.type,
        engine=asset.engine,
        path=relative,
        file_hash=digest,
        file_size=len(data),
        preview="",
        current_version_id=version.id,
        origin=asset.origin,
        description=asset.description,
        license=asset.license,
        metrics=asset.metrics.model_copy(deep=True) if asset.metrics else AssetMetrics(),
        versions=[version],
    )
    return save_asset(hub, copy)
