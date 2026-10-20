"""MCP server, so Claude (claude.ai on the phone included) can read recipes."""

from importlib import resources
from typing import Any, Literal

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from pydantic import Field

from app.recipes.fetch import Fetcher
from app.recipes.model import Mark, Recipe
from app.recipes.search import search
from app.recipes.store import RecipeStore
from app.recipes.uploads import UploadStore

INSTRUCTIONS = (
    "Lækkert is Serwan's recipe app. Food and drinks are separate sides and are "
    "never mixed. You can list, search, read, add and edit recipes. Before adding "
    "or editing, read the style guide (get_style_guide or the laekkert://style-guide "
    "resource) and follow it. Amounts are metric (g, ml)."
)

# Package data, so it is in the wheel and the image (the Dockerfile copies no docs/).
STYLE_GUIDE = (resources.files("app") / "style_guide.md").read_text(encoding="utf-8")

Sort = Literal["relevance", "name", "time", "rating", "recently_made"]


def order(entries: list[dict], sort: Sort) -> list[dict]:
    """Sort summaries (with rating and last_made); ties go by name.

    Relevance keeps the order it came in. Missing values go last.
    """
    if sort == "relevance":
        return entries
    by_name = sorted(entries, key=lambda e: e["name"].casefold())
    if sort == "name":
        return by_name
    field = {"time": "time_minutes", "rating": "rating", "recently_made": "last_made"}[
        sort
    ]
    known = [e for e in by_name if e[field] is not None]
    unknown = [e for e in by_name if e[field] is None]
    # sort() is stable, and reverse keeps equal items in order: ties stay by name.
    # `last_made` is a fixed-width UTC timestamp, so text order is time order.
    known.sort(key=lambda e: e[field], reverse=sort != "time")
    return known + unknown


def build_mcp(store: RecipeStore, uploads: UploadStore, fetcher: Fetcher) -> MCPServer:
    server = MCPServer("laekkert", instructions=INSTRUCTIONS)

    def entry(recipe: Recipe) -> dict:
        return {**recipe.summary(), **store.derived(recipe.side, recipe.slug)}

    @server.tool()
    def list_recipes(side: Literal["food", "drinks"]) -> list[dict]:
        """List the recipes on one side (food or drinks), sorted by name.

        Each entry has slug, name, side, category, time_minutes, tags, marks,
        image, rating (stars, or null if unrated), last_made (when it was last
        made, or null) and version. Use read_recipe with the slug for
        ingredients and steps.
        """
        return [entry(r) for r in store.list(side)]

    @server.tool()
    def search_recipes(
        side: Literal["food", "drinks"],
        query: str = "",
        tags: list[str] = Field(default_factory=list),  # noqa: B008
        marks: list[Mark] = Field(default_factory=list),  # noqa: B008
        category: str | None = None,
        sort: Sort = "relevance",
        limit: int = Field(20, ge=1, le=50),
    ) -> list[dict]:
        """Search the recipes on one side, with the same entries as list_recipes.

        query matches names, ingredients, tags and category, and forgives typos.
        tags and marks (tried, favourite, try_next) each narrow the result to
        recipes that have all of them. category is matched ignoring case. sort is
        relevance (best match first), name, time (shortest first), rating
        (highest first) or recently_made (latest first); recipes without a
        time, rating or made date come last. At most limit entries come back.
        """
        wanted = {t.casefold() for t in tags}
        found = []
        for recipe in search(store.list(side), query):
            if wanted - {t.casefold() for t in recipe.tags}:
                continue
            if set(marks) - set(recipe.marks):
                continue
            if (
                category is not None
                and recipe.category.casefold() != category.casefold()
            ):
                continue
            found.append(entry(recipe))
        return order(found, sort)[:limit]

    @server.tool()
    def read_recipe(side: Literal["food", "drinks"], slug: str) -> dict[str, Any]:
        """Read one recipe in full: servings, ingredients (metric), steps, source.

        Also has rating, last_made and version. Pass version to edit_recipe, so an
        edit made on an old copy is refused.
        """
        recipe = store.get(side, slug)
        if recipe is None:
            # ToolError, not ValueError: only its message reaches the model.
            raise ToolError(f"No recipe {slug!r} on the {side} side")
        return {
            **recipe.model_dump(mode="json"),
            **store.derived(recipe.side, recipe.slug),
        }

    @server.tool()
    def get_style_guide() -> str:
        """The style guide for recipes: read it before adding or editing one."""
        return STYLE_GUIDE

    @server.resource(
        "laekkert://style-guide", name="style-guide", mime_type="text/markdown"
    )
    def style_guide_resource() -> str:
        """The style guide for recipes."""
        return STYLE_GUIDE

    @server.prompt()
    def import_recipe(url: str) -> str:
        """Import the recipe at a web address into Lækkert."""
        return (
            f"Import the recipe at {url} into Lækkert. Fetch the page yourself, "
            "write the recipe following the style guide below, check the existing "
            "tags with search_recipes, then call add_recipe with source_url set to "
            f"{url}.\n\n{STYLE_GUIDE}"
        )

    return server
