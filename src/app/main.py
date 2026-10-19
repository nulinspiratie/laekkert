"""Placeholder HTTP app: `/` says hello, `/healthz` reports the deployed version."""

import html
import os

import uvicorn
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import HTMLResponse, JSONResponse
from starlette.routing import Route

from app.config import Settings, load_settings

# Fixed by the runtime conventions; see CLAUDE.md.
HOST = "0.0.0.0"
PORT = 8080


def create_app(settings: Settings | None = None) -> Starlette:
    settings = settings or load_settings()
    version = os.environ.get("APP_VERSION", "dev")

    async def index(request: Request) -> HTMLResponse:
        return HTMLResponse(
            "<!doctype html><title>Hello</title>"
            f"<h1>{html.escape(settings.greeting)}</h1>"
            f"<p>version {html.escape(version)}</p>"
        )

    async def healthz(request: Request) -> JSONResponse:
        return JSONResponse({"status": "ok", "version": version})

    return Starlette(
        routes=[
            Route("/", index),
            Route("/healthz", healthz),
        ]
    )


def main() -> None:
    uvicorn.run(create_app(), host=HOST, port=PORT)
