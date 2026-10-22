"""The editor's draft of a recipe, and how it becomes a stored Recipe.

The form sends what the person typed: blank rows, stray spaces, tsp and tbsp.
`to_recipe` cleans that up and turns any problem into one plain sentence the
form can show as it is.
"""

import re
import unicodedata
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from app.recipes.catalog import Catalog
from app.recipes.model import (
    FORMAT_VERSION,
    GROUP_MAX,
    NOTES_MAX,
    Ingredient,
    Mark,
    Recipe,
    Side,
    Source,
    Step,
    Unit,
)

# Far beyond any recipe, but small enough that no conversion can overflow.
MAX_AMOUNT = 100_000
MAX_SERVINGS = 1000
MAX_MINUTES = 7 * 24 * 60  # a week

# Said on both group fields, so Claude's tool schemas carry it.
GROUP_HELP = (
    "A heading to sit under, such as 'Sauce' or 'Day before'; empty for none. "
    "Keep rows of one group together, in order (see the style guide)."
)


class DraftIngredient(Ingredient):
    """An ingredient row as typed: tsp and tbsp allowed, and not yet checked.

    The checks (name, amount) run in `to_recipe`, after blank rows are dropped,
    so their messages can name the row.
    """

    unit: Unit | Literal["tsp", "tbsp"] = Field(  # type: ignore[assignment]
        description=(
            "Metric only: g, ml, piece, dash, pinch, to taste; tsp/tbsp are "
            "converted. Convert cups and ounces first (see the style guide)."
        )
    )
    amount: float | None = Field(default=None, allow_inf_nan=False, le=MAX_AMOUNT)
    item: str = ""
    # Longer than GROUP_MAX is refused in `to_recipe` with a sentence, after tidying.
    group: str = Field(default="", max_length=None, description=GROUP_HELP)

    @model_validator(mode="after")
    def _measured_needs_amount(self) -> "DraftIngredient":
        # Deliberately disables the parent check so to_recipe can number the error.
        return self


class DraftStep(BaseModel):
    """A method step as typed, with the group it sits under."""

    model_config = ConfigDict(extra="forbid")

    text: str
    group: str = Field(default="", description=GROUP_HELP)


class RecipeDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    category: str
    servings: int = Field(ge=1, le=MAX_SERVINGS)
    time_minutes: int | None = Field(ge=0, le=MAX_MINUTES)
    ingredients: list[DraftIngredient]
    steps: list[str | DraftStep]
    notes: str = ""
    source: Source | None
    tags: list[str]
    image: str | None


def parse_draft(data: object) -> RecipeDraft:
    """Validate a JSON-decoded request body; raises ValueError with one sentence."""
    try:
        return RecipeDraft.model_validate(data)
    except ValidationError as err:
        raise ValueError(_draft_sentence(err)) from None


def _draft_sentence(err: ValidationError) -> str:
    first = err.errors()[0]
    loc, kind = first["loc"], first["type"]
    unknown = f"has an unknown field: {loc[-1] if loc else ''}"
    if len(loc) >= 2 and loc[0] == "ingredients" and isinstance(loc[1], int):
        who = f"Ingredient {loc[1] + 1}"
        if kind == "extra_forbidden":
            return f"{who} {unknown}"
        if len(loc) >= 3 and loc[2] == "unit":
            return f"{who} has an unknown unit"
        if len(loc) >= 3 and loc[2] == "amount":
            if kind == "less_than_equal":
                return f"{who}'s amount is too large"
            return f"{who} needs a number for the amount"
        return f"{who} isn't valid"
    if kind == "extra_forbidden" and len(loc) == 1:
        return f"The recipe {unknown}"
    if loc == ("servings",):
        if kind == "less_than_equal":
            return f"Servings can be at most {MAX_SERVINGS}"
        return "Servings must be at least 1"
    if loc == ("time_minutes",):
        if kind == "greater_than_equal":
            return "Cooking time can't be negative"
        if kind == "less_than_equal":
            return "Cooking time can be at most a week"
        return "Cooking time must be a whole number of minutes"
    if loc == ("name",):
        return "Give the recipe a name"
    return "The recipe isn't valid"


def _blank(row: DraftIngredient) -> bool:
    return not (
        row.item.strip()
        or row.amount is not None
        or row.note.strip()
        or row.original.strip()
    )


def normal_tag(tag: str) -> str:
    """A tag as it is saved: lowercase, single spaces."""
    return " ".join(tag.split()).lower()


def normal_tags(tags: list[str]) -> list[str]:
    """The tags as saved, without blanks or repeats, in their first order."""
    seen: dict[str, None] = {}
    for tag in tags:
        tag = normal_tag(tag)
        if tag:
            seen[tag] = None
    return list(seen)


def _metric(row: DraftIngredient, catalog: Catalog) -> tuple[float, Unit]:
    """tsp/tbsp as grams when the catalog knows the density, else millilitres."""
    assert row.amount is not None
    tsp = row.amount * (3 if row.unit == "tbsp" else 1)
    density = catalog.g_per_tsp(row.item)
    if density is None:
        # 1 tsp is exactly 5 ml; round away float noise (0.1 tbsp is 1.5 ml).
        return round(tsp * 5, 6), "ml"
    grams = _half_up(tsp * density, 1 if tsp * density < 10 else 0)
    return max(grams, 0.1), "g"


