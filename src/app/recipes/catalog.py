"""Ingredient catalog: reference data at <data_dir>/catalog/ingredients.json.

Today it only knows how many grams a level teaspoon of an ingredient weighs, so
the web app can show a metric amount as tsp/tbsp. Like recipes, the file can be
edited by hand on the NAS, so a file that is missing, unreadable or from a newer
app version means an empty catalog (with a warning) instead of an error. The
file is re-read whenever its mtime changes.
"""

import json
import logging
import shutil
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, ValidationError

# The catalog file has its own format, independent of the recipe format.
CATALOG_FORMAT_VERSION = 1

SEED_CATALOG = (
    Path(__file__).resolve().parent.parent / "seed" / "catalog" / ("ingredients.json")
)

log = logging.getLogger("app.recipes")


class CatalogEntry(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str = Field(min_length=1)
    aliases: list[str] = []
    g_per_tsp: float | None = Field(default=None, gt=0)
    fresh: bool = False


def _key(name: str) -> str:
    return name.strip().casefold()


class Catalog:
    def __init__(self, data_dir: Path):
        self.path = Path(data_dir) / "catalog" / "ingredients.json"
        self._mtime_ns: int | None = None
        self._entries: dict[str, CatalogEntry] = {}

    def g_per_tsp(self, item: str) -> float | None:
        entry = self._current().get(_key(item))
        return entry.g_per_tsp if entry else None

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

    def _current(self) -> dict[str, CatalogEntry]:
        try:
            mtime_ns = self.path.stat().st_mtime_ns
        except OSError:
            mtime_ns = None
        if mtime_ns != self._mtime_ns:
            self._entries = self._load() if mtime_ns is not None else {}
            self._mtime_ns = mtime_ns
        return self._entries

    def _load(self) -> dict[str, CatalogEntry]:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            version = data["format_version"]
            raw_entries = data["ingredients"]
        except (OSError, ValueError, KeyError, TypeError) as exc:
            log.warning("ignoring %s: %s", self.path, exc)
            return {}
        if not isinstance(version, int) or version > CATALOG_FORMAT_VERSION:
            log.warning(
                "ignoring %s: format_version %r is not supported", self.path, version
            )
            return {}
        if not isinstance(raw_entries, list):
            log.warning("ignoring %s: ingredients must be a list", self.path)
            return {}
        entries: dict[str, CatalogEntry] = {}
        for raw in raw_entries:
            try:
                entry = CatalogEntry.model_validate(raw)
            except ValidationError as exc:
                log.warning("skipping a catalog entry in %s: %s", self.path, exc)
                continue
            for name in (entry.name, *entry.aliases):
                entries.setdefault(_key(name), entry)
        return entries
