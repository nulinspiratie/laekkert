"""Recipes on disk: one folder per recipe at <data_dir>/recipes/<side>/<slug>/.

Reads go to disk every time; there are few enough recipes that no index is
needed yet. A file that cannot be read or validated is skipped with a warning
instead of taking the whole list down, since files on the NAS can be edited by
hand.

Writes are one transaction per change over the version file(s), `recipe.json`,
`timeline.jsonl` and any photo moved in from the uploads. The old files are kept
as hard links and renamed back if any step fails, so a failed save changes
nothing and putting things back needs no free space. Writes run one at a time under
a lock held by the store, so a version check and the write it guards cannot be split.
"""

from __future__ import annotations

import contextlib
import functools
import json
import logging
import os
import re
import secrets
import shutil
import threading
from collections.abc import Callable, Sequence
from datetime import UTC, datetime
from pathlib import Path

from pydantic import ValidationError

from app.recipes.catalog import Catalog
from app.recipes.diff import describe_changes
from app.recipes.drafts import RecipeDraft, slugify, to_recipe
from app.recipes.files import atomic_write
from app.recipes.model import (
    SIDES,
    Mark,
    Recipe,
    Side,
    is_valid_slug,
    parse_recipe,
)
from app.recipes.timeline import (
    TIMELINE_FILE,
    Baseline,
    Created,
    Edit,
    Entry,
    Made,
    Marks,
    Note,
    Rating,
    Via,
    append_entries,
    current_rating,
    last_made,
    new_entry,
    read_timeline,
)
from app.recipes.uploads import UploadStore

SEED_DIR = Path(__file__).resolve().parent.parent / "seed" / "recipes"

log = logging.getLogger("app.recipes")

# The recipe's own data; never served as a "file", whatever the recipe declares.
DATA_FILES = {"recipe.json", "timeline.jsonl"}
# Only raster images are served: an SVG or HTML file would run script on our origin.
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".heic"}

# The order marks are stored and listed in.
MARK_ORDER: tuple[Mark, ...] = ("favourite", "try_next", "tried")
# `/:side/new` is the editor, so no recipe may have this slug.
RESERVED_SLUGS = {"new"}


def already_saved(slug: str) -> str:
    return f"Already in Lækkert as {slug}; use edit_recipe to change it"


PHOTO_GONE = "That photo is no longer available; pick it again"
RATING_RANGE = "Ratings go from 0.5 to 5 in half stars"
NOTE_TOO_LONG = "A note can be at most 2000 characters"
VERSION_CONFLICT = (
    "This recipe was changed somewhere else since you opened it; "
    "reload it to see the change"
)

_VERSION_FILE = re.compile(r"^(\d{4,})\.json$")


class SaveIncomplete(OSError):
    """A save failed and the rollback could not put everything back."""


class VersionConflict(ValueError):
    """An edit was made on a version that is no longer the current one."""

    def __init__(self, current: int):
        super().__init__(VERSION_CONFLICT)
        self.current = current


def _locked(method: Callable) -> Callable:
    """Run a write method under the store's lock."""

    @functools.wraps(method)
    def wrapper(self, *args, **kwargs):
        with self._lock:
            return method(self, *args, **kwargs)

    return wrapper


def _ordered(marks) -> list[Mark]:
    return [m for m in MARK_ORDER if m in marks]


def _dump(recipe: Recipe) -> bytes:
    text = json.dumps(recipe.model_dump(mode="json"), indent=2, ensure_ascii=False)
    return (text + "\n").encode("utf-8")


def _content(recipe: Recipe) -> dict:
    """What an edit can change: everything but marks and the file format."""
    return recipe.model_dump(exclude={"marks", "format_version"})


def _entry(kind_model, via: Via, **fields) -> Entry:
    """A new timeline entry; bad values become one plain sentence."""
    try:
        return new_entry(kind_model, via, **fields)
    except ValidationError as err:
        first = err.errors()[0]
        field = first["loc"][0] if first["loc"] else None
        if field == "rating":
            raise ValueError(RATING_RANGE) from None
        if field == "text" and first["type"] == "string_too_short":
            raise ValueError("Write something in the note") from None
        raise ValueError(NOTE_TOO_LONG) from None


