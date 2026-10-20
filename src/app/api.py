"""JSON API the web app reads and writes recipes through.

Every write handler is `async def` and calls the synchronous store without
awaiting between its reads and its write, so the event loop serialises writes
(one worker). Cross-site forms can only send "simple" content types, so write
routes refuse everything but JSON (uploads: image types), which a browser will
only send cross-site after a preflight; the app sends no CORS headers.
"""

import functools
import json
import logging
from collections.abc import Awaitable, Callable
from typing import get_args

from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse, Response
from starlette.routing import Route

from app.recipes.catalog import Catalog
from app.recipes.drafts import parse_draft
from app.recipes.model import SIDES, Mark, Recipe
from app.recipes.search import search
from app.recipes.store import RATING_RANGE, RecipeStore
from app.recipes.timeline import current_rating, last_made
from app.recipes.uploads import (
    IMAGE_TYPES,
    MAX_UPLOAD_BYTES,
    ImageTooLarge,
    UnsupportedImage,
    UploadStore,
)

ALL_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]
MARKS: tuple[str, ...] = get_args(Mark)
VIA = "app"
MAX_JSON_BYTES = 1024 * 1024

log = logging.getLogger("app.api")

SAVE_FAILED = "could not save; nothing was changed"
UNEXPECTED = "something went wrong; nothing was changed"
JSON_TOO_BIG = "That's too much to save at once"
PHOTO_TOO_BIG = "That photo is over 20 MB"


class BodyTooLarge(Exception):
    """A request body went over its cap; the message is the sentence to show."""


def error(message: str, status: int) -> JSONResponse:
    return JSONResponse({"error": message}, status_code=status)


def not_found() -> JSONResponse:
    return error("not found", 404)


def media_type(request: Request) -> str:
    """The Content-Type without parameters (charset and the like), lowercased."""
    return request.headers.get("content-type", "").split(";")[0].strip().lower()


def stars(value: object) -> float:
    """A rating from the body as a float; anything but 0.5 to 5 is refused.

    The range test runs before float(), which fails on huge integers.
    """
    if (
        isinstance(value, bool)
        or not isinstance(value, int | float)
        or not 0.5 <= value <= 5
    ):
        raise ValueError(RATING_RANGE)
    return float(value)


def write_route(
    handler: Callable[[Request], Awaitable[Response]],
) -> Callable[[Request], Awaitable[Response]]:
    """Turn the store's ValueError into 400 and OSError into 503."""

    @functools.wraps(handler)
    async def wrapper(request: Request) -> Response:
        try:
            return await handler(request)
        except ValueError as err:
            return error(str(err), 400)
        except BodyTooLarge as err:
            return error(str(err), 413)
        except OSError:
            log.exception("write failed: %s %s", request.method, request.url.path)
            return error(SAVE_FAILED, 503)
        except Exception:
            # A bug must still answer in JSON, as the editor expects.
            log.exception("write crashed: %s %s", request.method, request.url.path)
            return error(UNEXPECTED, 500)

    return wrapper


async def read_body(request: Request, limit: int, message: str) -> bytes:
    """The request body, read in chunks; raises BodyTooLarge past `limit` bytes."""
    declared = request.headers.get("content-length", "")
    if declared.isascii() and declared.isdigit() and int(declared) > limit:
        raise BodyTooLarge(message)
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > limit:
            raise BodyTooLarge(message)
        chunks.append(chunk)
    return b"".join(chunks)


async def json_body(request: Request) -> object:
    """The decoded JSON body. Raises ValueError (a sentence) if it isn't JSON."""
    body = await read_body(request, MAX_JSON_BYTES, JSON_TOO_BIG)
    try:
        return json.loads(body)
    except (ValueError, RecursionError):  # ValueError includes bad UTF-8
        raise ValueError("That isn't valid JSON") from None


async def json_object(request: Request) -> dict:
    body = await json_body(request)
    if not isinstance(body, dict):
        raise ValueError("Send a JSON object")
    return body


def needs_json(request: Request) -> JSONResponse | None:
    if media_type(request) != "application/json":
        return error("Send application/json", 415)
    return None


def mark_list(body: dict, key: str) -> list[Mark]:
    value = body.get(key, [])
    if not isinstance(value, list) or not all(
        isinstance(m, str) and m in MARKS for m in value
    ):
        raise ValueError(f"{key} must be a list of tried, favourite or try_next")
    return value


