"""MCP server, so Claude (claude.ai on the phone included) can read recipes."""

import logging
import re
from importlib import resources
from typing import Any, Literal

from mcp.server.mcpserver import Context, MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from pydantic import BaseModel, ConfigDict, Field

from app.api import SAVE_FAILED, SAVE_INCOMPLETE
from app.recipes.drafts import DraftIngredient, RecipeDraft, parse_draft
from app.recipes.fetch import Fetcher, FetchError
from app.recipes.model import Mark, Recipe
from app.recipes.search import search
from app.recipes.store import (
    RecipeStore,
    SaveIncomplete,
    VersionConflict,
    already_saved,
)
from app.recipes.uploads import ImageTooLarge, UnsupportedImage, UploadStore

INSTRUCTIONS = (
    "Lækkert is Serwan's recipe app. Food and drinks are separate sides and are "
    "never mixed. You can list, search, read, add and edit recipes. Before adding "
    "or editing, read the style guide (get_style_guide or the laekkert://style-guide "
    "resource) and follow it. Amounts are metric (g, ml)."
)

# Package data, so it is in the wheel and the image (the Dockerfile copies no docs/).
STYLE_GUIDE = (resources.files("app") / "style_guide.md").read_text(encoding="utf-8")

Sort = Literal["relevance", "name", "time", "rating", "recently_made"]

NO_PHOTO = "the page has no main photo"
PHOTO_FAILED = "the photo could not be fetched"

log = logging.getLogger("app.mcp")
# A host name or address with an optional port; anything else is not echoed back.
HOST = re.compile(r"[A-Za-z0-9.-]+(:[0-9]{1,5})?")


