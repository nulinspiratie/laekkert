"""Recipe file format.

Every recipe.json carries `format_version`. `parse_recipe` upgrades older files
step by step through MIGRATIONS (keyed by the version migrated *from*) before
validating, and refuses files from a newer app version instead of guessing.
"""

import re
from collections.abc import Callable
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

FORMAT_VERSION = 1

Side = Literal["food", "drinks"]
SIDES: tuple[Side, ...] = ("food", "drinks")

CATEGORIES: dict[Side, tuple[str, ...]] = {
    "food": ("mains", "sides", "desserts", "sauces", "prep"),
    "drinks": ("cocktails", "mocktails", "syrups", "prep"),
}

# Metric only. tsp/tbsp are a display choice, never a stored unit.
Unit = Literal["g", "ml", "piece", "dash", "pinch", "to taste"]
MEASURED_UNITS = ("g", "ml", "piece", "dash")

Mark = Literal["tried", "favourite", "try_next", "kid_approved", "kid_rejected"]

SLUG_PATTERN = r"^[a-z0-9]+(-[a-z0-9]+)*$"

# What lists show: everything but ingredients, steps and source.
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

    @model_validator(mode="after")
    def _measured_needs_amount(self) -> "Ingredient":
        if self.unit in MEASURED_UNITS and self.amount is None and not self.original:
            raise ValueError(f"{self.unit} needs an amount or the original as written")
        return self


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
    steps: list[str] = []
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
        return self

    def summary(self) -> dict:
        return self.model_dump(mode="json", include=SUMMARY_FIELDS)


class NewerFormatError(ValueError):
    """The file was written by a newer version of the app."""


MIGRATIONS: dict[int, Callable[[dict], dict]] = {}


def parse_recipe(data: dict) -> Recipe:
    version = data.get("format_version")
    if isinstance(version, bool) or not isinstance(version, int):
        raise ValueError("format_version is missing or not an integer")
    if version > FORMAT_VERSION:
        raise NewerFormatError(
            f"format_version {version} is newer than this app ({FORMAT_VERSION})"
        )
    for v in range(version, FORMAT_VERSION):
        data = MIGRATIONS[v](data)
    return Recipe.model_validate(data)
