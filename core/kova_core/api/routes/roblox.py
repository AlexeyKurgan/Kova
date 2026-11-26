from typing import Any

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from ...integrations.roblox.bridge import BRIDGE

router = APIRouter(prefix="/roblox", tags=["roblox"])


class ExecuteRequest(BaseModel):
    command: dict[str, Any] = Field(default_factory=dict)


class ResultRequest(BaseModel):
    id: str = ""
    ok: bool = False
    result: str = ""
    error: str = ""
    plugin_version: str = ""


@router.get("/status")
def status() -> dict[str, Any]:
    return BRIDGE.status()


@router.post("/install-plugin")
def install_plugin() -> dict[str, Any]:
    return BRIDGE.install_plugin()


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


@router.get("/result/{command_id}")
def result(command_id: str) -> dict[str, Any]:
    row = BRIDGE.result(command_id)
    if row is None:
        raise HTTPException(status_code=404, detail="result not ready")
    return row
