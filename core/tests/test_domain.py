import pytest
from pydantic import ValidationError

from kova_core.domain import (
    AssetMetrics,
    AssetPassport,
    AssetType,
    AssetVersion,
    AssetVersionStatus,
    Capsule,
    CheckResult,
    CheckStatus,
    Criterion,
    Engine,
    ExportProfile,
    KovaPackage,
    PackageType,
    Permission,
    Project,
    Provider,
    ProviderKind,
    ReviewItem,
    ReviewStatus,
    Snapshot,
    SnapshotFile,
    SnapshotScope,
    Task,
    TaskStatus,
    TaskType,
    TrustLevel,
)
from kova_core.storage.hub import create_hub


def test_task_roundtrip() -> None:
    task = Task(title="Сундук", engine=Engine.roblox, type=TaskType.model)
    task.criteria.append(Criterion(text="≤ 800 треугольников"))
    task.tags.append("chest")

    restored = Task.model_validate_json(task.model_dump_json())

    assert restored.id == task.id
    assert restored.status is TaskStatus.draft
    assert restored.engine is Engine.roblox
    assert restored.criteria[0].text == "≤ 800 треугольников"
    assert restored.tags == ["chest"]


def test_task_rejects_unknown_status() -> None:
    with pytest.raises(ValidationError):
        Task(title="x", status="unknown")


def test_task_rejects_unknown_field() -> None:
    with pytest.raises(ValidationError):
        Task(title="x", surprise=True)


def test_capsule_roundtrip() -> None:
    capsule = Capsule(
        task_id="task_1",
        engine=Engine.roblox,
        done=["базовая форма"],
        problems=["1600 треугольников", "пивот неверный"],
        files=["chest.blend"],
        next_step=["уменьшить полигоны"],
        forbidden=["менять стиль"],
    )

    restored = Capsule.model_validate_json(capsule.model_dump_json())

    assert restored.task_id == "task_1"
    assert restored.problems == ["1600 треугольников", "пивот неверный"]
    assert restored.forbidden == ["менять стиль"]


def test_asset_passport_roundtrip() -> None:
    passport = AssetPassport(
        name="Chest",
        type=AssetType.model,
        engine=Engine.roblox,
        license="CC0",
        metrics=AssetMetrics(triangles=780, materials=2),
        versions=[
            AssetVersion(label="v1", status=AssetVersionStatus.accepted),
        ],
        export_profiles=[
            ExportProfile(engine=Engine.roblox, format="rbxmx"),
        ],
    )

    restored = AssetPassport.model_validate_json(passport.model_dump_json())

    assert restored.metrics.triangles == 780
    assert restored.versions[0].status is AssetVersionStatus.accepted
    assert restored.export_profiles[0].format == "rbxmx"


def test_snapshot_roundtrip() -> None:
    snapshot = Snapshot(
        reason="before pivot fix",
        scope=SnapshotScope.asset,
        files=[SnapshotFile(path="chest.blend", hash="abc", size=1024)],
        restore_point=True,
    )

    restored = Snapshot.model_validate_json(snapshot.model_dump_json())

    assert restored.scope is SnapshotScope.asset
    assert restored.restore_point is True
    assert restored.files[0].size == 1024


def test_check_result_roundtrip() -> None:
    result = CheckResult(
        name="triangle budget",
        status=CheckStatus.failed,
        message="1600 > 800",
        details={"actual": 1600, "budget": 800},
        engine=Engine.roblox,
    )

    restored = CheckResult.model_validate_json(result.model_dump_json())

    assert restored.status is CheckStatus.failed
    assert restored.details["actual"] == 1600


def test_package_and_provider() -> None:
    package = KovaPackage(
        name="Roblox Core",
        type=PackageType.engine,
        permissions=[Permission.project_read, Permission.engine_run],
        trust=TrustLevel.official,
    )
    provider = Provider(
        kind=ProviderKind.cli,
        name="Codex",
        command="codex",
        models=["gpt-5"],
    )

    assert KovaPackage.model_validate_json(package.model_dump_json()).permissions
    assert Provider.model_validate_json(provider.model_dump_json()).kind is ProviderKind.cli


def test_review_and_project() -> None:
    review = ReviewItem(task_id="task_1", status=ReviewStatus.pending)
    project = Project(name="Blade Evolve", engine=Engine.godot)

    assert ReviewItem.model_validate_json(review.model_dump_json()).status is ReviewStatus.pending
    assert Project.model_validate_json(project.model_dump_json()).engine is Engine.godot


def test_hub_writes_project_model(tmp_path) -> None:
    hub = create_hub(tmp_path, "Demo")

    project = Project.model_validate_json((hub / "project.json").read_text(encoding="utf-8"))

    assert project.name == "Demo"
    assert project.schema_version == 1
