"""Request-scoped language for API responses.

The frontend sends ``X-Kova-Language: en|ru`` with every JSON request. Core
keeps the canonical (usually Russian) values in storage and adds localized
display fields or localized package metadata at the API boundary.
"""
from __future__ import annotations

from contextvars import ContextVar, Token

_SUPPORTED = {"ru", "en"}
_language: ContextVar[str] = ContextVar("kova_language", default="ru")


def normalize_language(value: str | None) -> str:
    raw = (value or "").strip().lower()
    if raw.startswith("en"):
        return "en"
    if raw.startswith("ru"):
        return "ru"
    return "ru"


def set_language(value: str | None) -> Token[str]:
    return _language.set(normalize_language(value))


def reset_language(token: Token[str]) -> None:
    _language.reset(token)


def get_language() -> str:
    return _language.get()


def tr(ru: str, en: str) -> str:
    return en if get_language() == "en" and en else ru


def tl(ru: str, en: str) -> str:
    """Alias used by data models: localized value with fallback."""
    return en if get_language() == "en" and en else ru
