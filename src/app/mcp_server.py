"""MCP server, so Claude (claude.ai on the phone included) can read recipes."""

from importlib import resources
from typing import Any, Literal

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError

from app.recipes.fetch import Fetcher
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


def build_mcp(store: RecipeStore, uploads: UploadStore, fetcher: Fetcher) -> MCPServer:
    server = MCPServer("laekkert", instructions=INSTRUCTIONS)

    @server.tool()
    def list_recipes(side: Literal["food", "drinks"]) -> list[dict]:
        """List the recipes on one side (food or drinks), sorted by name.

        Each entry has slug, name, side, category, time_minutes, tags, marks and
        image. Use read_recipe with the slug for ingredients and steps.
        """
        return [r.summary() for r in store.list(side)]

    @server.tool()
    def read_recipe(side: Literal["food", "drinks"], slug: str) -> dict[str, Any]:
        """Read one recipe in full: servings, ingredients (metric), steps, source."""
        recipe = store.get(side, slug)
        if recipe is None:
            # ToolError, not ValueError: only its message reaches the model.
            raise ToolError(f"No recipe {slug!r} on the {side} side")
        return recipe.model_dump(mode="json")

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