def _backup_link(path: Path) -> Path | None:
    """Keep `path`'s current file as a hard link beside it, or None if it is absent.

    A link takes no data blocks, and the atomic write that replaces `path`
    leaves the old file under the backup name.
    """
    backup = path.parent / f".tmp-{secrets.token_hex(6)}.bak"
    try:
        os.link(path, backup)
    except FileNotFoundError:
        return None
    except OSError:
        # No link allowed (a file someone else owns, under protected_hardlinks,
        # or a filesystem without links): copy it, still before anything changes.
        try:
            content = path.read_bytes()
        except FileNotFoundError:
            return None
        atomic_write(backup, content)
    return backup


def _rollback(
    folder: Path,
    *,
    new_folder: bool,
    had_versions_dir: bool,
    written: list[Path],
    moved: list[tuple[Path, Path]],
    backups: list[tuple[Path, Path | None]],
) -> list[Path]:
    """Undo a failed `_commit`: put every file and upload back as it was.

    Returns the files that could not be put back; their backup links are left
    where they are, and so are the version files, which may then hold the only
    other copy of the old recipe.
    """
    for src, dst in reversed(moved):
        with contextlib.suppress(OSError):
            os.replace(dst, src)
    if new_folder:
        shutil.rmtree(folder, ignore_errors=True)
        return []
    failed: list[Path] = []
    for path, backup in backups:
        try:
            if backup is None:
                path.unlink(missing_ok=True)
            else:
                os.replace(backup, path)
                # Renaming a file onto its own link does nothing, so a file this
                # save never got to replace still has its backup name.
                with contextlib.suppress(OSError):
                    backup.unlink(missing_ok=True)
        except OSError:
            failed.append(path)
            log.exception(
                "could not restore %s after a failed save; its old content is in %s",
                path,
                backup,
            )
    if failed:
        return failed
    for path in written:
        with contextlib.suppress(OSError):
            path.unlink()
    if not had_versions_dir:
        with contextlib.suppress(OSError):
            (folder / "versions").rmdir()
    return []


