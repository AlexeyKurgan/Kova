import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from ...integrations.roblox.bridge import BRIDGE, COMMANDS, PROTOCOL_VERSION
from ...integrations.roblox.place import build_uncharted_place

router = APIRouter(prefix="/roblox", tags=["roblox"])


class ExecuteRequest(BaseModel):
    command: dict[str, Any] = Field(default_factory=dict)


class ResultRequest(BaseModel):
    id: str = ""
    ok: bool = False
    result: str = ""
    error: str = ""
    plugin_version: str = ""
    protocol: int = 0


class EventRequest(BaseModel):
    kind: str = "event"
    ok: bool = False
    result: str = ""
    plugin_version: str = ""


class LaunchRequest(BaseModel):
    place_path: str | None = None


class BuildPlaceRequest(BaseModel):
    project_path: str
    asset_id: str | None = None
    launch: bool = False


def _find_asset_id(project: Path) -> str:
    for meta in sorted((project / "assets").rglob("*.json")):
        try:
            data = json.loads(meta.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        roblox = data.get("roblox") if isinstance(data, dict) else None
        if isinstance(roblox, dict):
            asset_id = str(roblox.get("asset_id") or "").strip()
            if asset_id.isdigit():
                return asset_id
    return ""


@router.get("/status")
def status() -> dict[str, Any]:
    return BRIDGE.status()


@router.get("/capabilities")
def capabilities() -> dict[str, Any]:
    return {
        "protocol": PROTOCOL_VERSION,
        "commands": sorted(COMMANDS),
        **BRIDGE.studio_status(),
    }


@router.post("/install-plugin")
def install_plugin() -> dict[str, Any]:
    return BRIDGE.install_plugin()


@router.post("/launch")
def launch(payload: LaunchRequest) -> dict[str, Any]:
    try:
        return BRIDGE.launch_studio(payload.place_path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/build-place")
def build_place(payload: BuildPlaceRequest) -> dict[str, Any]:
    project = Path(payload.project_path).expanduser().resolve()
    if not project.is_dir():
        raise HTTPException(status_code=400, detail="project folder not found")
    asset_id = (payload.asset_id or "").strip() or _find_asset_id(project)
    if asset_id and not asset_id.isdigit():
        raise HTTPException(status_code=400, detail="asset_id must be numeric")
    try:
        output = build_uncharted_place(project, asset_id or None)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    result: dict[str, Any] = {
        "ok": True,
        "path": str(output),
        "asset_id": asset_id,
        "bytes": output.stat().st_size,
    }
    if payload.launch:
        try:
            result["launch"] = BRIDGE.launch_studio(str(output))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except OSError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
    return result


@router.post("/execute")
def execute(payload: ExecuteRequest) -> dict[str, Any]:
    try:
        return BRIDGE.enqueue(payload.command)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/commands")
def commands(x_kova_roblox_token: str = Header(default="")) -> dict[str, Any]:
    try:
        return BRIDGE.next_command(x_kova_roblox_token)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.post("/results")
def results(
    payload: ResultRequest,
    x_kova_roblox_token: str = Header(default=""),
) -> dict[str, Any]:
    try:
        return BRIDGE.complete(x_kova_roblox_token, payload.model_dump())
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.post("/event")
def event(
    payload: EventRequest,
    x_kova_roblox_token: str = Header(default=""),
) -> dict[str, Any]:
    try:
        return BRIDGE.record_event(x_kova_roblox_token, payload.model_dump())
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.get("/result/{command_id}")
def result(command_id: str) -> dict[str, Any]:
    row = BRIDGE.result(command_id)
    if row is None:
        raise HTTPException(status_code=404, detail="result not ready")
    return row