def api_routes(
    store: RecipeStore, catalog: Catalog, uploads: UploadStore
) -> list[Route]:
    def derived(side: str, slug: str) -> dict:
        entries = store.timeline(side, slug) or []
        return {"rating": current_rating(entries), "last_made": last_made(entries)}

    def detail(recipe: Recipe) -> dict:
        body = recipe.model_dump(mode="json")
        for ingredient in body["ingredients"]:
            ingredient["g_per_tsp"] = catalog.g_per_tsp(ingredient["item"])
        return {**body, **derived(recipe.side, recipe.slug)}

    async def list_recipes(request: Request) -> JSONResponse:
        side = request.query_params.get("side")
        if side not in SIDES:
            return error("side must be food or drinks", 400)
        recipes = search(store.list(side), request.query_params.get("q", ""))
        return JSONResponse(
            {"recipes": [{**r.summary(), **derived(side, r.slug)} for r in recipes]}
        )

    async def recipe_detail(request: Request) -> JSONResponse:
        recipe = store.get(request.path_params["side"], request.path_params["slug"])
        if recipe is None:
            return not_found()
        return JSONResponse(detail(recipe))

    async def recipe_file(request: Request) -> FileResponse | JSONResponse:
        path = store.file_path(
            request.path_params["side"],
            request.path_params["slug"],
            request.path_params["name"],
        )
        if path is None:
            return not_found()
        return FileResponse(
            path,
            headers={
                "Cache-Control": "private, max-age=3600",
                "X-Content-Type-Options": "nosniff",
            },
        )

    async def timeline(request: Request) -> JSONResponse:
        side, slug = request.path_params["side"], request.path_params["slug"]
        entries = store.timeline(side, slug)
        if entries is None:
            return not_found()
        return JSONResponse(
            {
                "entries": [e.model_dump(mode="json") for e in reversed(entries)],
                "current_version": store.current_version(side, slug),
            }
        )

    @write_route
    async def create_recipe(request: Request) -> JSONResponse:
        if (refusal := needs_json(request)) is not None:
            return refusal
        body = await json_object(request)
        side = body.pop("side", None)
        if side not in SIDES:
            raise ValueError("Choose food or drinks")
        recipe = store.create(side, parse_draft(body), VIA)
        return JSONResponse(detail(recipe), status_code=201)

    @write_route
    async def update_recipe(request: Request) -> JSONResponse:
        if (refusal := needs_json(request)) is not None:
            return refusal
        draft = parse_draft(await json_object(request))
        recipe = store.update(
            request.path_params["side"], request.path_params["slug"], draft, VIA
        )
        return not_found() if recipe is None else JSONResponse(detail(recipe))

    @write_route
    async def delete_recipe(request: Request) -> Response:
        if not store.delete(request.path_params["side"], request.path_params["slug"]):
            return not_found()
        return Response(status_code=204)

    @write_route
    async def restore_recipe(request: Request) -> JSONResponse:
        if (refusal := needs_json(request)) is not None:
            return refusal
        version = (await json_object(request)).get("version")
        if not isinstance(version, int) or isinstance(version, bool):
            raise ValueError("version must be a whole number")
        recipe = store.restore(
            request.path_params["side"], request.path_params["slug"], version, VIA
        )
        return not_found() if recipe is None else JSONResponse(detail(recipe))

    @write_route
    async def set_marks(request: Request) -> JSONResponse:
        if (refusal := needs_json(request)) is not None:
            return refusal
        body = await json_object(request)
        recipe = store.set_marks(
            request.path_params["side"],
            request.path_params["slug"],
            mark_list(body, "add"),
            mark_list(body, "remove"),
            VIA,
        )
        return not_found() if recipe is None else JSONResponse(detail(recipe))

    @write_route
    async def add_entry(request: Request) -> JSONResponse:
        if (refusal := needs_json(request)) is not None:
            return refusal
        body = await json_object(request)
        side, slug = request.path_params["side"], request.path_params["slug"]
        kind = body.get("kind")
        if kind == "note":
            text = body.get("text")
            if not isinstance(text, str):
                raise ValueError("Write something in the note")
            entry = store.add_note(side, slug, text, VIA)
        elif kind == "rating":
            entry = store.add_rating(side, slug, stars(body.get("rating")), VIA)
        elif kind == "made":
            rating = body.get("rating")
            rating = None if rating is None else stars(rating)
            note = body.get("note", "")
            if not isinstance(note, str):
                raise ValueError("The note must be text")
            entry = store.add_made(side, slug, rating, note, VIA)
        else:
            raise ValueError("kind must be note, rating or made")
        recipe = store.get(side, slug)
        if entry is None or recipe is None:
            return not_found()
        return JSONResponse(
            {"entry": entry.model_dump(mode="json"), "recipe": detail(recipe)},
            status_code=201,
        )

    @write_route
    async def upload_image(request: Request) -> JSONResponse:
        content_type = media_type(request)
        if content_type not in IMAGE_TYPES:
            return error("That file type isn't a supported photo", 415)
        body = await read_body(request, MAX_UPLOAD_BYTES, PHOTO_TOO_BIG)
        try:
            name = uploads.save(content_type, body)
        except UnsupportedImage as err:
            return error(str(err), 415)
        except ImageTooLarge as err:
            return error(str(err), 413)
        return JSONResponse({"name": name}, status_code=201)

    async def unknown(request: Request) -> JSONResponse:
        return not_found()

    recipe = "/api/recipes/{side}/{slug}"
    return [
        Route("/api/recipes", list_recipes),
        Route("/api/recipes", create_recipe, methods=["POST"]),
        Route(recipe, recipe_detail),
        Route(recipe, update_recipe, methods=["PUT"]),
        Route(recipe, delete_recipe, methods=["DELETE"]),
        Route(f"{recipe}/restore", restore_recipe, methods=["POST"]),
        Route(f"{recipe}/marks", set_marks, methods=["POST"]),
        Route(f"{recipe}/timeline", timeline),
        Route(f"{recipe}/timeline", add_entry, methods=["POST"]),
        Route(f"{recipe}/files/{{name}}", recipe_file),
        Route("/api/uploads", upload_image, methods=["POST"]),
        # Without this, unknown /api paths would fall through to the SPA.
        Route("/api/{rest:path}", unknown, methods=ALL_METHODS),
    ]
