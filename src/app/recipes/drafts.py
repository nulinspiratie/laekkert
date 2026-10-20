"""The editor's draft of a recipe, and how it becomes a stored Recipe.

The form sends what the person typed: blank rows, stray spaces, tsp and tbsp.
`to_recipe` cleans that up and turns any problem into one plain sentence the
form can show as it is.
"""

import re
import unicodedata
from typing import Literal

from pydantic import BaseModel, ConfigDict, ValidationError, model_validator

from app.recipes.catalog import Catalog
from app.recipes.model import (
    FORMAT_VERSION,
    Ingredient,
    Mark,
    Recipe,
    Side,
    Source,
    Unit,
)


class DraftIngredient(Ingredient):
    """An ingredient row as typed: tsp and tbsp allowed, and not yet checked.

    The checks (name, amount) run in `to_recipe`, after blank rows are dropped,
    so their messages can name the row.
    """

    unit: Unit | Literal["tsp", "tbsp"]  # type: ignore[assignment]
    amount: float | None = None
    item: str = ""

    @model_validator(mode="after")
    def _measured_needs_amount(self) -> "DraftIngredient":
        return self


class RecipeDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    category: str
    servings: int
    time_minutes: int | None
    ingredients: list[DraftIngredient]
    steps: list[str]
    source: Source | None
    tags: list[str]
    image: str | None


def _blank(row: DraftIngredient) -> bool:
    return not (
        row.item.strip()
        or row.amount is not None
        or row.note.strip()
        or row.original.strip()
    )


def _normal_tags(tags: list[str]) -> list[str]:
    seen: dict[str, None] = {}
    for tag in tags:
        tag = " ".join(tag.split()).lower()
        if tag:
            seen[tag] = None
    return list(seen)


def _metric(row: DraftIngredient, catalog: Catalog) -> tuple[float, Unit]:
    """tsp/tbsp as grams when the catalog knows the density, else millilitres."""
    assert row.amount is not None
    tsp = row.amount * (3 if row.unit == "tbsp" else 1)
    density = catalog.g_per_tsp(row.item)
    if density is None:
        return tsp * 5, "ml"
    grams = tsp * density
    grams = round(grams, 1) if grams < 10 else float(round(grams))
    return max(grams, 0.1), "g"


def _row(number: int, row: DraftIngredient, catalog: Catalog) -> Ingredient:
    amount, unit = row.amount, row.unit
    if unit in ("tsp", "tbsp"):
        if amount is None:
            raise ValueError(f"Ingredient {number} needs an amount in {unit}")
        if amount <= 0:
            raise ValueError(f"Ingredient {number} needs an amount above 0")
        amount, unit = _metric(row, catalog)
    try:
        return Ingredient(
            amount=amount,
            unit=unit,  # type: ignore[arg-type]
            item=row.item.strip(),
            note=row.note.strip(),
            no_scale=row.no_scale,
            original=row.original.strip(),
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
            steps=[s for s in (s.strip() for s in draft.steps) if s],
            source=source,
            tags=_normal_tags(draft.tags),
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
