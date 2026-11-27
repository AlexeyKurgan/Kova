import json
import os
import ssl
import urllib.error
import urllib.request
from datetime import datetime

from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/updates", tags=["updates"])


class UpdateInfo(BaseModel):
    current: str
    latest: str = ""
    update_available: bool = False
    url: str = ""
    notes: str = ""
    published_at: str = ""
    checked_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat() + "Z")
    error: str = ""


def _version(value: str) -> tuple[int, ...]:
    raw = value.strip().lstrip("vV")
    parts = []
    for chunk in raw.split(".")[:4]:
        digits = "".join(char for char in chunk if char.isdigit())
        parts.append(int(digits or 0))
    return tuple(parts or [0])


@router.get("/check", response_model=UpdateInfo)
def check_updates() -> UpdateInfo:
    current = os.environ.get("KOVA_VERSION", "0.0.0")
    repo = os.environ.get("KOVA_UPDATE_REPO", "AlexeyKurgan/Kova")
    url = f"https://api.github.com/repos/{repo}/releases/latest"
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "Kova-Hub-Updater",
        },
    )
    try:
        try:
            import certifi
            context = ssl.create_default_context(cafile=certifi.where())
        except (ImportError, OSError):
            context = ssl.create_default_context()
        with urllib.request.urlopen(request, timeout=8, context=context) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return UpdateInfo(current=current, error="Релизов пока нет — канал обновлений пуст")
        return UpdateInfo(current=current, error=f"GitHub вернул HTTP {exc.code}")
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        return UpdateInfo(current=current, error=f"Нет связи с GitHub: {exc}")
    except ValueError:
        return UpdateInfo(current=current, error="Некорректный ответ GitHub")

    latest = str(payload.get("tag_name") or "").strip()
    available = bool(latest) and _version(latest) > _version(current)
    return UpdateInfo(
        current=current,
        latest=latest,
        update_available=available,
        url=str(payload.get("html_url") or ""),
        notes=str(payload.get("body") or "")[:2000],
        published_at=str(payload.get("published_at") or ""),
    )
