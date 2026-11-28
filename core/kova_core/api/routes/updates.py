import hashlib
import json
import os
import ssl
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from datetime import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/updates", tags=["updates"])


class ReleaseAsset(BaseModel):
    name: str
    url: str
    size: int = 0


class UpdateInfo(BaseModel):
    current: str
    latest: str = ""
    update_available: bool = False
    url: str = ""
    notes: str = ""
    published_at: str = ""
    assets: list[ReleaseAsset] = Field(default_factory=list)
    checked_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat() + "Z")
    error: str = ""


class DownloadRequest(BaseModel):
    url: str
    expected_sha256: str = ""


def _version(value: str) -> tuple[int, ...]:
    raw = value.strip().lstrip("vV")
    parts = []
    for chunk in raw.split(".")[:4]:
        digits = "".join(char for char in chunk if char.isdigit())
        parts.append(int(digits or 0))
    return tuple(parts or [0])


def _pick_release(releases: list[object]) -> dict[str, object] | None:
    rows = [
        row
        for row in releases
        if isinstance(row, dict) and not row.get("draft") and not row.get("prerelease")
    ]
    if not rows:
        return None
    rows.sort(key=lambda row: _version(str(row.get("tag_name") or "")), reverse=True)
    return rows[0]


@router.get("/check", response_model=UpdateInfo)
def check_updates() -> UpdateInfo:
    current = os.environ.get("KOVA_VERSION", "0.0.0")
    repo = os.environ.get("KOVA_UPDATE_REPO", "AlexeyKurgan/Kova")
    url = f"https://api.github.com/repos/{repo}/releases?per_page=20"
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

    payload = _pick_release(payload if isinstance(payload, list) else [payload])
    if payload is None:
        return UpdateInfo(current=current, error="Релизов пока нет — канал обновлений пуст")

    latest = str(payload.get("tag_name") or "").strip()
    available = bool(latest) and _version(latest) > _version(current)
    assets = []
    for asset in payload.get("assets") or []:
        if not isinstance(asset, dict):
            continue
        name = str(asset.get("name") or "")
        if not name.lower().endswith((".msi", ".exe")):
            continue
        assets.append(
            ReleaseAsset(
                name=name,
                url=str(asset.get("browser_download_url") or ""),
                size=int(asset.get("size") or 0),
            )
        )
    return UpdateInfo(
        current=current,
        latest=latest,
        update_available=available,
        url=str(payload.get("html_url") or ""),
        notes=str(payload.get("body") or "")[:2000],
        published_at=str(payload.get("published_at") or ""),
        assets=assets,
    )


@router.post("/download")
def download_update(payload: DownloadRequest) -> dict[str, object]:
    repo = os.environ.get("KOVA_UPDATE_REPO", "AlexeyKurgan/Kova")
    parsed = urllib.parse.urlparse(payload.url)
    if parsed.scheme != "https" or parsed.netloc != "github.com":
        raise HTTPException(status_code=400, detail="Разрешены только HTTPS-ссылки GitHub")
    prefix = f"/{repo}/releases/download/"
    if not parsed.path.startswith(prefix):
        raise HTTPException(status_code=400, detail="Ссылка не принадлежит релизу Kova")
    name = Path(urllib.parse.unquote(parsed.path)).name
    if not name.lower().endswith((".msi", ".exe")):
        raise HTTPException(status_code=400, detail="Можно скачать только .msi или .exe")

    target_dir = Path(tempfile.gettempdir()) / "kova-update"
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / name
    request = urllib.request.Request(
        payload.url,
        headers={"User-Agent": "Kova-Hub-Updater"},
    )
    try:
        try:
            import certifi
            context = ssl.create_default_context(cafile=certifi.where())
        except (ImportError, OSError):
            context = ssl.create_default_context()
        digest = hashlib.sha256()
        size = 0
        with urllib.request.urlopen(request, timeout=30, context=context) as response:
            with target.open("wb") as handle:
                while True:
                    chunk = response.read(1024 * 256)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > 400 * 1024 * 1024:
                        target.unlink(missing_ok=True)
                        raise HTTPException(status_code=413, detail="Файл обновления слишком большой")
                    digest.update(chunk)
                    handle.write(chunk)
    except HTTPException:
        raise
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        target.unlink(missing_ok=True)
        raise HTTPException(status_code=502, detail=f"Не удалось скачать обновление: {exc}") from exc

    sha256 = digest.hexdigest()
    if payload.expected_sha256 and sha256 != payload.expected_sha256.lower():
        target.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="SHA256 не совпал — файл удалён")
    return {
        "path": str(target),
        "name": name,
        "size": size,
        "sha256": sha256,
    }