class NewRecipe(BaseModel):
    """A recipe to add. Follow the style guide (get_style_guide)."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(
        description="The recipe's name, in sentence case (see the style guide)"
    )
    category: str = Field(
        description=(
            "Food: mains, sides, desserts, sauces or prep. "
            "Drinks: cocktails, mocktails, syrups or prep."
        )
    )
    servings: int = Field(description="How many it serves; amounts are for this many")
    time_minutes: int | None = Field(
        default=None, description="Total time in minutes, or leave out if unknown"
    )
    ingredients: list[DraftIngredient] = Field(
        description="Ingredients in metric units only (see the style guide for units)"
    )
    steps: list[str] = Field(
        default_factory=list,
        description="The method, one short step each (see the style guide)",
    )
    tags: list[str] = Field(
        default_factory=list,
        description="Tags, reusing the ones already in use (see the style guide)",
    )


class RecipeChanges(BaseModel):
    """What to change in a recipe. A field you leave out stays as it is.

    A list (ingredients, steps, tags) replaces the whole list, so send all of
    it. Follow the style guide (get_style_guide).
    """

    model_config = ConfigDict(extra="forbid")

    # The defaults are never used: `model_fields_set` tells a field that was
    # left out from one that was sent, so null is refused where it is no value.
    name: str = Field(default=None, description="The new name, in sentence case")
    category: str = Field(
        default=None,
        description=(
            "Food: mains, sides, desserts, sauces or prep. "
            "Drinks: cocktails, mocktails, syrups or prep."
        ),
    )
    servings: int = Field(default=None, description="How many it serves")
    time_minutes: int | None = Field(
        default=None, description="Total time in minutes, or null to clear it"
    )
    ingredients: list[DraftIngredient] = Field(
        default=None,
        description=(
            "All the ingredients, replacing the old ones; metric units only "
            "(see the style guide for units)"
        ),
    )
    steps: list[str] = Field(
        default=None, description="All the steps, replacing the old ones"
    )
    tags: list[str] = Field(
        default=None, description="All the tags, replacing the old ones"
    )
    source_url: str | None = Field(
        default=None,
        description=(
            "The web page the recipe comes from, or null to remove the link "
            "(a source photo stays)"
        ),
    )


def lower_first(sentence: str) -> str:
    return sentence[:1].lower() + sentence[1:]


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

    def saved(recipe: Recipe, ctx: Context, warnings: list[str]) -> dict[str, Any]:
        """The result of a write: where the recipe is, and anything left undone."""
        path = f"/{recipe.side}/{recipe.slug}"
        result: dict[str, Any] = {
            "side": recipe.side,
            "slug": recipe.slug,
            "version": store.derived(recipe.side, recipe.slug)["version"],
            "path": path,
        }
        host = (ctx.headers or {}).get("host", "")
        if HOST.fullmatch(host):
            result["link"] = f"https://{host}{path}"
        return {**result, "photo": recipe.image is not None, "warnings": warnings}

    async def fetch_photo(
        source_url: str | None,
        image_url: str | None,
        lead: str = "Saved without a photo",
    ) -> tuple[str | None, list[str]]:
        """Fetch and park a photo; the name, and a warning if there is none."""
        if not (image_url or source_url):
            return None, []
        try:
            url = image_url
            if url is None and source_url is not None:
                url = await fetcher.page_image_url(source_url)
            if url is None:
                return None, [f"{lead}: {NO_PHOTO}"]
            return uploads.save_detected(await fetcher.image(url)), []
        except (FetchError, UnsupportedImage, ImageTooLarge) as err:
            return None, [f"{lead}: {lower_first(str(err))}"]
        except OSError:
            raise  # the disk would fail the save too: SAVE_FAILED
        except Exception:
            log.exception("fetching a recipe photo failed")
            return None, [f"{lead}: {PHOTO_FAILED}"]

    @server.tool()
    async def add_recipe(
        side: Literal["food", "drinks"],
        recipe: NewRecipe,
        ctx: Context,
        source_url: str | None = None,
        image_url: str | None = None,
    ) -> dict[str, Any]:
        """Add a recipe. Read the style guide first and follow it.

        Give source_url when the recipe comes from a web page: it is kept as the
        recipe's source and the page's main photo is fetched and attached.
        image_url attaches a photo from that link instead. If no photo can be
        fetched the recipe is still saved, with a warning. A recipe already
        saved with the same source_url on that side is refused.
        """
        source_url = (source_url or "").strip() or None
        image_url = (image_url or "").strip() or None
        try:
            draft = parse_draft(
                {
                    **recipe.model_dump(),
                    "source": {"url": source_url} if source_url else None,
                    "image": None,
                }
            )
            # Everything the store would refuse is refused before any fetch.
            store.check(side, draft)
            if source_url and (other := store.with_source(side, source_url)):
                # Early, to skip the fetch; create checks again under its lock.
                raise ToolError(already_saved(other.slug))
            name, warnings = await fetch_photo(source_url, image_url)
            created = store.create(
                side,
                draft.model_copy(update={"image": name}),
                "claude",
                unique_source=True,
            )
        except ValueError as err:
            raise ToolError(str(err)) from None
        except SaveIncomplete:
            raise ToolError(SAVE_INCOMPLETE) from None
        except OSError:
            raise ToolError(SAVE_FAILED) from None
        return saved(created, ctx, warnings)

    def merged(
        current: Recipe, changes: RecipeChanges, image: str | None
    ) -> RecipeDraft:
        """The recipe as an editor draft, with only the given fields changed."""
        fields = {
            **current.model_dump(exclude={"slug", "side", "marks", "format_version"}),
            "image": image,
        }
        for name in changes.model_fields_set - {"source_url"}:
            fields[name] = getattr(changes, name)
        if "source_url" in changes.model_fields_set:
            url = (changes.source_url or "").strip() or None
            photo = current.source.photo if current.source else None
            fields["source"] = {"url": url, "photo": photo} if url or photo else None
        return parse_draft(fields)

    @server.tool()
    async def edit_recipe(
        side: Literal["food", "drinks"],
        slug: str,
        version: int,
        changes: RecipeChanges,
        ctx: Context,
        image_url: str | None = None,
        remove_image: bool = False,
    ) -> dict[str, Any]:
        """Edit a recipe. Read it first with read_recipe and pass its version.

        Read the style guide first and follow it. changes holds only the fields
        to change; a field you leave out stays as it is, and a list replaces the
        whole list. If the recipe was changed since you read it the edit is
        refused: read it again and redo the change. image_url replaces the
        photo with the one at that link (if it cannot be fetched the old photo
        stays, with a warning); remove_image removes the photo. Use one of them
        at most.
        """
        image_url = (image_url or "").strip() or None
        if image_url and remove_image:
            raise ToolError("Pass image_url or remove_image, not both")
        current = store.get(side, slug)
        if current is None:
            raise ToolError(f"No recipe {slug!r} on the {side} side")
        try:
            latest = store.derived(side, slug)["version"]
            if version != latest:
                # Early, to skip the fetch; update checks again under its lock.
                raise VersionConflict(latest)
            draft = merged(current, changes, None if remove_image else current.image)
            # Everything the store would refuse is refused before any fetch.
            store.check(side, draft, slug)
            warnings: list[str] = []
            if image_url:
                name, warnings = await fetch_photo(
                    None, image_url, lead="Saved without the new photo"
                )
                if name is not None:
                    draft = draft.model_copy(update={"image": name})
            updated = store.update(side, slug, draft, "claude", base_version=version)
            if updated is None:
                raise ToolError(f"No recipe {slug!r} on the {side} side")
        except VersionConflict as err:
            raise ToolError(
                f"The recipe changed since you read it (it is now version "
                f"{err.current}); read it again and redo the change"
            ) from None
        except ValueError as err:
            raise ToolError(str(err)) from None
        except SaveIncomplete:
            raise ToolError(SAVE_INCOMPLETE) from None
        except OSError:
            raise ToolError(SAVE_FAILED) from None
        return saved(updated, ctx, warnings)

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
