"""The readable diff stored with each edit: a short list of what the person changed."""

from difflib import SequenceMatcher

from app.recipes.model import Ingredient, Recipe
from app.recipes.timeline import Change

STEP_PREVIEW = 80


def describe_changes(old: Recipe, new: Recipe) -> list[Change]:
    """What changed between two versions; empty when the content is the same.

    Marks, format version, slug and side are not content and are ignored.
    """
    return [
        *_details(old, new),
        *_ingredients(old, new),
        *_method(old, new),
        *_source(old, new),
        *_tags(old, new),
        *_photo(old, new),
    ]


def _change(section: str, kind: str, text: str) -> Change:
    return Change(section=section, kind=kind, text=text)  # type: ignore[arg-type]


def _details(old: Recipe, new: Recipe) -> list[Change]:
    out: list[str] = []
    if old.name != new.name:
        out.append(f"name “{old.name}” → “{new.name}”")
    if old.category != new.category:
        out.append(f"category {old.category} → {new.category}")
    if old.servings != new.servings:
        out.append(f"servings {old.servings} → {new.servings}")
    if old.time_minutes != new.time_minutes:
        if old.time_minutes is not None and new.time_minutes is not None:
            out.append(f"time {old.time_minutes} → {new.time_minutes} min")
        else:
            out.append(f"time {_time(old.time_minutes)} → {_time(new.time_minutes)}")
    return [_change("details", "changed", text) for text in out]


def _time(minutes: int | None) -> str:
    return "no time" if minutes is None else f"{minutes} min"


def _key(ingredient: Ingredient) -> str:
    return ingredient.item.strip().casefold()


def _amount(ingredient: Ingredient) -> str:
    """The amount as a person reads it: "25 ml", the original as written, "to taste"."""
    if ingredient.unit == "to taste":
        return "to taste"
    if ingredient.amount is not None:
        return f"{ingredient.amount:g} {ingredient.unit}"
    return ingredient.original or ingredient.unit


def _whole(ingredient: Ingredient) -> str:
    """A whole row, for added and removed ingredients."""
    if ingredient.unit == "to taste":
        text = f"{ingredient.item}, to taste"
    else:
        text = f"{_amount(ingredient)} {ingredient.item}"
    return f"{text} ({ingredient.note})" if ingredient.note else text


def _pair_rows(
    old: list[Ingredient], new: list[Ingredient]
) -> tuple[list[tuple[int, int]], list[int], list[int]]:
    """Match rows by item; repeated items pair up in order.

    Returns (old index, new index) pairs in new order, then the unmatched new
    indexes and the unmatched old indexes.
    """
    waiting: dict[str, list[int]] = {}
    for i, ingredient in enumerate(old):
        waiting.setdefault(_key(ingredient), []).append(i)
    pairs: list[tuple[int, int]] = []
    added: list[int] = []
    for j, ingredient in enumerate(new):
        candidates = waiting.get(_key(ingredient))
        if candidates:
            pairs.append((candidates.pop(0), j))
        else:
            added.append(j)
    matched_old = {i for i, _ in pairs}
    removed = [i for i in range(len(old)) if i not in matched_old]
    return pairs, added, removed


def _row_changes(a: Ingredient, b: Ingredient) -> list[str]:
    out: list[str] = []
    if a.item.strip() != b.item.strip():
        out.append(f"ingredient “{a.item.strip()}” → “{b.item.strip()}”")
    item = b.item.strip()
    if a.unit == b.unit and a.amount is not None and b.amount is not None:
        if a.amount != b.amount:
            out.append(f"{item} {a.amount:g} → {b.amount:g} {b.unit}")
    elif _amount(a) != _amount(b):
        out.append(f"{item} {_amount(a)} → {_amount(b)}")
    if a.note != b.note:
        out.append(f"{item}: note “{a.note}” → “{b.note}”")
    if a.no_scale != b.no_scale:
        out.append(f"{item}: don't scale {'on' if b.no_scale else 'off'}")
    return out


def _ingredients(old: Recipe, new: Recipe) -> list[Change]:
    pairs, added, removed = _pair_rows(old.ingredients, new.ingredients)
    changes: list[Change] = []
    for i, j in pairs:
        for text in _row_changes(old.ingredients[i], new.ingredients[j]):
            changes.append(_change("ingredients", "changed", text))
    for j in added:
        changes.append(_change("ingredients", "added", _whole(new.ingredients[j])))
    for i in removed:
        changes.append(_change("ingredients", "removed", _whole(old.ingredients[i])))
    old_positions = [i for i, _ in pairs]
    if old_positions != sorted(old_positions):
        changes.append(_change("ingredients", "changed", "ingredients reordered"))
    return changes


def _step(number: int, text: str) -> str:
    if len(text) > STEP_PREVIEW:
        text = text[:STEP_PREVIEW] + "…"
    return f"step {number}: {text}"


def _method(old: Recipe, new: Recipe) -> list[Change]:
    changes: list[Change] = []
    matcher = SequenceMatcher(None, old.steps, new.steps, autojunk=False)
    for op, i1, i2, j1, j2 in matcher.get_opcodes():
        if op == "equal":
            continue
        shared = min(i2 - i1, j2 - j1) if op == "replace" else 0
        for k in range(shared):
            changes.append(
                _change("method", "changed", _step(j1 + k + 1, new.steps[j1 + k]))
            )
        for j in range(j1 + shared, j2):
            changes.append(_change("method", "added", _step(j + 1, new.steps[j])))
        for i in range(i1 + shared, i2):
            changes.append(_change("method", "removed", _step(i + 1, old.steps[i])))
    return changes


def _swap(old: str | None, new: str | None, added: str, removed: str, changed: str):
    """(kind, text) for a value that may appear, vanish or be replaced."""
    if old == new:
        return None
    if not old:
        return "added", added
    if not new:
        return "removed", removed
    return "changed", changed


def _source(old: Recipe, new: Recipe) -> list[Change]:
    a = old.source.url if old.source else None
    b = new.source.url if new.source else None
    pa = old.source.photo if old.source else None
    pb = new.source.photo if new.source else None
    out = [
        _swap(a, b, "link added", "link removed", "link changed"),
        _swap(
            pa,
            pb,
            "source photo added",
            "source photo removed",
            "source photo replaced",
        ),
    ]
    return [_change("source", *hit) for hit in out if hit]


def _tags(old: Recipe, new: Recipe) -> list[Change]:
    added = [t for t in new.tags if t not in old.tags]
    removed = [t for t in old.tags if t not in new.tags]
    return [
        *(_change("tags", "added", f"“{t}”") for t in added),
        *(_change("tags", "removed", f"“{t}”") for t in removed),
    ]


def _photo(old: Recipe, new: Recipe) -> list[Change]:
    hit = _swap(old.image, new.image, "photo added", "photo removed", "photo replaced")
    return [_change("photo", "changed", hit[1])] if hit else []
