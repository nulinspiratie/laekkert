"""Ingredient catalog: reference data at <data_dir>/catalog/ingredients.json.

It is the registry of ingredient identities: how many grams a level teaspoon of
an ingredient weighs (so the web app can show a metric amount as tsp/tbsp),
whether it is fresh, and, for drinks, what kind of bottle it is. Names match
regardless of case, accents and spacing. Like recipes, the file can be edited by
hand on the NAS, so for lookups a file that is missing, unreadable or from a
newer app version means an empty catalog (with a warning) instead of an error.
The file is re-read whenever its mtime changes. Writing is stricter: `raw()` and
`save_raw()` refuse to touch a file they cannot read, so a hand edit is never
overwritten by a guess.
"""

import json
import logging
import shutil
import unicodedata
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.recipes.files import atomic_write

# The catalog file has its own format, independent of the recipe format.
CATALOG_FORMAT_VERSION = 1

SEED_CATALOG = (
    Path(__file__).resolve().parent.parent / "seed" / "catalog" / ("ingredients.json")
)

UNAVAILABLE = (
    "The ingredient catalog can't be read, so the bar can't be changed. "
    "Fix catalog/ingredients.json on the NAS."
)

log = logging.getLogger("app.recipes")


Kind = Literal["spirits", "liqueurs", "aperitifs", "bitters", "syrups", "other"]
KINDS: tuple[Kind, ...] = (
    "spirits",
    "liqueurs",
    "aperitifs",
    "bitters",
    "syrups",
    "other",
)


class CatalogUnavailable(OSError):
    """The catalog file exists but cannot be read, so it must not be rewritten."""


class CatalogEntry(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str = Field(min_length=1)
    aliases: list[str] = []
    g_per_tsp: float | None = Field(default=None, gt=0)
    fresh: bool = False
    kind: Kind | None = None


def name_key(name: str) -> str:
    """Identity of an ingredient name: no accents, case or spacing differences."""
    plain = "".join(
        c for c in unicodedata.normalize("NFKD", name) if not unicodedata.combining(c)
    )
    return " ".join(plain.casefold().split())


class Catalog:
    def __init__(self, data_dir: Path):
        self.path = Path(data_dir) / "catalog" / "ingredients.json"
        self._mtime_ns: int | None = None
        self._entries: dict[str, CatalogEntry] = {}
        self._ordered: list[CatalogEntry] = []

    def g_per_tsp(self, item: str) -> float | None:
        entry = self.entry(item)
        return entry.g_per_tsp if entry else None

    def entry(self, name: str) -> CatalogEntry | None:
        """The entry with this name or alias; the first in the file wins."""
        self._current()
        return self._entries.get(name_key(name))

    def entries(self) -> list[CatalogEntry]:
        """Every valid entry once, in file order."""
        self._current()
        return list(self._ordered)

    def raw(self) -> list[dict]:
        """The file's `ingredients` list exactly as parsed, valid or not.

        `[]` when there is no file. A file that exists but cannot be understood
        raises `CatalogUnavailable`, so nobody writes over it.
        """
        try:
            text = self.path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return []
        except OSError as exc:
            raise CatalogUnavailable(UNAVAILABLE) from exc
        try:
            data = json.loads(text)
            version = data["format_version"]
            ingredients = data["ingredients"]
        except (ValueError, KeyError, TypeError) as exc:
            raise CatalogUnavailable(UNAVAILABLE) from exc
        if (
            not isinstance(version, int)
            or isinstance(version, bool)
            or version > CATALOG_FORMAT_VERSION
            or not isinstance(ingredients, list)
        ):
            raise CatalogUnavailable(UNAVAILABLE)
        return ingredients

    def save_raw(self, entries: list[dict]) -> None:
        """Write the `ingredients` list, keeping any other top-level keys."""
        self.raw()  # refuse to overwrite a file we cannot read
        try:
            extra = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            extra = {}
        data = {
            **extra,
            "format_version": CATALOG_FORMAT_VERSION,
            "ingredients": entries,
        }
        text = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
        atomic_write(self.path, text.encode("utf-8"))
        self._mtime_ns = None

    def seed_if_missing(self, source: Path = SEED_CATALOG) -> bool:
        """Copy the bundled catalog in when there is none; True if it did."""
        if self.path.exists():
            return False
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, self.path)
        except OSError as exc:
            log.warning(
                "could not seed the ingredient catalog into %s: %s", self.path, exc
            )
            return False
        log.info("seeded the ingredient catalog into %s", self.path)
        return True

    def _current(self) -> None:
        try:
            mtime_ns = self.path.stat().st_mtime_ns
        except OSError:
            mtime_ns = None
        if mtime_ns != self._mtime_ns:
            self._ordered = self._load() if mtime_ns is not None else []
            self._entries = {}
            for entry in self._ordered:
                for name in (entry.name, *entry.aliases):
                    self._entries.setdefault(name_key(name), entry)
            self._mtime_ns = mtime_ns

    def _load(self) -> list[CatalogEntry]:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            version = data["format_version"]
            raw_entries = data["ingredients"]
        except (OSError, ValueError, KeyError, TypeError) as exc:
            log.warning("ignoring %s: %s", self.path, exc)
            return []
        if not isinstance(version, int) or version > CATALOG_FORMAT_VERSION:
            log.warning(
                "ignoring %s: format_version %r is not supported", self.path, version
            )
            return []
        if not isinstance(raw_entries, list):
            log.warning("ignoring %s: ingredients must be a list", self.path)
            return []
        entries: list[CatalogEntry] = []
        for raw in raw_entries:
            try:
                entry = CatalogEntry.model_validate(raw)
            except ValidationError as exc:
                log.warning("skipping a catalog entry in %s: %s", self.path, exc)
                continue
            entries.append(entry)
        return entries
