import json
import os
import re
from pathlib import Path
from typing import Any

_CACHE: dict[str, Any] = {"mtime": 0.0, "data": {}}


def _catalog_path() -> Path:
    return Path.home() / ".cache" / "opencode" / "models.json"


def _load_catalog() -> dict[str, Any]:
    path = _catalog_path()
    try:
        mtime = path.stat().st_mtime
    except OSError:
        return {}
    if _CACHE["mtime"] == mtime and isinstance(_CACHE["data"], dict):
        return _CACHE["data"]
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        data = {}
    if not isinstance(data, dict):
        data = {}
    _CACHE["mtime"] = mtime
    _CACHE["data"] = data
    return data


def _pretty(value: str) -> str:
    text = re.sub(r"[_-]+", " ", value).strip()
    text = re.sub(r"\s+", " ", text)
    return " ".join(
        part.upper() if len(part) <= 2 and part.isalpha() else part[:1].upper() + part[1:]
        for part in text.split(" ")
    )


def _group_label(prefix: str, catalog: dict[str, Any], provider_name: str) -> str:
    if prefix == "opencode-go":
        return "OpenCode Go"
    if prefix == "opencode":
        return "OpenCode"
    entry = catalog.get(prefix)
    if isinstance(entry, dict) and str(entry.get("name") or "").strip():
        return str(entry["name"]).strip()
    if not prefix:
        return provider_name
    return _pretty(prefix)


def _split_model(model: str) -> tuple[str, str]:
    if "/" in model:
        prefix, rest = model.split("/", 1)
        return prefix, rest
    return "", model


def _efforts(meta: dict[str, Any]) -> list[str]:
    values: list[str] = []
    options = meta.get("reasoning_options")
    if isinstance(options, list):
        for option in options:
            if not isinstance(option, dict) or option.get("type") != "effort":
                continue
            for value in option.get("values") or []:
                text = str(value).strip()
                if text and text not in values:
                    values.append(text)
    return values


def _modalities(meta: dict[str, Any]) -> list[str]:
    modalities = meta.get("modalities")
    if isinstance(modalities, dict):
        values = modalities.get("input")
        if isinstance(values, list):
            return [str(item) for item in values]
    return []


def _find_meta(
    catalog: dict[str, Any],
    provider_id: str,
    prefix: str,
    key: str,
) -> tuple[dict[str, Any], str]:
    candidates = [prefix]
    if provider_id == "codex":
        candidates.append("openai")
    elif provider_id == "claude":
        candidates.append("anthropic")
    elif provider_id == "gemini":
        candidates.append("google")
    for name in candidates:
        entry = catalog.get(name)
        if not isinstance(entry, dict):
            continue
        models = entry.get("models")
        if not isinstance(models, dict):
            continue
        for model_key in (key, f"{name}/{key}", f"{prefix}/{key}" if prefix else key):
            meta = models.get(model_key)
            if isinstance(meta, dict):
                return meta, name
    return {}, prefix


def catalog_for_provider(provider: dict[str, Any]) -> list[dict[str, Any]]:
    models = [str(item) for item in provider.get("models") or [] if str(item).strip()]
    if not models:
        return []
    catalog = _load_catalog()
    groups: dict[str, dict[str, Any]] = {}
    for model in models:
        prefix, key = _split_model(model)
        meta, meta_provider = _find_meta(catalog, str(provider.get("id") or ""), prefix, key)
        group_id = prefix or meta_provider or str(provider.get("id") or "other")
        group = groups.get(group_id)
        if group is None:
            group = {
                "id": group_id,
                "label": _group_label(group_id, catalog, str(provider.get("name") or group_id)),
                "models": [],
            }
            groups[group_id] = group
        name = str(meta.get("name") or "").strip()
        if not name:
            name = _pretty(key)
        free = "free" in model.lower() or "free" in name.lower()
        group["models"].append(
            {
                "id": model,
                "name": name,
                "free": free,
                "efforts": _efforts(meta),
                "modalities": _modalities(meta),
                "attachment": bool(meta.get("attachment")),
            }
        )
    for group in groups.values():
        group["count"] = len(group["models"])
    return list(groups.values())


def effort_values(provider: dict[str, Any], model: str) -> list[str]:
    prefix, key = _split_model(model)
    meta, _ = _find_meta(_load_catalog(), str(provider.get("id") or ""), prefix, key)
    return _efforts(meta)


def apply_effort(provider: dict[str, Any], model: str, effort: str) -> str:
    value = (effort or "").strip()
    if not value or value == "auto":
        return model
    if str(provider.get("id") or "") != "opencode":
        return model
    if value not in effort_values(provider, model):
        return model
    return f"{model}#{value}"
