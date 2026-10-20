"""JSON API the web app reads recipes through."""

from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse
from starlette.routing import Route

from app.recipes.catalog import Catalog
from app.recipes.model import SIDES
from app.recipes.search import search
from app.recipes.store import RecipeStore

ALL_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]


def not_found() -> JSONResponse:
    return JSONResponse({"error": "not found"}, status_code=404)


def api_routes(store: RecipeStore, catalog: Catalog) -> list[Route]:
    async def list_recipes(request: Request) -> JSONResponse:
        side = request.query_params.get("side")
        if side not in SIDES:
            return JSONResponse(
                {"error": "side must be food or drinks"}, status_code=400
            )
        recipes = search(store.list(side), request.query_params.get("q", ""))
        return JSONResponse({"recipes": [r.summary() for r in recipes]})

    async def recipe_detail(request: Request) -> JSONResponse:
        recipe = store.get(request.path_params["side"], request.path_params["slug"])
        if recipe is None:
            return not_found()
        body = recipe.model_dump(mode="json")
        for ingredient in body["ingredients"]:
            ingredient["g_per_tsp"] = catalog.g_per_tsp(ingredient["item"])
        return JSONResponse(body)

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

    async def unknown(request: Request) -> JSONResponse:
        return not_found()

    return [
        Route("/api/recipes", list_recipes),
        Route("/api/recipes/{side}/{slug}", recipe_detail),
        Route("/api/recipes/{side}/{slug}/files/{name}", recipe_file),
        # Without this, unknown /api paths would fall through to the SPA.
        Route("/api/{rest:path}", unknown, methods=ALL_METHODS),
    ]
