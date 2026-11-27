import re

from ..domain.asset import AssetPassport
from ..domain.check import CheckResult
from ..domain.enums import CheckStatus
from ..domain.style import StyleBible


def _budget(
    asset: AssetPassport,
    label: str,
    value: int | None,
    limit: int | None,
) -> CheckResult | None:
    if limit is None or limit <= 0 or value is None:
        return None
    if value <= limit:
        return None
    return CheckResult(
        name=f"Стиль: {label}",
        status=CheckStatus.warning,
        message=f"{value} больше лимита Style Bible ({limit})",
        details={"value": value, "limit": limit},
        asset_id=asset.id,
        engine=asset.engine,
    )


def style_checks(asset: AssetPassport, bible: StyleBible) -> list[CheckResult]:
    if not bible.enabled:
        return []

    metrics = asset.metrics
    candidates = [
        _budget(asset, "треугольники", metrics.triangles, bible.max_triangles),
        _budget(asset, "вершины", metrics.vertices, bible.max_vertices),
        _budget(asset, "материалы", metrics.materials, bible.max_materials),
        _budget(asset, "текстуры", metrics.textures, bible.max_textures),
        _budget(asset, "кости", metrics.bones, bible.max_bones),
    ]
    results = [item for item in candidates if item is not None]

    if bible.require_license and not asset.license.strip():
        results.append(
            CheckResult(
                name="Стиль: лицензия",
                status=CheckStatus.warning,
                message="У ассета не указана лицензия",
                asset_id=asset.id,
                engine=asset.engine,
            )
        )

    pattern = bible.naming_pattern.strip()
    if pattern:
        try:
            matched = re.search(pattern, asset.name) is not None
        except re.error:
            results.append(
                CheckResult(
                    name="Стиль: шаблон имени",
                    status=CheckStatus.warning,
                    message=f"Шаблон имени задан неверно: {pattern}",
                    asset_id=asset.id,
                    engine=asset.engine,
                )
            )
        else:
            if not matched:
                results.append(
                    CheckResult(
                        name="Стиль: шаблон имени",
                        status=CheckStatus.warning,
                        message=f"Имя «{asset.name}» не соответствует шаблону {pattern}",
                        details={"pattern": pattern},
                        asset_id=asset.id,
                        engine=asset.engine,
                    )
                )

    return results
