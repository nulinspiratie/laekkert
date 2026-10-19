"""HTTP app: `/healthz`, the JSON API, and the built frontend."""

import contextlib
import os
from pathlib import Path

import uvicorn
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from app.api import api_routes
from app.config import Settings, load_settings
from app.recipes.store import RecipeStore
from app.web import web_routes

# Fixed by the runtime conventions; see CLAUDE.md.
HOST = "0.0.0.0"
PORT = 8080


def create_app(
    settings: Settings | None = None,
    *,
    data_dir: Path | None = None,
    static_dir: Path | None = None,
) -> Starlette:
    settings = settings or load_settings()
    version = os.environ.get("APP_VERSION", "dev")
    if data_dir is None:
        data_dir = Path(os.environ.get("APP_DATA_DIR", "/data"))
    if static_dir is None and os.environ.get("STATIC_DIR"):
        static_dir = Path(os.environ["STATIC_DIR"])
    store = RecipeStore(data_dir)

    async def healthz(request: Request) -> JSONResponse:
        return JSONResponse({"status": "ok", "version": version})

    @contextlib.asynccontextmanager
    async def lifespan(app: Starlette):
        if settings.seed_examples:
            store.seed_if_empty()
        yield

    return Starlette(
        routes=[
            Route("/healthz", healthz),
            *api_routes(store),
            *web_routes(static_dir),
        ],
        lifespan=lifespan,
    )


def main() -> None:
    uvicorn.run(create_app(), host=HOST, port=PORT)
