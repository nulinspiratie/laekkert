"""The per-recipe timeline: <recipe folder>/timeline.jsonl, one JSON entry per line.

Entries are appended, never edited. The file can be edited by hand on the NAS, so
a line that does not parse (or has an unknown kind) is skipped with a warning
instead of taking the history down, and is kept when the file is rewritten.
"""

import logging
import secrets
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Literal

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    TypeAdapter,
    ValidationError,
)

from app.recipes.files import atomic_write
from app.recipes.model import Mark

log = logging.getLogger(__name__)

TIMELINE_FILE = "timeline.jsonl"

Via = Literal["app", "claude"]


def _half_star(value: float) -> float:
    if not 0.5 <= value <= 5 or (value * 2) % 1 != 0:
        raise ValueError("a rating is 0.5 to 5 in half steps")
    return value


Stars = Annotated[float, AfterValidator(_half_star)]
# Stripped, then 1-2000 characters.
NoteText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)
]
# Stripped, then at most 2000 characters; may be empty.
OptionalNote = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]


class Change(BaseModel):
    """One line of the readable diff of an edit."""

    model_config = ConfigDict(extra="ignore")

    section: Literal[
        "details", "ingredients", "method", "notes", "source", "tags", "photo"
    ]
    kind: Literal["added", "removed", "changed"]
    text: str


class _Base(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(pattern=r"^[0-9a-f]{12}$")
    # UTC, ISO 8601, seconds, e.g. 2026-10-20T14:03:12Z
    at: str = Field(pattern=r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")
    via: Via


class Created(_Base):
    kind: Literal["created"] = "created"
    version: int = Field(ge=1)


class Baseline(_Base):
    kind: Literal["baseline"] = "baseline"
    version: int = Field(ge=1)


class Edit(_Base):
    kind: Literal["edit"] = "edit"
    version: int = Field(ge=1)
    changes: list[Change] = []
    restored_from: int | None = Field(default=None, ge=1)


class Note(_Base):
    kind: Literal["note"] = "note"
    text: NoteText


class Rating(_Base):
    kind: Literal["rating"] = "rating"
    rating: Stars
    previous: Stars | None = None


class Made(_Base):
    kind: Literal["made"] = "made"
    rating: Stars | None = None
    note: OptionalNote = ""


class Marks(_Base):
    kind: Literal["marks"] = "marks"
    added: list[Mark] = []
    removed: list[Mark] = []


Entry = Annotated[
    Created | Baseline | Edit | Note | Rating | Made | Marks,
    Field(discriminator="kind"),
]

_entry_adapter: TypeAdapter[Entry] = TypeAdapter(Entry)


def read_timeline(folder: Path) -> list[Entry]:
    """The recipe's entries, oldest first. A missing file is an empty timeline."""
    path = Path(folder) / TIMELINE_FILE
    try:
        raw = path.read_bytes()
    except FileNotFoundError:
        return []
    entries: list[Entry] = []
    # Split on b"\n" only: str.splitlines() would also cut at U+2028, U+0085 and
    # friends, which JSON output leaves raw inside strings.
    for number, line in enumerate(raw.split(b"\n"), start=1):
        line = line.removesuffix(b"\r")
        if not line.strip():
            continue
        try:
            entries.append(_entry_adapter.validate_json(line))
        except ValidationError as err:
            log.warning("skipping %s line %d: %s", path, number, _why(err))
    return entries


def _why(err: ValidationError) -> str:
    first = err.errors()[0]
    where = ".".join(str(p) for p in first["loc"])
    return f"{where}: {first['msg']}" if where else first["msg"]


def append_entries(folder: Path, entries: list[Entry]) -> None:
    """Add entries to the end of the file, rewriting it whole and atomically.

    Existing lines are kept as they are, including ones this app can't read.
    """
    path = Path(folder) / TIMELINE_FILE
    try:
        existing = path.read_bytes()
    except FileNotFoundError:
        existing = b""
    if existing and not existing.endswith(b"\n"):
        existing += b"\n"
    added = "".join(entry.model_dump_json() + "\n" for entry in entries)
    atomic_write(path, existing + added.encode("utf-8"))


def new_entry(kind_model: type[_Base], via: Via, **fields) -> Entry:
    """A fresh entry with a new id and the current time."""
    return kind_model(
        id=secrets.token_hex(6),
        at=datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        via=via,
        **fields,
    )


def current_rating(entries: list[Entry]) -> float | None:
    """The latest `rating` entry, or `made` entry that carries a rating."""
    for entry in reversed(entries):
        if entry.kind in ("rating", "made") and entry.rating is not None:
            return entry.rating
    return None


def last_made(entries: list[Entry]) -> str | None:
    """The `at` of the latest `made` entry."""
    for entry in reversed(entries):
        if entry.kind == "made":
            return entry.at
    return None
