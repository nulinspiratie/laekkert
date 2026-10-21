"""Recipe file format.

Every recipe.json carries `format_version`. `parse_recipe` upgrades older files
step by step through MIGRATIONS (keyed by the version migrated *from*) before
validating, and refuses files from a newer app version instead of guessing.
"""

import re
from collections.abc import Callable
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.recipes.catalog import name_key

FORMAT_VERSION = 3

GROUP_MAX = 60
NOTES_MAX = 5000

Side = Literal["food", "drinks"]
SIDES: tuple[Side, ...] = ("food", "drinks")

CATEGORIES: dict[Side, tuple[str, ...]] = {
    "food": ("mains", "sides", "desserts", "sauces", "prep"),
    "drinks": ("cocktails", "mocktails", "syrups", "prep"),
}

# Metric only. tsp/tbsp are a display choice, never a stored unit.
Unit = Literal["g", "ml", "piece", "dash", "pinch", "to taste"]
MEASURED_UNITS = ("g", "ml", "piece", "dash")

Mark = Literal["tried", "favourite", "try_next"]

SLUG_PATTERN = r"^[a-z0-9]+(-[a-z0-9]+)*$"

# What lists show: everything but ingredients, steps, notes and source.
SUMMARY_FIELDS = {
    "slug",
    "name",
    "side",
    "category",
    "time_minutes",
    "tags",
    "marks",
    "image",
}


def is_valid_slug(slug: str) -> bool:
    return re.fullmatch(SLUG_PATTERN, slug) is not None


class Ingredient(BaseModel):
    model_config = ConfigDict(extra="forbid")

    amount: float | None = Field(default=None, gt=0)
    unit: Unit
    item: str = Field(min_length=1)
    note: str = ""
    no_scale: bool = False
    # The amount as written ("1 tsp") when no metric conversion exists yet.
    original: str = ""
    # The heading it sits under ("Sauce"); empty means no group.
    group: str = Field("", max_length=GROUP_MAX)

    @model_validator(mode="after")
    def _measured_needs_amount(self) -> "Ingredient":
        if self.unit in MEASURED_UNITS and self.amount is None and not self.original:
            raise ValueError(f"{self.unit} needs an amount or the original as written")
        return self


class Step(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1)
    # The heading it sits under ("Day before"); empty means no group.
    group: str = Field("", max_length=GROUP_MAX)


class Source(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: str | None = None
    photo: str | None = None


class Recipe(BaseModel):
    model_config = ConfigDict(extra="forbid")

    format_version: int
    slug: str = Field(pattern=SLUG_PATTERN)
    side: Side
    name: str = Field(min_length=1)
    category: str
    servings: int = Field(ge=1)
    time_minutes: int | None = Field(default=None, ge=0)
    ingredients: list[Ingredient] = Field(min_length=1)
    steps: list[Step] = []
    notes: str = Field("", max_length=NOTES_MAX)
    source: Source | None = None
    tags: list[str] = []
    marks: list[Mark] = []
    image: str | None = None

    @model_validator(mode="after")
    def _check(self) -> "Recipe":
        if self.format_version != FORMAT_VERSION:
            raise ValueError(f"format_version must be {FORMAT_VERSION}")
        if self.category not in CATEGORIES[self.side]:
            allowed = ", ".join(CATEGORIES[self.side])
            raise ValueError(f"category for {self.side} must be one of {allowed}")
        # "mocktails" is the category; a tag saying it again adds nothing.
        own = {name_key(self.category)}
        if self.category.endswith("s"):
            own.add(name_key(self.category[:-1]))
        self.tags = [t for t in self.tags if name_key(t) not in own]
        return self

    def summary(self) -> dict:
        return self.model_dump(mode="json", include=SUMMARY_FIELDS)


class NewerFormatError(ValueError):
    """The file was written by a newer version of the app."""


# Format 1 had two kid marks. Format 2 keeps them as regular tags.
_V1_KID_MARK_TAGS = {"kid_approved": "kid approved", "kid_rejected": "kids rejected"}


def _migrate_1_to_2(data: dict) -> dict:
    marks = data.get("marks", [])
    tags = data.get("tags", [])
    if not isinstance(marks, list) or not isinstance(tags, list):
        # Let validation report the bad shape.
        return {**data, "format_version": 2}
    new_tags = list(tags)
    for mark, tag in _V1_KID_MARK_TAGS.items():
        if mark in marks and tag not in new_tags:
            new_tags.append(tag)
    return {
        **data,
        "marks": [m for m in marks if m not in _V1_KID_MARK_TAGS],
        "tags": new_tags,
        "format_version": 2,
    }


# Format 3 turned steps into objects (so they can sit under a group) and added
# groups on ingredients and steps, and recipe notes. All of them default to empty.
def _migrate_2_to_3(data: dict) -> dict:
    steps = data.get("steps")
    if not isinstance(steps, list):
        # Let validation report the bad shape.
        return {**data, "format_version": 3}
    # Anything that is not a string is left for validation to refuse.
    steps = [{"text": s} if isinstance(s, str) else s for s in steps]
    return {**data, "steps": steps, "format_version": 3}


MIGRATIONS: dict[int, Callable[[dict], dict]] = {
    1: _migrate_1_to_2,
    2: _migrate_2_to_3,
}


def parse_recipe(data: object) -> Recipe:
    if not isinstance(data, dict):
        raise ValueError("a recipe must be a JSON object")
    version = data.get("format_version")
    if isinstance(version, bool) or not isinstance(version, int):
        raise ValueError("format_version is missing or not an integer")
    if version > FORMAT_VERSION:
        raise NewerFormatError(
            f"format_version {version} is newer than this app ({FORMAT_VERSION})"
        )
    steps = range(version, FORMAT_VERSION)
    if version < 1 or any(v not in MIGRATIONS for v in steps):
        raise ValueError(f"format_version {version} is not supported")
    for v in steps:
        data = MIGRATIONS[v](data)
    return Recipe.model_validate(data)
