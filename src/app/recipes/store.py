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

# The recipe's own data; never served as a "file", whatever the recipe declares.
DATA_FILES = {"recipe.json", "timeline.jsonl"}
# Only raster images are served: an SVG or HTML file would run script on our origin.
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".heic"}


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

    def file_path(self, side: str, slug: str, name: str) -> Path | None:
        """The image or source photo a recipe declares, if it is on disk.

        Only the exact name the recipe declares is served, and only when it is a
        plain raster image file name that resolves to a regular file inside the
        recipe folder.
        """
        recipe = self.get(side, slug)
        if recipe is None:
            return None
        declared = {recipe.image, recipe.source.photo if recipe.source else None}
        if (
            name not in declared
            or not name
            or name in DATA_FILES
            or name.startswith(".")
            or "/" in name
            or "\\" in name
            or Path(name).suffix.lower() not in IMAGE_SUFFIXES
        ):
            return None
        folder = (self.recipes_dir / side / slug).resolve()
        try:
            path = (folder / name).resolve()
        except (OSError, ValueError):
            return None
        # A symlink may not lead out of the folder or onto the recipe's data.
        if path.parent != folder or path.name in DATA_FILES or not path.is_file():
            return None
        return self.recipes_dir / side / slug / name

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
