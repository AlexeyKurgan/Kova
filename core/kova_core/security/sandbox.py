import shutil
import subprocess
from pathlib import Path

from pydantic import BaseModel, Field


class SandboxBackend(BaseModel):
    id: str
    label: str
    available: bool = False
    detail: str = ""


class SandboxStatus(BaseModel):
    backends: list[SandboxBackend] = Field(default_factory=list)
    default: str = "copy"
    fallback: str = "sandbox-копия + Job Object"
    message: str = ""


def _docker() -> SandboxBackend:
    exe = shutil.which("docker")
    if not exe:
        return SandboxBackend(id="docker", label="Docker", detail="docker.exe не найден")
    try:
        result = subprocess.run(
            [exe, "version", "--format", "{{.Server.Version}}"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=8,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except (OSError, subprocess.SubprocessError) as exc:
        return SandboxBackend(id="docker", label="Docker", detail=str(exc))
    if result.returncode == 0 and (result.stdout or "").strip():
        return SandboxBackend(
            id="docker",
            label="Docker",
            available=True,
            detail=f"Docker {result.stdout.strip()}",
        )
    return SandboxBackend(
        id="docker",
        label="Docker",
        detail=(result.stderr or result.stdout or "Docker daemon недоступен").strip()[:300],
    )


def _wsl() -> SandboxBackend:
    exe = shutil.which("wsl") or shutil.which("wsl.exe")
    if not exe:
        return SandboxBackend(id="wsl", label="WSL2", detail="wsl.exe не найден")
    try:
        result = subprocess.run(
            [exe, "-l", "-q"],
            capture_output=True,
            timeout=8,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except (OSError, subprocess.SubprocessError) as exc:
        return SandboxBackend(id="wsl", label="WSL2", detail=str(exc))
    raw = (result.stdout or b"") + (result.stderr or b"")
    text = raw.decode("utf-16-le", errors="replace") if b"\x00" in raw else raw.decode("utf-8", errors="replace")
    clean = " ".join(text.split())
    if "not installed" in clean.lower() or "не установлен" in clean.lower():
        return SandboxBackend(id="wsl", label="WSL2", detail="WSL не установлен")
    if result.returncode == 0 and clean:
        return SandboxBackend(id="wsl", label="WSL2", available=True, detail=clean[:300])
    return SandboxBackend(id="wsl", label="WSL2", detail=clean[:300] or "нет дистрибутива")


def _windows_sandbox() -> SandboxBackend:
    path = Path("C:/Windows/System32/WindowsSandbox.exe")
    if path.is_file():
        return SandboxBackend(
            id="windows-sandbox",
            label="Windows Sandbox",
            available=True,
            detail=str(path),
        )
    return SandboxBackend(
        id="windows-sandbox",
        label="Windows Sandbox",
        detail="WindowsSandbox.exe не найден",
    )


def detect_sandbox() -> SandboxStatus:
    backends = [_docker(), _wsl(), _windows_sandbox()]
    available = [item for item in backends if item.available]
    default = available[0].id if available else "copy"
    message = (
        f"Доступен backend: {available[0].label}"
        if available
        else "OS sandbox недоступен — Kova использует sandbox-копию проекта и Job Object"
    )
    return SandboxStatus(backends=backends, default=default, message=message)
