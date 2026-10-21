"""MCP server, so Claude (on the phone too) can read, add and edit recipes."""

import contextlib
import logging
import re
from collections.abc import Iterator
from importlib import resources
from typing import Any, Literal

from mcp.server.mcpserver import Context, MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from pydantic import BaseModel, ConfigDict, Field

from app.api import SAVE_FAILED, SAVE_INCOMPLETE, bar_changes, with_bar
from app.recipes.bar import MAX_NAMES, TOO_MANY, Bar, BarView, InventoryUnavailable
from app.recipes.catalog import KINDS, Catalog, CatalogUnavailable
from app.recipes.drafts import DraftIngredient, DraftStep, RecipeDraft, parse_draft
from app.recipes.fetch import Fetcher, FetchError
from app.recipes.have import HAVE_FOOD_ONLY, clean_terms, rank
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
    "resource) and follow it. Amounts are metric (g, ml). Every new recipe gets a "
    "photo: when the source has none, search the web for one (see the style guide)."
    " The drinks side has a bar (read_bar, manage_inventory). Only bottles are "
    "tracked; fresh items, syrups and mixers never are, and ‘can make’ means "
    "every tracked bottle is in."
    " You can list the ingredient names in use (list_ingredients) and merge names "
    "that are the same ingredient (merge_ingredients); recipes keep their wording."
)

# Package data, so it is in the wheel and the image (the Dockerfile copies no docs/).
STYLE_GUIDE = (resources.files("app") / "style_guide.md").read_text(encoding="utf-8")

Sort = Literal["relevance", "name", "time", "rating", "recently_made"]
BarStatus = Literal["can_make"]

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
    steps: list[str | DraftStep] = Field(
        default_factory=list,
        description=(
            "The method, one short step each: a string, or text and group for a "
            "recipe in parts (see the style guide)"
        ),
    )
    notes: str = Field(
        default="",
        description=(
            "Shown under the method: tips, variations, storage; new lines are "
            "kept, **bold**, *italic* and '- ' bullets (see the style guide)"
        ),
    )
    tags: list[str] = Field(
        default_factory=list,
        description="Tags, reusing the ones already in use (see the style guide)",
    )


