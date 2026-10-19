"""HTTP app: `/healthz`, the JSON API, `/mcp`, and the built frontend."""

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
from app.mcp_server import build_mcp
from app.recipes.catalog import Catalog
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
    catalog = Catalog(data_dir)
    server = build_mcp(store)
    mcp_app = server.streamable_http_app(
        streamable_http_path="/mcp",
        stateless_http=True,
        json_response=True,
        # Not a bind address: it turns off the SDK's localhost-only Host check.
        # Cloudflare Access is the gate, and the container publishes no ports.
        host="0.0.0.0",
    )

    async def healthz(request: Request) -> JSONResponse:
        return JSONResponse({"status": "ok", "version": version})

    @contextlib.asynccontextmanager
    async def lifespan(app: Starlette):
        if settings.seed_examples:
            store.seed_if_empty()
        # Reference data, not example recipes, so it ignores `seed_examples`.
        catalog.seed_if_missing()
        async with server.session_manager.run():
            yield

    return Starlette(
        routes=[
            Route("/healthz", healthz),
            *api_routes(store, catalog),
            *mcp_app.routes,
            *web_routes(static_dir),
        ],
        lifespan=lifespan,
    )


def main() -> None:
    uvicorn.run(create_app(), host=HOST, port=PORT)
