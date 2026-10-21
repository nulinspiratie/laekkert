"""The readable diff stored with each edit: a short list of what the person changed."""

from difflib import SequenceMatcher

from app.recipes.model import Ingredient, Recipe, Step
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
        *_notes(old, new),
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
    """Match rows by item, within the same group first; repeated items pair up in order.

    An item may sit in several groups, so a row first looks for the same item in
    the same group. What is left pairs by item alone, which is how a row that
    moved or whose group was renamed is still found.

    Returns (old index, new index) pairs in new order, then the unmatched new
    indexes and the unmatched old indexes.
    """
    matched: dict[int, int] = {}  # new index -> old index
    taken: set[int] = set()
    for same_group in (True, False):
        waiting: dict[tuple[str, str], list[int]] = {}
        for i, ingredient in enumerate(old):
            if i not in taken:
                group = ingredient.group if same_group else ""
                waiting.setdefault((_key(ingredient), group), []).append(i)
        for j, ingredient in enumerate(new):
            if j in matched:
                continue
            group = ingredient.group if same_group else ""
            candidates = waiting.get((_key(ingredient), group))
            if candidates:
                i = candidates.pop(0)
                matched[j] = i
                taken.add(i)
    pairs = [(i, j) for j, i in sorted(matched.items())]
    added = [j for j in range(len(new)) if j not in matched]
    removed = [i for i in range(len(old)) if i not in taken]
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


def _renames(
    moves: list[tuple[str, str]], old: set[str], new: set[str]
) -> dict[str, str]:
    """Groups that were renamed, as {old name: new name}.

    A group that is gone is renamed when everything that was in it and survives
    went to one group that did not exist before. Anything else is a set of moves.
    """
    renames: dict[str, str] = {}
    for group in old - new - {""}:
        went_to = {b for a, b in moves if a == group}
        if len(went_to) == 1:
            (target,) = went_to
            if target and target not in old:
                renames[group] = target
    return renames


def _rename_lines(renames: dict[str, str]) -> list[str]:
    return [f"group “{a}” → “{b}”" for a, b in sorted(renames.items())]


def _moved(what: str, a: str, b: str) -> str:
    if not a:
        return f"{what} moved to “{b}”"
    if not b:
        return f"{what} moved out of “{a}”"
    return f"{what} moved from “{a}” to “{b}”"


def _is_move(a: str, b: str, renames: dict[str, str]) -> bool:
    """Whether a kept row went to another group for a reason other than a rename."""
    return a != b and renames.get(a) != b


def _ingredients(old: Recipe, new: Recipe) -> list[Change]:
    pairs, added, removed = _pair_rows(old.ingredients, new.ingredients)
    moves = [(old.ingredients[i].group, new.ingredients[j].group) for i, j in pairs]
    renames = _renames(
        moves,
        {ingredient.group for ingredient in old.ingredients},
        {ingredient.group for ingredient in new.ingredients},
    )
    changes = [_change("ingredients", "changed", t) for t in _rename_lines(renames)]
    for i, j in pairs:
        a, b = old.ingredients[i], new.ingredients[j]
        for text in _row_changes(a, b):
            changes.append(_change("ingredients", "changed", text))
        if _is_move(a.group, b.group, renames):
            moved = _moved(b.item.strip(), a.group, b.group)
            changes.append(_change("ingredients", "changed", moved))
    for j in added:
        changes.append(_change("ingredients", "added", _whole(new.ingredients[j])))
    for i in removed:
        changes.append(_change("ingredients", "removed", _whole(old.ingredients[i])))
    old_positions = [i for i, _ in pairs]
    if old_positions != sorted(old_positions):
        changes.append(_change("ingredients", "changed", "ingredients reordered"))
    return changes


def _step(number: int, step: Step) -> str:
    text = step.text
    if len(text) > STEP_PREVIEW:
        text = text[:STEP_PREVIEW] + "…"
    return f"step {number}: {text}"


def _method(old: Recipe, new: Recipe) -> list[Change]:
    matcher = SequenceMatcher(
        None,
        [s.text for s in old.steps],
        [s.text for s in new.steps],
        autojunk=False,
    )
    opcodes = matcher.get_opcodes()
    # Steps whose text is unchanged are the same step, so a group change is a move.
    kept = [
        (i1 + k, j1 + k)
        for op, i1, i2, j1, _ in opcodes
        if op == "equal"
        for k in range(i2 - i1)
    ]
    moves = [(old.steps[i].group, new.steps[j].group) for i, j in kept]
    renames = _renames(
        moves,
        {step.group for step in old.steps},
        {step.group for step in new.steps},
    )
    lines = _rename_lines(renames)
    for (a, b), (_, j) in zip(moves, kept, strict=True):
        if _is_move(a, b, renames):
            lines.append(_moved(f"step {j + 1}", a, b))
    changes = [_change("method", "changed", text) for text in lines]
    for op, i1, i2, j1, j2 in opcodes:
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


def _notes(old: Recipe, new: Recipe) -> list[Change]:
    hit = _swap(old.notes, new.notes, "notes added", "notes removed", "notes changed")
    return [_change("notes", hit[0], hit[1])] if hit else []


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
