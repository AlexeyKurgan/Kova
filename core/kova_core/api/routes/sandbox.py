from fastapi import APIRouter

from ...security.sandbox import SandboxStatus, detect_sandbox

router = APIRouter(prefix="/sandbox", tags=["sandbox"])


@router.get("", response_model=SandboxStatus)
def get_sandbox() -> SandboxStatus:
    return detect_sandbox()
