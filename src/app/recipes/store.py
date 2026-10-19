"""Recipes on disk: one folder per recipe at <data_dir>/recipes/<side>/<slug>/.

Reads go to disk every time; there are few enough recipes that no index is
needed yet. A file that cannot be read or validated is skipped with a warning
instead of taking the whole list down, since files on the NAS can be edited by
hand.
"""

import json
import logging
import shutil
from pathlib import Path

from app.recipes.model import SIDES, Recipe, Side, is_valid_slug, parse_recipe

SEED_DIR = Path(__file__).resolve().parent.parent / "seed" / "recipes"

log = logging.getLogger("app.recipes")


class RecipeStore:
    def __init__(self, data_dir: Path):
        self.recipes_dir = Path(data_dir) / "recipes"

    def list(self, side: Side) -> list[Recipe]:
        side_dir = self.recipes_dir / side
        if not side_dir.is_dir():
            return []
        recipes = []
        for folder in sorted(side_dir.iterdir()):
            if folder.is_dir() and (recipe := self._load(side, folder.name)):
                recipes.append(recipe)
        return sorted(recipes, key=lambda r: r.name.casefold())

    def get(self, side: str, slug: str) -> Recipe | None:
        if side not in SIDES or not is_valid_slug(slug):
            return None
        return self._load(side, slug)

    def seed_if_empty(self, source: Path = SEED_DIR) -> bool:
        """Copy the bundled recipes in when there are none; True if it did."""
        if any(self.recipes_dir.glob("*/*/recipe.json")):
            return False
        try:
            shutil.copytree(source, self.recipes_dir, dirs_exist_ok=True)
        except OSError as exc:
            log.warning(
                "could not seed example recipes into %s: %s", self.recipes_dir, exc
            )
            return False
        log.info("seeded example recipes into %s", self.recipes_dir)
        return True

    def _load(self, side: Side, slug: str) -> Recipe | None:
        path = self.recipes_dir / side / slug / "recipe.json"
        if not path.is_file():
            return None
        try:
            recipe = parse_recipe(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, ValueError) as exc:
            log.warning("skipping %s: %s", path, exc)
            return None
        if (recipe.side, recipe.slug) != (side, slug):
            log.warning(
                "skipping %s: it says %s/%s but lives in %s/%s",
                path,
                recipe.side,
                recipe.slug,
                side,
                slug,
            )
            return None
        return recipe