def _half_up(value: float, places: int) -> float:
    exact = Decimal(str(round(value, 6)))
    return float(exact.quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP))


def _group(name: str) -> str:
    group = " ".join(name.split())
    if len(group) > GROUP_MAX:
        raise ValueError(f"A group name can be at most {GROUP_MAX} characters")
    return group


def _steps(steps: list[str | DraftStep]) -> list[Step]:
    """Steps tidied; a blank step goes, and its group with it."""
    drafts = [DraftStep(text=s) if isinstance(s, str) else s for s in steps]
    return [
        Step(text=step.text.strip(), group=_group(step.group))
        for step in drafts
        if step.text.strip()
    ]


def _notes(notes: str) -> str:
    """Trailing spaces and surrounding blank lines go; blank lines inside stay."""
    tidy = "\n".join(line.rstrip() for line in notes.splitlines()).strip()
    if len(tidy) > NOTES_MAX:
        raise ValueError(f"The notes can be at most {NOTES_MAX} characters")
    return tidy


def _row(number: int, row: DraftIngredient, catalog: Catalog) -> Ingredient:
    amount, unit = row.amount, row.unit
    if unit in ("tsp", "tbsp"):
        if amount is None:
            raise ValueError(f"Ingredient {number} needs an amount in {unit}")
        if amount <= 0:
            raise ValueError(f"Ingredient {number} needs an amount above 0")
        amount, unit = _metric(row, catalog)
    group = _group(row.group)
    try:
        return Ingredient(
            amount=amount,
            unit=unit,  # type: ignore[arg-type]
            item=row.item.strip(),
            note=row.note.strip(),
            no_scale=row.no_scale,
            original=row.original.strip(),
            group=group,
        )
    except ValidationError as err:
        first = err.errors()[0]
        field = first["loc"][0] if first["loc"] else None
        if field == "item":
            raise ValueError(f"Ingredient {number} needs a name") from None
        if field == "amount":
            raise ValueError(f"Ingredient {number} needs an amount above 0") from None
        raise ValueError(f"Ingredient {number} needs an amount in {unit}") from None


def _source(source: Source | None) -> Source | None:
    url = (source.url or "").strip() if source else ""
    photo = (source.photo or "").strip() if source else ""
    if url and not re.match(r"https?://", url, re.IGNORECASE):
        raise ValueError("The source link must start with http:// or https://")
    return Source(url=url or None, photo=photo or None) if url or photo else None


def _sentence(err: ValidationError) -> str:
    first = err.errors()[0]
    field = first["loc"][0] if first["loc"] else None
    if field == "servings":
        return "Servings must be at least 1"
    if field == "time_minutes":
        return "Cooking time can't be negative"
    if field == "slug":
        return "The recipe link name isn't valid"
    if field is None and first["type"] == "value_error":
        message = str(first["ctx"]["error"])
        return message[:1].upper() + message[1:]
    return "The recipe isn't valid"


def to_recipe(
    draft: RecipeDraft,
    *,
    side: Side,
    slug: str,
    marks: list[Mark],
    catalog: Catalog,
) -> Recipe:
    """Clean up a draft and validate it; raises ValueError with one sentence."""
    name = draft.name.strip()
    if not name:
        raise ValueError("Give the recipe a name")
    # Numbered by position in the form, blank rows included.
    ingredients = [
        _row(number, row, catalog)
        for number, row in enumerate(draft.ingredients, start=1)
        if not _blank(row)
    ]
    if not ingredients:
        raise ValueError("Add at least one ingredient")
    steps = _steps(draft.steps)
    notes = _notes(draft.notes)
    source = _source(draft.source)
    try:
        return Recipe(
            format_version=FORMAT_VERSION,
            slug=slug,
            side=side,
            name=name,
            category=draft.category,
            servings=draft.servings,
            time_minutes=draft.time_minutes,
            ingredients=ingredients,
            steps=steps,
            notes=notes,
            source=source,
            tags=normal_tags(draft.tags),
            marks=marks,
            image=(draft.image or "").strip() or None,
        )
    except ValidationError as err:
        raise ValueError(_sentence(err)) from None


_LETTERS = str.maketrans(
    {"æ": "ae", "ø": "o", "œ": "oe", "ß": "ss", "ł": "l", "đ": "d"}
)
SLUG_MAX = 60


def slugify(name: str) -> str:
    text = name.lower().translate(_LETTERS)
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = text.encode("ascii", "ignore").decode()
    slug = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    if len(slug) > SLUG_MAX:
        cut = slug[:SLUG_MAX]
        # Back up to a dash unless the cut already fell on one.
        if slug[SLUG_MAX] != "-" and "-" in cut:
            cut = cut.rsplit("-", 1)[0]
        slug = cut.strip("-")
    return slug or "recipe"
