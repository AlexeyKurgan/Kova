import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ...agents.providers import (
    PRESETS,
    delete_provider,
    get_provider,
    list_providers,
    update_provider,
)

router = APIRouter(prefix="/providers", tags=["providers"])


class ProviderInfo(BaseModel):
    id: str
    name: str
    kind: str = "cli"
    command: str = ""
    args: list[str] = Field(default_factory=list)
    enabled: bool = True
    installed: bool = False
    path: str = ""
    version: str = ""
    builtin: bool = False
    description: str = ""
    url: str = ""
    timeout: int = 1800
    models: list[str] = Field(default_factory=list)
    default: bool = False


class ProvidersResponse(BaseModel):
    providers: list[ProviderInfo]
    default_provider: str


class UpdateProviderRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    command: str | None = None
    args: list[str] | None = None
    enabled: bool | None = None
    timeout: int | None = None
    models: list[str] | None = None
    set_default: bool = False


class CreateProviderRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    command: str = Field(min_length=1, max_length=500)
    args: list[str] = Field(default_factory=list)
    description: str = ""
    timeout: int = 1800
    models: list[str] = Field(default_factory=list)
    set_default: bool = False


def _slug(name: str) -> str:
    value = re.sub(r"[^a-z0-9_-]+", "-", name.strip().lower()).strip("-_")
    return value or "custom"


@router.get("", response_model=ProvidersResponse)
def get_providers() -> ProvidersResponse:
    rows, default = list_providers()
    return ProvidersResponse(
        providers=[ProviderInfo(**row) for row in rows],
        default_provider=default,
    )


@router.patch("/{provider_id}", response_model=ProviderInfo)
def update_provider_route(provider_id: str, payload: UpdateProviderRequest) -> ProviderInfo:
    if get_provider(provider_id) is None:
        raise HTTPException(status_code=404, detail="provider not found")
    row = update_provider(provider_id, payload.model_dump(exclude_unset=True))
    if row is None:
        raise HTTPException(status_code=400, detail="provider not updated")
    return ProviderInfo(**row)


@router.post("", response_model=ProviderInfo, status_code=201)
def create_provider_route(payload: CreateProviderRequest) -> ProviderInfo:
    provider_id = _slug(payload.name)
    if provider_id in PRESETS or get_provider(provider_id) is not None:
        raise HTTPException(status_code=409, detail="провайдер с таким именем уже есть")
    row = update_provider(
        provider_id,
        {
            "name": payload.name,
            "command": payload.command,
            "args": payload.args,
            "description": payload.description,
            "timeout": payload.timeout,
            "models": payload.models,
            "set_default": payload.set_default,
        },
    )
    if row is None:
        raise HTTPException(status_code=400, detail="provider not created")
    return ProviderInfo(**row)


@router.delete("/{provider_id}", status_code=204)
def delete_provider_route(provider_id: str) -> None:
    if get_provider(provider_id) is None:
        raise HTTPException(status_code=404, detail="provider not found")
    if not delete_provider(provider_id):
        raise HTTPException(status_code=400, detail="встроенный пресет нельзя удалить")


@router.post("/{provider_id}/check", response_model=ProviderInfo)
def check_provider(provider_id: str) -> ProviderInfo:
    row = get_provider(provider_id)
    if row is None:
        raise HTTPException(status_code=404, detail="provider not found")
    return ProviderInfo(**row)
