from enum import StrEnum


class TaskStatus(StrEnum):
    draft = "draft"
    ready = "ready"
    working = "working"
    checking = "checking"
    review = "review"
    done = "done"
    blocked = "blocked"
    archived = "archived"


class TaskType(StrEnum):
    model = "model"
    animation = "animation"
    effect = "effect"
    texture = "texture"
    code = "code"
    level = "level"
    export = "export"


class AgentMode(StrEnum):
    clipboard = "clipboard"
    cli = "cli"
    api = "api"
    local = "local"
    mcp = "mcp"


class Engine(StrEnum):
    generic = "generic"
    blender = "blender"
    roblox = "roblox"
    godot = "godot"
    unity = "unity"
    unreal = "unreal"
    rpgmaker = "rpgmaker"
    web = "web"


class AssetType(StrEnum):
    model = "model"
    animation = "animation"
    effect = "effect"
    texture = "texture"
    audio = "audio"
    code = "code"
    scene = "scene"
    other = "other"


class AssetVersionStatus(StrEnum):
    draft = "draft"
    review = "review"
    accepted = "accepted"
    archived = "archived"


class CheckStatus(StrEnum):
    pending = "pending"
    passed = "passed"
    failed = "failed"
    warning = "warning"
    skipped = "skipped"
    error = "error"


class SnapshotScope(StrEnum):
    project = "project"
    task = "task"
    asset = "asset"


class PackageType(StrEnum):
    engine = "engine"
    tool_adapter = "tool_adapter"
    ai_provider = "ai_provider"
    check = "check"
    task_template = "task_template"
    importer_exporter = "importer_exporter"
    ui_extension = "ui_extension"
    mcp_bridge = "mcp_bridge"
    style = "style"
    asset_pack = "asset_pack"


class Permission(StrEnum):
    project_read = "project.read"
    project_write = "project.write"
    blender_run = "blender.run"
    engine_run = "engine.run"
    cli_run = "cli.run"
    network = "network"
    clipboard = "clipboard"
    notifications = "notifications"
    secrets = "secrets"
    background = "background"
    ui = "ui"


class ProviderKind(StrEnum):
    clipboard = "clipboard"
    cli = "cli"
    api = "api"
    local = "local"
    mcp = "mcp"


class TrustLevel(StrEnum):
    official = "official"
    verified = "verified"
    community = "community"
    local = "local"


class ReviewStatus(StrEnum):
    pending = "pending"
    accepted = "accepted"
    rework = "rework"
    archived = "archived"