class RecipeChanges(BaseModel):
    """What to change in a recipe. A field you leave out stays as it is.

    A list (ingredients, steps, tags) replaces the whole list, groups
    included, so send all of it. Follow the style guide (get_style_guide).
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
    steps: list[str | DraftStep] = Field(
        default=None,
        description=(
            "All the steps, replacing the old ones: each a string, or text and "
            "group for a recipe in parts"
        ),
    )
    notes: str = Field(
        default=None,
        description=(
            "Shown under the method: tips, variations, storage; new lines are "
            "kept, **bold**, *italic* and '- ' bullets; replacing the old ones; "
            "an empty string clears them"
        ),
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


@contextlib.contextmanager
def bar_refusals() -> Iterator[None]:
    """Turn what the bar refuses, or cannot read, into a ToolError with its sentence."""
    try:
        yield
    except (CatalogUnavailable, InventoryUnavailable) as err:
        raise ToolError(str(err)) from None
    except ValueError as err:  # BarError, and the sentence of an invalid change
        raise ToolError(str(err)) from None
    except OSError:
        raise ToolError(SAVE_FAILED) from None


def build_mcp(
    store: RecipeStore,
    catalog: Catalog,
    uploads: UploadStore,
    fetcher: Fetcher,
    bar: Bar,
) -> MCPServer:
    server = MCPServer("laekkert", instructions=INSTRUCTIONS)

    def entry(recipe: Recipe, view: BarView | None = None) -> dict:
        """A summary; a drink's has its bar status when there is a view."""
        summary = {**recipe.summary(), **store.derived(recipe.side, recipe.slug)}
        return summary if view is None else with_bar(summary, recipe, view)

    def view_for(side: str) -> BarView | None:
        """The bar, read once per call; only drinks have one."""
        return bar.view() if side == "drinks" else None

    @server.tool()
    def list_recipes(side: Literal["food", "drinks"]) -> list[dict]:
        """List the recipes on one side (food or drinks), sorted by name.

        Each entry has slug, name, side, category, time_minutes, tags, marks,
        image, rating (stars, or null if unrated), last_made (when it was last
        made, or null) and version. Cocktails and mocktails also have bar:
        whether the bar can make them (status can_make, missing or unsorted),
        which tracked bottles are missing or unsorted, and which ingredients
        are untracked. Syrups and prep have bar null. Use read_recipe with the
        slug for ingredients and steps.
        """
        view = view_for(side)
        return [entry(r, view) for r in store.list(side)]

    @server.tool()
    def search_recipes(
        side: Literal["food", "drinks"],
        query: str = "",
        tags: list[str] = Field(default_factory=list),  # noqa: B008
        marks: list[Mark] = Field(default_factory=list),  # noqa: B008
        category: str | None = None,
        sort: Sort = "relevance",
        limit: int = Field(20, ge=1, le=50),
        bar: BarStatus | None = None,
        have: list[str] = Field(default_factory=list),  # noqa: B008
    ) -> list[dict]:
        """Search the recipes on one side, with the same entries as list_recipes.

        query matches names, ingredients, tags and category, and forgives typos.
        tags and marks (tried, favourite, try_next) each narrow the result to
        recipes that have all of them. category is matched ignoring case. sort is
        relevance (best match first), name, time (shortest first), rating
        (highest first) or recently_made (latest first); recipes without a
        time, rating or made date come last. At most limit entries come back.
        bar (drinks only) keeps the cocktails and mocktails the bar can make
        now (can_make); syrups and prep are left out. Mocktails are a category
        (category="mocktails"), not a tag.
        have (food only) lists ingredients on hand, like ["chicken", "leeks"]:
        it keeps recipes that use at least one, fewest missing first, instead of
        sort. Each entry then has have: matched and missing ingredients (salt to
        taste and water are assumed, never missing).
        """
        if bar is not None and side != "drinks":
            raise ToolError("The bar filter is for drinks only.")
        terms = clean_terms(have)
        if terms and side != "food":
            raise ToolError(HAVE_FOOD_ONLY)
        view = view_for(side)
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
            if bar is not None:
                status = view.status(recipe)
                if status is None or status["status"] != bar:
                    continue
            found.append(recipe)
        if terms:
            return [
                {**entry(recipe, view), "have": result.json()}
                for recipe, result in rank(found, terms, catalog)[:limit]
            ]
        return order([entry(r, view) for r in found], sort)[:limit]

    @server.tool()
    def read_recipe(side: Literal["food", "drinks"], slug: str) -> dict[str, Any]:
        """Read one recipe in full: servings, ingredients (metric), steps, source.

        Ingredients and steps each have a group ("" for none), the part of the
        recipe they belong to. notes are tips shown under the method ("" for
        none). Also has rating, last_made and version. Pass version to
        edit_recipe, so an edit made on an old copy is refused.
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
    def read_bar() -> dict[str, Any]:
        """Read the bar: the drink ingredients the household has or doesn't have.

        Only bottles are tracked. items lists every ingredient the drinks use
        with name, aliases (other names that mean it), kind, tracked (false for
        fresh items, syrups and anything Lækkert has a recipe for),
        untracked_because (syrups, recipe, marked or null when tracked), state
        (have, dont or null when not sorted yet; always null when untracked),
        used_in (the drinks that use it) and recipe (the recipe that makes it,
        or null). set_up is false until something has been sorted. counts says
        how many cocktails and mocktails (total) can be made (can_make), are
        missing a tracked bottle (missing) or have an unsorted one (unsorted).
        Use manage_inventory to change it.
        """
        return bar.view().json()

    @server.tool()
    def manage_inventory(
        have: list[str] = Field(default_factory=list),  # noqa: B008
        dont_have: list[str] = Field(default_factory=list),  # noqa: B008
        untrack: list[str] = Field(default_factory=list),  # noqa: B008
        track: list[str] = Field(default_factory=list),  # noqa: B008
        kinds: dict[str, str] = Field(default_factory=dict),  # noqa: B008
        add_names: dict[str, list[str]] = Field(default_factory=dict),  # noqa: B008
        remove_names: dict[str, list[str]] = Field(default_factory=dict),  # noqa: B008
        fold: dict[str, str] = Field(default_factory=dict),  # noqa: B008
    ) -> dict[str, Any]:
        """Change the bar, all or nothing, and return it as read_bar does.

        Every argument is optional. have and dont_have mark bottles the household
        has or doesn't have. Only bottles are tracked: fresh items such as limes
        and mint, syrups and anything Lækkert has a recipe for are not, so they
        are neither had nor not had, and have or dont_have on them is skipped.
        untrack marks an item as not tracked, and track undoes that; track is
        refused for a syrup (give it another kind first) and for an item
        Lækkert has a recipe for. Names in have, dont_have and untrack that the
        bar doesn't know yet are added. kinds sets an item's kind (spirits,
        liqueurs, aperitifs, bitters, syrups or other), keyed by item name; a
        new name in have or dont_have can be given its kind here too.
        add_names and remove_names give an item other names, keyed by item name.
        fold maps an item to the item it is a duplicate of: the first is merged
        into the second and its name becomes another name for it. Names are
        matched ignoring case and accents. If any part of the change is refused
        nothing is changed.
        """
        with bar_refusals():
            # Checked here, not in the schema, so the refusal is a sentence.
            for kind in kinds.values():
                if kind not in KINDS:
                    raise ToolError(
                        f"‘{kind}’ isn't a kind. Use {', '.join(KINDS[:-1])} or "
                        f"{KINDS[-1]}."
                    )
            changes = bar_changes(
                {
                    "have": have,
                    "dont_have": dont_have,
                    "untrack": untrack,
                    "track": track,
                    "kinds": kinds,
                    "add_names": add_names,
                    "remove_names": remove_names,
                    "fold": fold,
                }
            )
            # Claude cannot delete: the tool has no delete, and the bar refuses too.
            return bar.apply(changes, allow_delete=False).json()

    @server.tool()
    def list_ingredients(
        side: Literal["food", "drinks"] | None = None,
    ) -> list[dict[str, Any]]:
        """List every ingredient in use, sorted by name.

        Each entry has name, other_names (its aliases and the other spellings
        recipes use for it), recipes (how many food and drinks recipes use it),
        in_catalog, g_per_tsp, fresh and kind. Give side to list only what that
        side uses; without it, catalog entries no recipe uses are listed too.
        Look for names that are the same ingredient (plurals, spellings,
        synonyms) and merge them with merge_ingredients. Ingredients that are
        only similar, such as chicken thighs and chicken breast, are not the
        same: don't merge them.
        """
        with bar_refusals():
            return bar.ingredients(side)

    @server.tool()
    def merge_ingredients(
        merges: dict[str, str] = Field(default_factory=dict),  # noqa: B008
        separate: list[str] = Field(default_factory=list),  # noqa: B008
    ) -> dict[str, Any]:
        """Merge names that are the same ingredient, all or nothing.

        merges maps a name to the name it merges into, for example
        {"leeks": "leek", "cilantro": "coriander"}: the first becomes another
        name of the second, so a search or a what-you-have list for one finds
        the other. separate lists names to make their own ingredient again.
        Recipes are not changed and keep their wording. Both names must be
        ingredients in use (list_ingredients). A name on the bar, such as a
        bottle a drink uses, can't be merged here: fold it with
        manage_inventory. Chains in one call, or a name merged and separated,
        are refused. Returns {"ingredients": [...]}: the list_ingredients entry
        for each name merged into and each name separated, in call order. If
        any part is refused nothing is changed.
        """
        with bar_refusals():
            # Counted here, as the bar counts a change, so a huge call is refused early.
            if len(merges) * 2 + len(separate) > MAX_NAMES:
                raise ToolError(TOO_MANY)
            return {"ingredients": bar.merge_ingredients(merges, separate)}

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
        fetched the recipe is still saved, with a warning. Every new recipe
        gets a photo: with no source, or a source without one, find one on the
        web (see the style guide). A recipe already saved with the same
        source_url on that side is refused.
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
