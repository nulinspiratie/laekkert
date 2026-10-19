"""JSON API the web app reads recipes through."""

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from app.recipes.model import SIDES
from app.recipes.store import RecipeStore

ALL_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]


def not_found() -> JSONResponse:
    return JSONResponse({"error": "not found"}, status_code=404)


def api_routes(store: RecipeStore) -> list[Route]:
    async def list_recipes(request: Request) -> JSONResponse:
        side = request.query_params.get("side")
        if side not in SIDES:
            return JSONResponse(
                {"error": "side must be food or drinks"}, status_code=400
            )
        return JSONResponse({"recipes": [r.summary() for r in store.list(side)]})

    async def recipe_detail(request: Request) -> JSONResponse:
        recipe = store.get(request.path_params["side"], request.path_params["slug"])
        if recipe is None:
            return not_found()
        return JSONResponse(recipe.model_dump(mode="json"))

    async def unknown(request: Request) -> JSONResponse:
        return not_found()

    return [
        Route("/api/recipes", list_recipes),
        Route("/api/recipes/{side}/{slug}", recipe_detail),
        # Without this, unknown /api paths would fall through to the SPA.
        Route("/api/{rest:path}", unknown, methods=ALL_METHODS),
    ]
