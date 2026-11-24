import time
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from ...domain.ledger import LedgerEvent
from ...integrations.blender.addon_install import addon_state, install_addon
from ...integrations.blender.bridge import (
    blender_running,
    blender_status,
    launch_blender,
)
from ...integrations.blender.client import BridgeClient, BridgeError, connection_state
from ...integrations.blender.qa import run_qa as run_model_qa
from ...integrations.blender.skills import get_skill, list_skills
from ...integrations.blender.workspace import (
    WORKSPACE,
    create_model,
    ensure_workspace,
    render_model,
    run_model,
    workspace_info,
)
from ...security.paths import resolve_inside
from ...storage.ledger import append_event
from ...storage.projects import load_project, read_active_hub
from ..deps import require_hub

router = APIRouter(prefix="/blender", tags=["blender"])


class BlenderScene(BaseModel):
    name: str = ""
    object_count: int = 0
    file: str = ""


class BlenderStatus(BaseModel):
    installed: bool
    path: str
    version: str
    addon_installed: bool = False
    addon_version: str = ""
    addon_path: str = ""
    connected: bool = False
    host: str = ""
    port: int | None = None
    scene: BlenderScene | None = None
    workspace: str = ""
    message: str = ""


class BlenderSkill(BaseModel):
    name: str
    description: str = ""
    path: str
    group: str = "other"
    group_label: str = "Дополнительно"
    scripts: list[str] = Field(default_factory=list)
    files: list[str] = Field(default_factory=list)


class BlenderSkillDetail(BlenderSkill):
    content: str = ""


class BlenderWorkspace(BaseModel):
    exists: bool
    root: str
    path: str
    models: list[str] = Field(default_factory=list)
    scripts: list[dict[str, object]] = Field(default_factory=list)
    checks: list[str] = Field(default_factory=list)


class CreateModelRequest(BaseModel):
    name: str


class ModelRequest(BaseModel):
    model: str


class RenderRequest(BaseModel):
    model: str
    view: str = "iso"


class BuildRequest(BaseModel):
    model: str
    view: str = "iso"
    run_qa: bool = True
    render: bool = True


class RunModelResponse(BaseModel):
    model: str
    output: str
    log: str
    script: str


class QaResponse(BaseModel):
    model: str
    ok: bool
    totals: dict[str, int]
    issues: list[dict[str, object]]
    report: str


class BuildResponse(RunModelResponse):
    qa: QaResponse | None = None
    render: str | None = None
    preview: str | None = None


class RenderModelResponse(BaseModel):
    model: str
    view: str
    render: str
    output: str
    preview: str


def _status(hub: Path | None = None) -> BlenderStatus:
    base = blender_status()
    addon = addon_state()
    link = connection_state(timeout=1.5)
    scene: BlenderScene | None = None

    if link["connected"]:
        try:
            client = BridgeClient.from_discovery(timeout=2.5)
            data = client.scene() if client else {}
            scene = BlenderScene(
                name=str(data.get("name") or ""),
                object_count=int(data.get("object_count") or 0),
                file=str(data.get("file") or ""),
            )
        except BridgeError:
            link["connected"] = False

    return BlenderStatus(
        installed=bool(base["installed"]),
        path=str(base["path"]),
        version=str(base["version"]),
        addon_installed=bool(addon["installed"]),
        addon_version=str(addon["version"]),
        addon_path=str(addon["path"]),
        connected=bool(link["connected"]),
        host=str(link["host"]),
        port=link["port"],
        scene=scene,
        workspace=WORKSPACE if hub is not None else "",
        message=str(link["message"]),
    )


def _publish_render(hub: Path, model: str, view: str, render_path: str) -> str:
    source = resolve_inside(hub.parent, Path(WORKSPACE) / render_path)
    preview = resolve_inside(
        hub,
        Path("artifacts") / "previews" / f"{model}_{view}.png",
    )
    preview.parent.mkdir(parents=True, exist_ok=True)
    preview.write_bytes(source.read_bytes())
    return preview.relative_to(hub).as_posix()


