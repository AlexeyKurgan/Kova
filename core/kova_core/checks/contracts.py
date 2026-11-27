from pathlib import Path

from ..domain.asset import AssetPassport
from ..domain.check import CheckResult
from ..domain.contract import EngineContract
from ..domain.enums import CheckStatus, Engine

CONTRACTS: dict[Engine, EngineContract] = {
    Engine.generic: EngineContract(
        engine=Engine.generic,
        title="Без движка",
        formats=[".blend", ".fbx", ".glb", ".gltf", ".obj", ".png", ".wav"],
        up_axis="не задано",
        forward_axis="не задано",
        scale="не задано",
        pivot="не задано",
        notes="Движок не выбран: контракт не навязывает формат и бюджеты.",
    ),
    Engine.blender: EngineContract(
        engine=Engine.blender,
        title="Blender",
        formats=[".blend", ".fbx", ".glb", ".gltf", ".obj"],
        up_axis="Z вверх",
        forward_axis="−Y вперёд",
        scale="метры, 1.0",
        pivot="по центру объекта",
        max_triangles=100_000,
        max_materials=8,
        max_textures=8,
        notes="Рабочий файл .blend — источник; FBX/GLB для обмена.",
    ),
    Engine.roblox: EngineContract(
        engine=Engine.roblox,
        title="Roblox",
        formats=[".fbx", ".glb", ".gltf"],
        up_axis="Y вверх",
        forward_axis="−Z вперёд",
        scale="studs, 1 unit",
        pivot="по центру основания",
        max_triangles=20_000,
        max_materials=2,
        max_textures=4,
        notes="Low-poly и один атлас. Пивот ставится до экспорта, MeshPart — через bridge.",
    ),
    Engine.godot: EngineContract(
        engine=Engine.godot,
        title="Godot",
        formats=[".glb", ".gltf"],
        up_axis="Y вверх",
        forward_axis="−Z вперёд",
        scale="метры, 1.0",
        pivot="у основания",
        max_triangles=50_000,
        max_materials=4,
        max_textures=8,
        notes="Основной формат — GLB. Материалы PBR, без встроенных скриптов.",
    ),
    Engine.unity: EngineContract(
        engine=Engine.unity,
        title="Unity",
        formats=[".fbx", ".glb"],
        up_axis="Y вверх",
        forward_axis="Z вперёд",
        scale="метры, 1.0",
        pivot="у основания",
        max_triangles=50_000,
        max_materials=4,
        max_textures=8,
        notes="FBX с встроенными материалами или отдельные текстуры.",
    ),
    Engine.unreal: EngineContract(
        engine=Engine.unreal,
        title="Unreal",
        formats=[".fbx"],
        up_axis="Z вверх",
        forward_axis="X вперёд",
        scale="сантиметры, 100×",
        pivot="у основания",
        max_triangles=100_000,
        max_materials=4,
        max_textures=8,
        notes="FBX, сантиметры. Проверь масштаб и ориентацию до импорта.",
    ),
    Engine.rpgmaker: EngineContract(
        engine=Engine.rpgmaker,
        title="RPG Maker",
        formats=[".png", ".wav", ".ogg"],
        up_axis="2D",
        forward_axis="2D",
        scale="пиксели",
        pivot="по сетке тайлов",
        max_triangles=None,
        max_materials=None,
        max_textures=None,
        notes="Спрайты и звук; сетка и размеры важнее 3D-метрик.",
    ),
    Engine.web: EngineContract(
        engine=Engine.web,
        title="Web",
        formats=[".glb", ".gltf", ".png", ".webp", ".mp3", ".ogg"],
        up_axis="Y вверх",
        forward_axis="−Z вперёд",
        scale="метры, 1.0",
        pivot="по центру",
        max_triangles=50_000,
        max_materials=4,
        max_textures=8,
        notes="GLB/glTF и сжатые текстуры; следи за размером загрузки.",
    ),
}


def contract_for(engine: Engine) -> EngineContract:
    return CONTRACTS.get(engine, CONTRACTS[Engine.generic]).model_copy(deep=True)


def contract_checks(asset: AssetPassport) -> list[CheckResult]:
    contract = contract_for(asset.engine)
    checks: list[CheckResult] = []

    def warn(name: str, message: str, details: dict[str, object] | None = None) -> None:
        checks.append(
            CheckResult(
                name=f"Контракт: {name}",
                status=CheckStatus.warning,
                message=message,
                details=details or {},
                asset_id=asset.id,
                engine=asset.engine,
            )
        )

    suffix = Path(asset.path).suffix.lower()
    if asset.type.value == "model" and suffix and suffix not in contract.formats:
        warn(
            "формат",
            f"{suffix} не входит в форматы {contract.title}: {', '.join(contract.formats)}",
            {"format": suffix, "allowed": contract.formats},
        )

    metrics = asset.metrics
    budgets = [
        ("треугольники", metrics.triangles, contract.max_triangles),
        ("материалы", metrics.materials, contract.max_materials),
        ("текстуры", metrics.textures, contract.max_textures),
    ]
    for label, value, limit in budgets:
        if value is None or limit is None or limit <= 0:
            continue
        if value > limit:
            warn(label, f"{value} больше бюджета {contract.title} ({limit})", {"value": value, "limit": limit})

    missing = [socket for socket in contract.required_sockets if socket not in asset.sockets]
    if missing:
        warn("сокеты", f"Не хватает сокетов: {', '.join(missing)}", {"missing": missing})

    return checks
