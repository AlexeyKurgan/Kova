import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .routes import (
    agents,
    assets,
    blender,
    chats,
    doctor,
    health,
    ledger,
    memory,
    project,
    projects,
    packages,
    providers,
    review,
    roblox,
    skills,
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
    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        from ..agents.runner import reconcile_runs
        from ..storage.projects import read_active_hub

        hub = read_active_hub()
        if hub is not None:
            try:
                reconcile_runs(hub)
            except OSError:
                pass
        yield
        from ..agents.runner import shutdown_runs

        shutdown_runs()

    app = FastAPI(
        title="Kova Core",
        version="0.0.0",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )
    app.include_router(health.router)
    app.include_router(project.router)
    app.include_router(projects.router)
    app.include_router(packages.router)
    app.include_router(tasks.router)
    app.include_router(assets.router)
    app.include_router(blender.router)
    app.include_router(review.router)
    app.include_router(roblox.router)
    app.include_router(snapshots.router)
    app.include_router(doctor.router)
    app.include_router(ledger.router)
    app.include_router(memory.router)
    app.include_router(summary.router)
    app.include_router(providers.router)
    app.include_router(skills.router)
    app.include_router(agents.router)
    app.include_router(chats.router)

    bridge_paths = {
        "/roblox/commands",
        "/roblox/results",
        "/roblox/event",
        "/roblox/status",
    }

    @app.middleware("http")
    async def require_token(request: Request, call_next):
        token = os.environ.get("KOVA_CORE_TOKEN", "")
        path = request.url.path
        media = request.method == "GET" and (
            path.endswith("/preview")
            or path.endswith("/viewer")
            or path.endswith("/cover")
            or path.endswith("/screenshot")
            or path.endswith("/events")
            or "/attachments/" in path
        )
        if (
            token
            and request.method != "OPTIONS"
            and path != "/health"
            and path not in bridge_paths
        ):
            provided = request.headers.get("x-kova-token", "")
            if not provided and media:
                provided = request.query_params.get("token", "")
            if provided != token:
                return JSONResponse({"detail": "invalid token"}, status_code=401)
        return await call_next(request)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_origin_regex=r"vscode-webview://.*|http://(localhost|127\.0\.0\.1):\d+",
        allow_methods=["*"],
        allow_headers=["*"],
    )

    return app