def _require_connected() -> BridgeClient:
    client = BridgeClient.from_discovery(timeout=30)
    if client is None:
        raise HTTPException(status_code=409, detail="Blender не подключён")
    try:
        client.ping()
    except BridgeError as exc:
        raise HTTPException(status_code=409, detail=f"Blender не отвечает: {exc}") from exc
    return client


@router.get("/status", response_model=BlenderStatus)
def get_blender_status() -> BlenderStatus:
    return _status(read_active_hub())


@router.post("/setup", response_model=BlenderStatus)
def setup_blender() -> BlenderStatus:
    if not blender_status()["installed"]:
        raise HTTPException(status_code=503, detail="Blender не найден на компьютере")
    try:
        install_addon()
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return _status(read_active_hub())


def _connected(hub: Path | None, state: BlenderStatus) -> BlenderStatus:
    if hub is not None:
        project = load_project(hub)
        ensure_workspace(hub.parent, project.engine.value)
        append_event(
            hub,
            LedgerEvent(
                type="blender.connected",
                subject="blender",
                data={"port": state.port, "scene": state.scene.name if state.scene else ""},
            ),
        )
    return state


@router.post("/connect", response_model=BlenderStatus)
def connect_blender() -> BlenderStatus:
    hub = read_active_hub()
    current = _status(hub)
    if current.connected:
        return _connected(hub, current)

    if not current.installed:
        raise HTTPException(status_code=503, detail="Blender не найден на компьютере")

    try:
        install_addon()
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    if blender_running():
        for _ in range(3):
            time.sleep(1)
            state = _status(hub)
            if state.connected:
                return _connected(hub, state)

    try:
        launch_blender()
    except (OSError, FileNotFoundError) as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    for _ in range(60):
        time.sleep(1)
        state = _status(hub)
        if state.connected:
            return _connected(hub, state)

    raise HTTPException(
        status_code=504,
        detail="Blender запустился, но аддон не вышел на связь. Открой Blender → 3D Viewport → N → Kova → Start.",
    )


@router.get("/scene", response_model=BlenderScene)
def get_scene() -> BlenderScene:
    client = _require_connected()
    try:
        data = client.scene()
    except BridgeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return BlenderScene(
        name=str(data.get("name") or ""),
        object_count=int(data.get("object_count") or 0),
        file=str(data.get("file") or ""),
    )


@router.post("/screenshot")
def capture_screenshot(hub: Path = Depends(require_hub)) -> dict[str, str]:
    client = _require_connected()
    target = resolve_inside(hub, Path("artifacts") / "previews" / "viewport.png")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.unlink(missing_ok=True)
    try:
        client.screenshot(str(target), 1600)
    except BridgeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if not target.is_file():
        raise HTTPException(status_code=503, detail="Blender не сохранил снимок")
    append_event(hub, LedgerEvent(type="blender.screenshot", subject="blender"))
    return {"path": target.relative_to(hub).as_posix()}


@router.get("/screenshot")
def get_screenshot(hub: Path = Depends(require_hub)) -> FileResponse:
    path = resolve_inside(hub, Path("artifacts") / "previews" / "viewport.png")
    if not path.is_file():
        raise HTTPException(status_code=404, detail="снимок не найден")
    return FileResponse(
        path,
        media_type="image/png",
        headers={"Cache-Control": "no-store"},
    )


@router.get("/workspace", response_model=BlenderWorkspace)
def get_workspace(hub: Path = Depends(require_hub)) -> BlenderWorkspace:
    return BlenderWorkspace(**workspace_info(hub.parent))


@router.post("/workspace", response_model=BlenderWorkspace)
def make_workspace(hub: Path = Depends(require_hub)) -> BlenderWorkspace:
    project = load_project(hub)
    ensure_workspace(hub.parent, project.engine.value)
    append_event(
        hub,
        LedgerEvent(type="blender.workspace", subject="blender", data={"path": WORKSPACE}),
    )
    return BlenderWorkspace(**workspace_info(hub.parent))


@router.get("/skills", response_model=list[BlenderSkill])
def get_skills() -> list[BlenderSkill]:
    return [BlenderSkill(**item) for item in list_skills()]


