"""MCP server, so Claude (claude.ai on the phone included) can read recipes."""

from typing import Any, Literal

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError

from app.recipes.store import RecipeStore

INSTRUCTIONS = (
    "Lækkert is Serwan's recipe app. Food and drinks are separate sides and are "
    "never mixed. This version can list and read recipes; adding and editing come "
    "later. Amounts are metric (g, ml)."
)


def build_mcp(store: RecipeStore) -> MCPServer:
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

    return server
