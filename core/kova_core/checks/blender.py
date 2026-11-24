from ..domain.asset import AssetPassport
from ..domain.check import CheckResult
from ..domain.enums import CheckStatus


def blender_checks(asset: AssetPassport, info: dict[str, object]) -> list[CheckResult]:
    metrics = asset.metrics
    missing = list(info.get("missing_textures") or [])
    results: list[CheckResult] = [
        CheckResult(
            name="Blender: файл открывается",
            status=CheckStatus.passed,
            message="сцена загружена",
            asset_id=asset.id,
            engine=asset.engine,
        ),
        CheckResult(
            name="Геометрия",
            status=(
                CheckStatus.passed
                if (metrics.triangles or 0) > 0
                else CheckStatus.failed
            ),
            message=f"{metrics.triangles or 0} треугольников · {metrics.vertices or 0} вершин",
            details={
                "triangles": metrics.triangles,
                "vertices": metrics.vertices,
            },
            asset_id=asset.id,
            engine=asset.engine,
        ),
        CheckResult(
            name="Материалы",
            status=(
                CheckStatus.passed
                if (metrics.materials or 0) > 0
                else CheckStatus.warning
            ),
            message=f"{metrics.materials or 0} материалов",
            asset_id=asset.id,
            engine=asset.engine,
        ),
        CheckResult(
            name="Текстуры",
            status=CheckStatus.warning if missing else CheckStatus.passed,
            message=(
                f"не найдены: {', '.join(missing)}"
                if missing
                else f"{metrics.textures or 0} текстур"
            ),
            details={"missing": missing},
            asset_id=asset.id,
            engine=asset.engine,
        ),
    ]

    if (metrics.animations or 0) > 0:
        results.append(
            CheckResult(
                name="Анимации",
                status=CheckStatus.passed,
                message=f"{metrics.animations} действий · {metrics.bones or 0} костей",
                asset_id=asset.id,
                engine=asset.engine,
            )
        )

    return results
