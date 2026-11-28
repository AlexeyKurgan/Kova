from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..deps import require_hub
from ...team import (
    TeamError,
    apply_bundle,
    check_incoming,
    connect_space,
    history,
    leave_space,
    preview_bundle,
    publish,
    rollback_last,
    set_member,
    space_info,
)

router = APIRouter(prefix="/team", tags=["team"])


class ConnectRequest(BaseModel):
    kind: Literal["folder", "git"]
    location: str = Field(min_length=1, max_length=2000)
    name: str = Field(default="", max_length=80)
    branch: str = Field(default="kova-team", max_length=120)
    token: str | None = Field(default=None, max_length=4000)
    member: str | None = Field(default=None, max_length=60)


class PublishRequest(BaseModel):
    message: str = Field(default="", max_length=200)


class ApplyRequest(BaseModel):
    resolutions: dict[str, str] = Field(default_factory=dict)
    force: bool = False


class MemberRequest(BaseModel):
    member: str = Field(min_length=1, max_length=60)


def _detail(exc: TeamError) -> HTTPException:
    return HTTPException(status_code=400, detail=str(exc))


@router.get("")
def get_team(hub: Path = Depends(require_hub)) -> dict[str, Any]:
    try:
        return space_info(hub.parent)
    except TeamError as exc:
        raise _detail(exc) from exc


@router.post("/connect")
def connect_route(
    payload: ConnectRequest,
    hub: Path = Depends(require_hub),
) -> dict[str, Any]:
    try:
        return connect_space(
            hub.parent,
            payload.kind,
            payload.location,
            name=payload.name,
            branch=payload.branch,
            token=payload.token,
            member=payload.member,
        )
    except TeamError as exc:
        raise _detail(exc) from exc


@router.post("/leave")
def leave_route(hub: Path = Depends(require_hub)) -> dict[str, Any]:
    try:
        return leave_space(hub.parent)
    except TeamError as exc:
        raise _detail(exc) from exc


@router.post("/identity")
def identity_route(
    payload: MemberRequest,
    hub: Path = Depends(require_hub),
) -> dict[str, Any]:
    try:
        identity = set_member(payload.member)
        return {"identity": identity, "space": space_info(hub.parent)}
    except TeamError as exc:
        raise _detail(exc) from exc


@router.post("/publish")
def publish_route(
    payload: PublishRequest,
    hub: Path = Depends(require_hub),
) -> dict[str, Any]:
    try:
        return publish(hub.parent, payload.message)
    except TeamError as exc:
        raise _detail(exc) from exc


@router.get("/incoming")
def incoming_route(hub: Path = Depends(require_hub)) -> dict[str, Any]:
    try:
        return check_incoming(hub.parent)
    except TeamError as exc:
        raise _detail(exc) from exc


@router.get("/incoming/{bundle_id}")
def preview_route(
    bundle_id: str,
    hub: Path = Depends(require_hub),
) -> dict[str, Any]:
    try:
        return preview_bundle(hub.parent, bundle_id)
    except TeamError as exc:
        raise _detail(exc) from exc


@router.post("/incoming/{bundle_id}/apply")
def apply_route(
    bundle_id: str,
    payload: ApplyRequest,
    hub: Path = Depends(require_hub),
) -> dict[str, Any]:
    if any(value not in {"local", "remote"} for value in payload.resolutions.values()):
        raise HTTPException(
            status_code=400,
            detail="resolution must be 'local' or 'remote'",
        )
    try:
        return apply_bundle(hub.parent, bundle_id, payload.resolutions, payload.force)
    except TeamError as exc:
        raise _detail(exc) from exc


@router.post("/rollback")
def rollback_route(hub: Path = Depends(require_hub)) -> dict[str, Any]:
    try:
        return rollback_last(hub.parent)
    except TeamError as exc:
        raise _detail(exc) from exc


@router.get("/history")
def history_route(hub: Path = Depends(require_hub)) -> dict[str, Any]:
    try:
        return history(hub.parent)
    except TeamError as exc:
        raise _detail(exc) from exc