class RecipeStore:
    def __init__(self, data_dir: Path, catalog: Catalog, uploads: UploadStore):
        self.data_dir = Path(data_dir)
        self.recipes_dir = self.data_dir / "recipes"
        self.trash_dir = self.data_dir / "trash"
        self._catalog = catalog
        self._uploads = uploads
        self._lock = threading.RLock()

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
        # Deleting every recipe must not bring the examples back.
        if self.trash_dir.is_dir() and any(self.trash_dir.iterdir()):
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

    def timeline(self, side: str, slug: str) -> list[Entry] | None:
        """The recipe's entries, oldest first; None if there is no such recipe."""
        if self.get(side, slug) is None:
            return None
        return read_timeline(self.recipes_dir / side / slug)

    def current_version(self, side: str, slug: str) -> int | None:
        """The highest version number on disk; None if the recipe has no versions."""
        if side not in SIDES or not is_valid_slug(slug):
            return None
        numbers = []
        with contextlib.suppress(OSError):
            for path in (self.recipes_dir / side / slug / "versions").iterdir():
                if match := _VERSION_FILE.match(path.name):
                    numbers.append(int(match.group(1)))
        return max(numbers, default=None)

    def derived(self, side: str, slug: str) -> dict:
        """What the timeline and versions say about a recipe, for the API."""
        entries = self.timeline(side, slug) or []
        return {
            "rating": current_rating(entries),
            "last_made": last_made(entries),
            "version": self.current_version(side, slug) or 0,
        }

    def _validated(self, side: Side, draft: RecipeDraft) -> tuple[str, Recipe]:
        """The free slug and the cleaned-up recipe; raises ValueError (a sentence)."""
        if side not in SIDES:
            raise ValueError("Pick food or drinks")
        slug = self._free_slug(side, draft.name)
        recipe = to_recipe(draft, side=side, slug=slug, marks=[], catalog=self._catalog)
        return slug, recipe

    def check(self, side: Side, draft: RecipeDraft, slug: str | None = None) -> None:
        """Raise the ValueError a save would raise for this draft, saving nothing.

        With `slug`, the draft is checked as an edit of that recipe; without
        it, as a new one.
        """
        if slug is None:
            self._validated(side, draft)
            return
        to_recipe(draft, side=side, slug=slug, marks=[], catalog=self._catalog)

    def with_source(self, side: Side, url: str) -> Recipe | None:
        """The recipe on this side that came from this exact link, if any."""
        for recipe in self.list(side):
            if recipe.source and recipe.source.url == url:
                return recipe
        return None

    @_locked
    def create(
        self,
        side: Side,
        draft: RecipeDraft,
        via: Via,
        *,
        unique_source: bool = False,
    ) -> Recipe:
        """Save a new recipe; with `unique_source`, not if its link is already saved."""
        slug, recipe = self._validated(side, draft)
        if unique_source and recipe.source and recipe.source.url:
            existing = self.with_source(side, recipe.source.url)
            if existing is not None:
                raise ValueError(already_saved(existing.slug))
        moves = self._photo_moves(side, slug, recipe)
        entry = new_entry(Created, via, version=1)
        self._commit(
            self.recipes_dir / side / slug,
            recipe,
            [entry],
            new_version=1,
            moves=moves,
            new_folder=True,
        )
        return recipe

    @_locked
    def update(
        self,
        side: str,
        slug: str,
        draft: RecipeDraft,
        via: Via,
        base_version: int | None = None,
    ) -> Recipe | None:
        """Save an edit; with `base_version`, only if that is still the version."""
        current = self.get(side, slug)
        if current is None:
            return None
        if base_version is not None:
            latest = self.current_version(side, slug) or 0
            if base_version != latest:
                raise VersionConflict(latest)
        recipe = to_recipe(
            draft,
            side=current.side,
            slug=slug,
            marks=_ordered(current.marks),
            catalog=self._catalog,
        )
        if _content(recipe) == _content(current):
            return current
        moves = self._photo_moves(current.side, slug, recipe)
        folder = self.recipes_dir / side / slug
        number = self.current_version(side, slug)
        entries: list[Entry] = []
        baseline = None
        if number is None:
            # Recipes from before versions existed: keep the old state as 0001.
            baseline = (folder / "recipe.json").read_bytes()
            number = 1
            entries.append(new_entry(Baseline, via, version=1))
        number += 1
        entries.append(
            new_entry(
                Edit,
                via,
                version=number,
                changes=describe_changes(current, recipe),
                restored_from=None,
            )
        )
        self._commit(
            folder,
            recipe,
            entries,
            new_version=number,
            baseline=baseline,
            moves=moves,
        )
        return recipe

    @_locked
    def restore(self, side: str, slug: str, version: int, via: Via) -> Recipe | None:
        """Write version `version` as a new version; the marks stay as they are."""
        current = self.get(side, slug)
        if current is None or version < 1:
            return None
        folder = self.recipes_dir / side / slug
        try:
            old = parse_recipe(
                json.loads(
                    (folder / "versions" / f"{version:04d}.json").read_text("utf-8")
                )
            )
            recipe = Recipe.model_validate(
                {
                    **old.model_dump(),
                    "slug": slug,
                    "side": current.side,
                    "marks": _ordered(current.marks),
                }
            )
        except (OSError, ValueError):
            return None
        number = (self.current_version(side, slug) or 0) + 1
        entry = new_entry(
            Edit,
            via,
            version=number,
            changes=describe_changes(current, recipe),
            restored_from=version,
        )
        self._commit(folder, recipe, [entry], new_version=number)
        return recipe

    @_locked
    def delete(self, side: str, slug: str) -> bool:
        """Move the recipe's folder to trash/<side>/<slug>-<UTC stamp>/."""
        if self.get(side, slug) is None:
            return False
        stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
        target = self.trash_dir / side / f"{slug}-{stamp}"
        extra = 1
        while target.exists():
            extra += 1
            target = self.trash_dir / side / f"{slug}-{stamp}-{extra}"
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(self.recipes_dir / side / slug, target)
        return True

    @_locked
    def set_marks(
        self, side: str, slug: str, add: list[Mark], remove: list[Mark], via: Via
    ) -> Recipe | None:
        current = self.get(side, slug)
        if current is None:
            return None
        if set(add) & set(remove):
            raise ValueError("A mark can't be added and taken off at once")
        if "favourite" in add and "tried" in remove:
            raise ValueError("A favourite has to be tried")
        added, removed = set(add), set(remove)
        # Favourite implies tried; taking off tried takes off favourite.
        if "favourite" in added:
            added.add("tried")
        if "tried" in removed:
            removed.add("favourite")
        before = set(current.marks)
        after = (before | added) - removed
        if after == before:
            return current
        entry = _entry(
            Marks,
            via,
            added=_ordered(after - before),
            removed=_ordered(before - after),
        )
        recipe = current.model_copy(update={"marks": _ordered(after)})
        self._commit(self.recipes_dir / side / slug, recipe, [entry])
        return recipe

    @_locked
    def add_note(self, side: str, slug: str, text: str, via: Via) -> Entry | None:
        if self.get(side, slug) is None:
            return None
        entry = _entry(Note, via, text=text)
        # Only the timeline changes, and that write is atomic by itself.
        append_entries(self.recipes_dir / side / slug, [entry])
        return entry

    @_locked
    def add_rating(self, side: str, slug: str, rating: float, via: Via) -> Entry | None:
        if self.get(side, slug) is None:
            return None
        previous = current_rating(read_timeline(self.recipes_dir / side / slug))
        entry = _entry(Rating, via, rating=rating, previous=previous)
        self._taste(side, slug, entry)
        return entry

    @_locked
    def add_made(
        self, side: str, slug: str, rating: float | None, note: str, via: Via
    ) -> Entry | None:
        if self.get(side, slug) is None:
            return None
        entry = _entry(Made, via, rating=rating, note=note)
        self._taste(side, slug, entry)
        return entry

    def _taste(self, side: str, slug: str, entry: Entry) -> None:
        """A tasting adds tried and clears try next, without a marks entry."""
        recipe = self.get(side, slug)
        assert recipe is not None
        marks = _ordered((set(recipe.marks) | {"tried"}) - {"try_next"})
        recipe = recipe.model_copy(update={"marks": marks})
        self._commit(self.recipes_dir / side / slug, recipe, [entry])

    def _free_slug(self, side: Side, name: str) -> str:
        base = slugify(name.strip())
        slug, number = base, 1
        while slug in RESERVED_SLUGS or (self.recipes_dir / side / slug).exists():
            number += 1
            slug = f"{base}-{number}"
        return slug

    def _photo_moves(
        self, side: str, slug: str, recipe: Recipe
    ) -> list[tuple[Path, Path]]:
        """Uploads to move in for the recipe's image and source photo.

        A name is fine if the recipe already serves it from its folder, or if
        it is a parked upload; anything else (a path, another recipe's file, a
        file that has gone) is refused.
        """
        folder = self.recipes_dir / side / slug
        moves: dict[str, tuple[Path, Path]] = {}
        for name in (recipe.image, recipe.source.photo if recipe.source else None):
            if name is None or self.file_path(side, slug, name) is not None:
                continue
            parked = self._uploads.path(name)
            if parked is None:
                raise ValueError(PHOTO_GONE)
            moves[name] = (parked, folder / name)
        return list(moves.values())

    def _commit(
        self,
        folder: Path,
        recipe: Recipe,
        entries: list[Entry],
        *,
        new_version: int | None = None,
        baseline: bytes | None = None,
        moves: Sequence[tuple[Path, Path]] = (),
        new_folder: bool = False,
    ) -> None:
        """Write one change as a unit, or leave everything as it was."""
        recipe_path = folder / "recipe.json"
        timeline_path = folder / TIMELINE_FILE
        versions_dir = folder / "versions"
        had_versions_dir = versions_dir.is_dir()
        data = _dump(recipe)
        files: list[tuple[int, bytes]] = []
        if baseline is not None:
            files.append((1, baseline))
        if new_version is not None:
            files.append((new_version, data))
        # Linked before anything is written, so a failure here changes nothing.
        backups: list[tuple[Path, Path | None]] = []
        try:
            for path in (recipe_path, timeline_path):
                backups.append((path, _backup_link(path)))
        except OSError:
            for _, backup in backups:
                if backup is not None:
                    with contextlib.suppress(OSError):
                        backup.unlink()
            raise
        written: list[Path] = []
        moved: list[tuple[Path, Path]] = []
        try:
            for number, content in files:
                path = versions_dir / f"{number:04d}.json"
                atomic_write(path, content)
                written.append(path)
            atomic_write(recipe_path, data)
            append_entries(folder, entries)
            # Uploads move last, so nothing is lost if an earlier step failed.
            for src, dst in moves:
                os.replace(src, dst)
                moved.append((src, dst))
        except BaseException as err:
            failed = _rollback(
                folder,
                new_folder=new_folder,
                had_versions_dir=had_versions_dir,
                written=written,
                moved=moved,
                backups=backups,
            )
            if failed and isinstance(err, Exception):
                names = ", ".join(path.name for path in failed)
                raise SaveIncomplete(f"could not restore {names} in {folder}") from err
            raise
        for _, backup in backups:
            if backup is not None:
                with contextlib.suppress(OSError):
                    backup.unlink()

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
