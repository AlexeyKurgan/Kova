import re
import subprocess

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ...agents.capabilities import clear_capabilities, get_capabilities, probe_provider
from ...agents.model_catalog import catalog_for_provider
from ...agents.providers import (
    PRESETS,
    catalog as provider_catalog,
    delete_provider,
    discover_models,
    get_provider,
    list_providers,
    update_provider,
)

router = APIRouter(prefix="/providers", tags=["providers"])


class ProviderCapabilities(BaseModel):
    checked: bool = False
    checked_at: str = ""
    source: str = ""
    version: str = ""
    supports_model: bool = False
    supports_resume: bool = False
    supports_json: bool = False
    supports_permissions: bool = False
    supports_non_interactive: bool = False
    flags: list[str] = Field(default_factory=list)
    note: str = ""


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
    default_model: str = ""
    default_effort: str = "auto"
    models_args: list[str] = Field(default_factory=list)
    read_only_args: list[str] = Field(default_factory=list)
    resume_args: list[str] = Field(default_factory=list)
    session_regex: str = ""
    output_mode: str = "auto"
    api_url: str = ""
    api_model: str = ""
    api_style: str = "openai"
    api_max_tokens: int = 4096
    catalog_id: str = ""
    gcp_project: str = ""
    gcp_region: str = "us-central1"
    aws_region: str = "us-east-1"
    has_key: bool = False
    local_api: bool = False
    capabilities: ProviderCapabilities = Field(default_factory=ProviderCapabilities)
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
    default_model: str | None = None
    default_effort: str | None = None
    models_args: list[str] | None = None
    read_only_args: list[str] | None = None
    resume_args: list[str] | None = None
    session_regex: str | None = None
    output_mode: str | None = None
    kind: str | None = None
    api_url: str | None = None
    api_model: str | None = None
    api_style: str | None = None
    api_max_tokens: int | None = None
    catalog_id: str | None = None
    gcp_project: str | None = None
    gcp_region: str | None = None
    aws_region: str | None = None
    api_key: str | None = None
    delete_key: bool = False
    set_default: bool = False


class CreateProviderRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    command: str = Field(default="", max_length=500)
    args: list[str] = Field(default_factory=list)
    description: str = ""
    timeout: int = 1800
    models: list[str] = Field(default_factory=list)
    default_model: str = ""
    default_effort: str = "auto"
    models_args: list[str] = Field(default_factory=list)
    read_only_args: list[str] = Field(default_factory=list)
    resume_args: list[str] = Field(default_factory=list)
    session_regex: str = ""
    output_mode: str = "auto"
    kind: str = "cli"
    api_url: str = ""
    api_model: str = ""
    api_style: str = "openai"
    api_max_tokens: int = 4096
    catalog_id: str = ""
    gcp_project: str = ""
    gcp_region: str = "us-central1"
    aws_region: str = "us-east-1"
    api_key: str = ""
    set_default: bool = False


def _slug(name: str) -> str:
    value = re.sub(r"[^a-z0-9_-]+", "-", name.strip().lower()).strip("-_")
    return value or "custom"


def _provider_info(row: dict) -> ProviderInfo:
    return ProviderInfo(
        **row,
        capabilities=ProviderCapabilities(**get_capabilities(str(row.get("id") or ""))),
    )


@router.get("", response_model=ProvidersResponse)
def get_providers() -> ProvidersResponse:
    rows, default = list_providers()
    return ProvidersResponse(
        providers=[_provider_info(row) for row in rows],
        default_provider=default,
    )


@router.patch("/{provider_id}", response_model=ProviderInfo)
def update_provider_route(provider_id: str, payload: UpdateProviderRequest) -> ProviderInfo:
    if get_provider(provider_id) is None:
        raise HTTPException(status_code=404, detail="provider not found")
    updates = payload.model_dump(exclude_unset=True)
    if "command" in updates or "args" in updates:
        clear_capabilities(provider_id)
    row = update_provider(provider_id, updates)
    if row is None:
        raise HTTPException(status_code=400, detail="provider not updated")
    return _provider_info(row)


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
            "default_model": payload.default_model,
            "models_args": payload.models_args,
            "read_only_args": payload.read_only_args,
            "resume_args": payload.resume_args,
            "session_regex": payload.session_regex,
            "output_mode": payload.output_mode,
            "kind": payload.kind,
            "api_url": payload.api_url,
            "api_model": payload.api_model,
            "api_style": payload.api_style,
            "api_max_tokens": payload.api_max_tokens,
            "catalog_id": payload.catalog_id,
            "gcp_project": payload.gcp_project,
            "gcp_region": payload.gcp_region,
            "aws_region": payload.aws_region,
            "api_key": payload.api_key,
            "set_default": payload.set_default,
        },
    )
    if row is None:
        raise HTTPException(status_code=400, detail="provider not created")
    if (
        row.get("kind") == "api"
        and payload.api_key
        and row.get("api_style") in {"openai", "anthropic", "google"}
    ):
        try:
            models = discover_models(row)
        except (RuntimeError, OSError, subprocess.SubprocessError):
            models = []
        if models:
            updated = update_provider(
                provider_id,
                {
                    "models": models,
                    "default_model": row.get("default_model") or models[0],
                    "api_model": row.get("api_model") or models[0],
                },
            )
            if updated is not None:
                row = updated
    return _provider_info(row)


@router.get("/catalog")
def provider_catalog_route() -> dict:
    return {"providers": provider_catalog()}


@router.get("/{provider_id}/catalog")
def provider_model_catalog(provider_id: str) -> dict:
    provider = get_provider(provider_id)
    if provider is None:
        raise HTTPException(status_code=404, detail="provider not found")
    return {"groups": catalog_for_provider(provider)}


@router.post("/{provider_id}/models")
def discover_provider_models(provider_id: str) -> dict:
    provider = get_provider(provider_id)
    if provider is None:
        raise HTTPException(status_code=404, detail="provider not found")
    try:
        models = discover_models(provider)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (RuntimeError, OSError, subprocess.SubprocessError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"models": models, "source": provider.get("kind")}


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
    probe_provider(row)
    return _provider_info(row)
