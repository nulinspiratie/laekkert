"""Serves the built frontend (web/dist) as a single-page app.

Any GET path that is not a file in the build gets index.html, so deep links
such as /drinks/daiquiri load the app and its router takes over.
"""

import mimetypes
from pathlib import Path

from starlette.requests import Request
from starlette.responses import FileResponse, PlainTextResponse
from starlette.routing import BaseRoute, Mount, Route
from starlette.staticfiles import StaticFiles

# Browsers want this type for the manifest; the system's mime.types may say otherwise.
mimetypes.add_type("application/manifest+json", ".webmanifest")


def web_routes(static_dir: Path | None) -> list[BaseRoute]:
    """Routes for the frontend; they catch every path, so they go last."""
    if static_dir is None:

        async def not_built(request: Request) -> PlainTextResponse:
            return PlainTextResponse("Frontend not built. Run `just web-build`.")

        return [Route("/", not_built)]

    root = Path(static_dir).resolve()

    async def spa(request: Request) -> FileResponse:
        candidate = (root / request.path_params["path"]).resolve()
        if candidate.is_file() and root in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(root / "index.html")

    return [
        Mount("/assets", StaticFiles(directory=root / "assets", check_dir=False)),
        Route("/{path:path}", spa),
    ]
