import hashlib
from pathlib import Path

from ..domain.asset import AssetPassport
from ..domain.check import CheckResult
from ..domain.enums import CheckStatus
from ..security.paths import resolve_inside
from ..storage.assets import get_asset, save_asset

ALLOWED_SUFFIXES = {
    ".blend": "модель",
    ".fbx": "модель",
    ".glb": "модель",
    ".gltf": "модель",
    ".obj": "модель",
    ".rbxm": "модель",
    ".rbxmx": "модель",
    ".png": "текстура",
    ".jpg": "текстура",
    ".jpeg": "текстура",
    ".tga": "текстура",
    ".exr": "текстура",
    ".psd": "текстура",
    ".webp": "текстура",
    ".wav": "аудио",
    ".mp3": "аудио",
    ".ogg": "аудио",
    ".flac": "аудио",
    ".lua": "код",
    ".py": "код",
    ".cs": "код",
    ".gd": "код",
    ".ts": "код",
    ".tsx": "код",
    ".js": "код",
    ".jsx": "код",
}


def checks_file(hub: Path, asset_id: str) -> Path:
    return resolve_inside(hub, Path("checks") / "assets" / f"{asset_id}.json")


def _read_checks(path: Path) -> dict[str, list[CheckResult]]:
    import json

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    rows = data if isinstance(data, list) else data.get("versions", {}) if isinstance(data, dict) else {}
    if isinstance(rows, list):
        rows = {"legacy": rows}
    if not isinstance(rows, dict):
        return {}
    result: dict[str, list[CheckResult]] = {}
    for version_id, items in rows.items():
        if not isinstance(items, list):
            continue
        checks: list[CheckResult] = []
        for item in items:
            try:
                checks.append(CheckResult.model_validate(item))
            except ValueError:
                continue
        result[str(version_id)] = checks
    return result


def get_asset_checks(
    hub: Path,
    asset_id: str,
    version_id: str | None = None,
) -> list[CheckResult]:
    try:
        path = checks_file(hub, asset_id)
    except ValueError:
        return []
    if not path.is_file():
        return []
    rows = _read_checks(path)
    asset = get_asset(hub, asset_id)
    target = version_id or (asset.current_version_id if asset else None)
    if target and target in rows:
        return rows[target]
    first_id = asset.versions[0].id if asset and asset.versions else None
    if "legacy" in rows and (target is None or target == first_id):
        return rows["legacy"]
    return []


def save_asset_checks(
    hub: Path,
    asset: AssetPassport,
    results: list[CheckResult],
) -> list[CheckResult]:
    target = checks_file(hub, asset.id)
    target.parent.mkdir(parents=True, exist_ok=True)
    rows = _read_checks(target) if target.is_file() else {}
    version_id = asset.current_version_id or "legacy"
    rows[version_id] = results
    payload = {
        "versions": {
            key: [result.model_dump(mode="json") for result in checks]
            for key, checks in rows.items()
        }
    }
    import json

    target.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    asset.checks = [result.id for result in results]
    save_asset(hub, asset)
    return results


def run_asset_checks(hub: Path, asset: AssetPassport) -> list[CheckResult]:
    results: list[CheckResult] = []

    try:
        path = resolve_inside(hub.parent, asset.path)
        exists = path.is_file()
    except ValueError:
        path = None
        exists = False

    results.append(
        CheckResult(
            name="Файл на месте",
            status=CheckStatus.passed if exists else CheckStatus.failed,
            message=asset.path or "путь не указан",
            asset_id=asset.id,
            engine=asset.engine,
        )
    )

    if path is not None and exists:
        size = path.stat().st_size
        results.append(
            CheckResult(
                name="Файл не пустой",
                status=CheckStatus.passed if size > 0 else CheckStatus.failed,
                message=f"{size} байт",
                details={"size": size},
                asset_id=asset.id,
                engine=asset.engine,
            )
        )

        suffix = path.suffix.lower()
        allowed = suffix in ALLOWED_SUFFIXES
        results.append(
            CheckResult(
                name="Поддерживаемый формат",
                status=CheckStatus.passed if allowed else CheckStatus.warning,
                message=(
                    f"{suffix} · {ALLOWED_SUFFIXES[suffix]}"
                    if allowed
                    else f"{suffix or 'без расширения'} не в списке поддержки"
                ),
                details={"suffix": suffix},
                asset_id=asset.id,
                engine=asset.engine,
            )
        )

        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        hash_ok = not asset.file_hash or digest == asset.file_hash
        results.append(
            CheckResult(
                name="Хеш совпадает",
                status=CheckStatus.passed if hash_ok else CheckStatus.failed,
                message="sha256 совпадает" if hash_ok else "файл изменился после импорта",
                details={"sha256": digest},
                asset_id=asset.id,
                engine=asset.engine,
            )
        )

    return save_asset_checks(hub, asset, results)
