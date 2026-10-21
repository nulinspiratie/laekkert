"""JSON API the web app reads and writes recipes through.

Every write handler is `async def` and calls the synchronous store without
awaiting between its reads and its write, so the event loop serialises writes
(one worker). The bar is the exception: it has its own lock, shared with the MCP
tools, so its work (and the bar view the drink reads build) runs in a worker
thread, and waiting for that lock never stalls other requests.

Cross-site forms can only send "simple" content types, so write routes refuse
everything but JSON (uploads: image types), which a browser will only send
cross-site after a preflight; the app sends no CORS headers.
"""

import functools
import json
import logging
from collections.abc import Awaitable, Callable
from typing import get_args

from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse, Response
from starlette.routing import Route

from app.config import Settings
from app.recipes.bar import Bar, BarChanges, BarView, InventoryUnavailable
from app.recipes.catalog import Catalog, CatalogUnavailable
from app.recipes.drafts import parse_draft
from app.recipes.have import HAVE_FOOD_ONLY, clean_terms, rank
from app.recipes.model import SIDES, Mark, Recipe
from app.recipes.search import search
from app.recipes.store import RATING_RANGE, RecipeStore, SaveIncomplete, VersionConflict
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
SAVE_INCOMPLETE = (
    "could not save, and the recipe may be partly changed; check its history"
)
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
    """Turn the store's ValueError into 400, a stale edit into 409, OSError into 503."""

    @functools.wraps(handler)
    async def wrapper(request: Request) -> Response:
        try:
            return await handler(request)
        except VersionConflict as err:
            return error(str(err), 409)
        except ValueError as err:
            return error(str(err), 400)
        except BodyTooLarge as err:
            return error(str(err), 413)
        except SaveIncomplete:
            log.exception(
                "write left a recipe partly changed: %s %s",
                request.method,
                request.url.path,
            )
            return error(SAVE_INCOMPLETE, 503)
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


def unavailable_as_503(
    handler: Callable[[Request], Awaitable[Response]],
) -> Callable[[Request], Awaitable[Response]]:
    """Answer a catalog or inventory file that can't be read with its sentence, 503.

    Only those two: any other OSError is left to the route's own handling.
    """

    @functools.wraps(handler)
    async def wrapper(request: Request) -> Response:
        try:
            return await handler(request)
        except (CatalogUnavailable, InventoryUnavailable) as err:
            return error(str(err), 503)

    return wrapper


def bar_changes(body: dict) -> BarChanges:
    """The change a bar request asks for; raises ValueError with one sentence."""
    try:
        return BarChanges.model_validate(body)
    except ValidationError as err:
        first = err.errors()[0]
        if first["type"] == "extra_forbidden":
            raise ValueError(
                f"The change has an unknown field: {first['loc'][-1]}"
            ) from None
        if first["type"] == "value_error":
            raise ValueError(str(first["ctx"]["error"])) from None
        raise ValueError("The change isn't valid") from None


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


def with_bar(body: dict, recipe: Recipe, view: BarView) -> dict:
    """A drink's JSON with its bar status, and each ingredient's if it has some.

    The one place the drinks' `bar` shape is made, for summaries and details.
    Syrups and prep have no status: their `bar` and their ingredients' are null.
    """
    body["bar"] = status = view.status(recipe)
    for ingredient in body.get("ingredients", []):
        ingredient["bar"] = (
            None if status is None else view.ingredient(ingredient["item"])
        )
    return body


def api_routes(
    store: RecipeStore,
    catalog: Catalog,
    uploads: UploadStore,
    bar: Bar,
    settings: Settings,
) -> list[Route]:
    def detail(recipe: Recipe) -> dict:
        """A recipe's JSON. A drink's builds the bar view, which reads every drink."""
        body = recipe.model_dump(mode="json")
        for ingredient in body["ingredients"]:
            ingredient["g_per_tsp"] = catalog.g_per_tsp(ingredient["item"])
        body = {**body, **store.derived(recipe.side, recipe.slug)}
        if recipe.side == "drinks":
            body = with_bar(body, recipe, bar.view())
        return body

    def summaries(side: str, query: str, terms: list[str]) -> list[dict]:
        everything = store.list(side)
        # The bar view takes the same read of every drink as the list.
        view = bar.view(everything) if side == "drinks" else None
        searched = search(everything, query)
        haves = {}
        if terms:
            ranked = rank(searched, terms, catalog)
            searched = [r for r, _ in ranked]
            haves = {r.slug: m.json() for r, m in ranked}
        found = []
        for r in searched:
            summary = {**r.summary(), **store.derived(side, r.slug)}
            if r.slug in haves:
                summary["have"] = haves[r.slug]
            found.append(summary if view is None else with_bar(summary, r, view))
        return found

    async def list_recipes(request: Request) -> JSONResponse:
        side = request.query_params.get("side")
        if side not in SIDES:
            return error("side must be food or drinks", 400)
        query = request.query_params.get("q", "")
        terms = clean_terms(request.query_params.getlist("have"))
        if terms and side != "food":
            return error(HAVE_FOOD_ONLY, 400)
        return JSONResponse(
            {"recipes": await run_in_threadpool(summaries, side, query, terms)}
        )

    def read_detail(side: str, slug: str) -> dict | None:
        recipe = store.get(side, slug)
        return None if recipe is None else detail(recipe)

    async def recipe_detail(request: Request) -> JSONResponse:
        body = await run_in_threadpool(
            read_detail, request.path_params["side"], request.path_params["slug"]
        )
        return not_found() if body is None else JSONResponse(body)

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
        body = await json_object(request)
        base_version = None
        if "base_version" in body:
            base_version = body.pop("base_version")
            if not isinstance(base_version, int) or isinstance(base_version, bool):
                raise ValueError("The version must be a whole number")
        draft = parse_draft(body)
        recipe = store.update(
            request.path_params["side"],
            request.path_params["slug"],
            draft,
            VIA,
            base_version,
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

    @unavailable_as_503
    async def read_bar(request: Request) -> JSONResponse:
        return JSONResponse(await run_in_threadpool(lambda: bar.view().json()))

    @write_route
    @unavailable_as_503
    async def change_bar(request: Request) -> JSONResponse:
        if (refusal := needs_json(request)) is not None:
            return refusal
        changes = bar_changes(await json_object(request))
        # In a worker thread: an MCP change may hold the bar's lock for a while.
        return JSONResponse(await run_in_threadpool(lambda: bar.apply(changes).json()))

    async def read_settings(request: Request) -> JSONResponse:
        return JSONResponse({"food_quick_tags": list(settings.food_quick_tags)})

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
        Route("/api/bar", read_bar),
        Route("/api/bar", change_bar, methods=["POST"]),
        Route("/api/uploads", upload_image, methods=["POST"]),
        Route("/api/settings", read_settings),
        # Without this, unknown /api paths would fall through to the SPA.
        Route("/api/{rest:path}", unknown, methods=ALL_METHODS),
    ]
