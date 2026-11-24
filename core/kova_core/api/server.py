import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .routes import (
    agents,
    assets,
    blender,
    doctor,
    health,
    ledger,
    project,
    projects,
    providers,
    review,
    snapshots,
    summary,
    tasks,
)

ALLOWED_ORIGINS = [
    "http://localhost:1420",
    "http://127.0.0.1:1420",
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
]


def create_app() -> FastAPI:
    app = FastAPI(
        title="Kova Core",
        version="0.0.0",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.include_router(health.router)
    app.include_router(project.router)
    app.include_router(projects.router)
    app.include_router(tasks.router)
    app.include_router(assets.router)
    app.include_router(blender.router)
    app.include_router(review.router)
    app.include_router(snapshots.router)
    app.include_router(doctor.router)
    app.include_router(ledger.router)
    app.include_router(summary.router)
    app.include_router(providers.router)
    app.include_router(agents.router)

    @app.middleware("http")
    async def require_token(request: Request, call_next):
        token = os.environ.get("KOVA_CORE_TOKEN", "")
        if token and request.method != "OPTIONS" and request.url.path != "/health":
            if request.headers.get("x-kova-token") != token:
                return JSONResponse({"detail": "invalid token"}, status_code=401)
        return await call_next(request)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    return app