@router.get("/skills/{name}", response_model=BlenderSkillDetail)
def get_skill_detail(name: str) -> BlenderSkillDetail:
    skill = get_skill(name)
    if skill is None:
        raise HTTPException(status_code=404, detail="skill not found")
    return BlenderSkillDetail(**skill)


@router.post("/models", response_model=dict[str, str], status_code=201)
def create_model_route(
    payload: CreateModelRequest,
    hub: Path = Depends(require_hub),
) -> dict[str, str]:
    project = load_project(hub)
    try:
        created = create_model(hub.parent, payload.name, project.engine.value)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    append_event(
        hub,
        LedgerEvent(
            type="blender.model",
            subject="blender",
            data={"name": created["name"], "script": created["script"]},
        ),
    )
    return {"name": str(created["name"]), "script": str(created["script"])}


@router.post("/run", response_model=RunModelResponse)
def run_model_route(
    payload: ModelRequest,
    hub: Path = Depends(require_hub),
) -> RunModelResponse:
    try:
        result = run_model(hub.parent, payload.model)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except BridgeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    append_event(
        hub,
        LedgerEvent(type="blender.run", subject=payload.model, data={"log": result["log"]}),
    )
    return RunModelResponse(**result)


@router.post("/render", response_model=RenderModelResponse)
def render_model_route(
    payload: RenderRequest,
    hub: Path = Depends(require_hub),
) -> RenderModelResponse:
    try:
        result = render_model(hub.parent, payload.model, payload.view)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except BridgeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    preview = _publish_render(hub, payload.model, payload.view, str(result["render"]))
    append_event(
        hub,
        LedgerEvent(
            type="blender.render",
            subject=payload.model,
            data={"view": payload.view, "preview": preview},
        ),
    )
    return RenderModelResponse(**result, preview=preview)


@router.post("/qa", response_model=QaResponse)
def run_qa_route(
    payload: ModelRequest,
    hub: Path = Depends(require_hub),
) -> QaResponse:
    try:
        report = run_model_qa(hub.parent, payload.model)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except BridgeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    append_event(
        hub,
        LedgerEvent(
            type="blender.qa",
            subject=payload.model,
            data={"ok": bool(report.get("ok")), "issues": len(report.get("issues") or [])},
        ),
    )
    return QaResponse(
        model=payload.model,
        ok=bool(report.get("ok")),
        totals=report.get("totals") or {},
        issues=report.get("issues") or [],
        report=f"Checks/{payload.model}_qa.md",
    )


@router.post("/build", response_model=BuildResponse)
def build_model_route(
    payload: BuildRequest,
    hub: Path = Depends(require_hub),
) -> BuildResponse:
    try:
        run = run_model(hub.parent, payload.model)
        qa = None
        if payload.run_qa:
            report = run_model_qa(hub.parent, payload.model)
            qa = QaResponse(
                model=payload.model,
                ok=bool(report.get("ok")),
                totals=report.get("totals") or {},
                issues=report.get("issues") or [],
                report=f"Checks/{payload.model}_qa.md",
            )
        render = None
        preview = None
        if payload.render:
            result = render_model(hub.parent, payload.model, payload.view)
            preview = _publish_render(hub, payload.model, payload.view, str(result["render"]))
            render = str(result["render"])
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except BridgeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    append_event(
        hub,
        LedgerEvent(
            type="blender.build",
            subject=payload.model,
            data={"qa": qa.ok if qa else None, "render": bool(render)},
        ),
    )
    return BuildResponse(**run, qa=qa, render=render, preview=preview)


@router.get("/checks")
def get_check_file(path: str = Query(...), hub: Path = Depends(require_hub)) -> FileResponse:
    relative = Path(path)
    if relative.is_absolute() or ".." in relative.parts:
        raise HTTPException(status_code=404, detail="file not found")
    try:
        workspace = resolve_inside(hub.parent, Path(WORKSPACE))
        target = resolve_inside(workspace, relative)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="file not found") from exc
    if not target.is_file():
        raise HTTPException(status_code=404, detail="file not found")
    media = "image/png" if target.suffix.lower() == ".png" else "text/plain; charset=utf-8"
    return FileResponse(target, media_type=media, headers={"Cache-Control": "no-store"})
