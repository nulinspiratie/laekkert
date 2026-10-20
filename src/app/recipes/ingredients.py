"""Ingredient identities across food and drinks, and merging their names.

An identity is a catalog entry, or, for item text no entry names, the item's
`name_key`. Names match by `name_key` only: `leek` and `leeks` are two
identities until the catalog says otherwise. As in the bar, an entry whose own
name an earlier entry already takes is left out, so a name means at most one
entry, the first.

`merge` is pure: it takes the catalog's raw entries and returns new ones, and
`Bar.merge_ingredients` reads and writes the files under the bar's lock. A merge
never changes recipes and never moves a name that is on the bar (the bar's fold
does that), so the inventory is never written.
"""

from __future__ import annotations

import copy
from collections.abc import Callable

from pydantic import ValidationError

from app.recipes.catalog import CatalogEntry, name_key
from app.recipes.model import SIDES, Recipe

# The bar's sentence; `bar.py` takes it from here.
EMPTY_NAME = "A name can't be empty."
NOTHING = "Nothing to change."


class IngredientError(ValueError):
    """A merge or separate refused; `str(exc)` is the sentence to show."""


def no_ingredient(a: str) -> str:
    return f"There is no ingredient ‘{a}’."


def same(a: str, b: str) -> str:
    return f"‘{a}’ and ‘{b}’ are already the same ingredient."


def on_bar(a: str) -> str:
    return f"‘{a}’ is on the bar. Fold it there instead (manage_inventory)."


def chain(b: str) -> str:
    return f"Chains aren't allowed in one call: ‘{b}’ is merged and merged into."


def twice(a: str) -> str:
    return f"‘{a}’ is merged twice."


def merged_and_separated(a: str) -> str:
    return f"‘{a}’ can't be merged and separated in one call."


def not_alias(n: str) -> str:
    return f"‘{n}’ isn't another name of anything."


def main_name(n: str) -> str:
    return (
        f"‘{n}’ is the main name of its ingredient. Merge it into another name instead."
    )


def _parse(raw: object) -> CatalogEntry | None:
    try:
        return CatalogEntry.model_validate(raw)
    except ValidationError:
        return None


def _ordered(recipes: dict[str, list[Recipe]]) -> list[Recipe]:
    """Every recipe, food before drinks, each side by name."""
    return [
        recipe
        for side in SIDES
        for recipe in sorted(recipes.get(side, []), key=lambda r: r.name.casefold())
    ]


class Identities:
    """Which identity each name means, for catalog entries (None = invalid) and
    the recipes of both sides; and how many recipes use each."""

    def __init__(
        self, entries: list[CatalogEntry | None], recipes: dict[str, list[Recipe]]
    ):
        self.entries = entries
        self.index: dict[str, int] = {}  # any name's key -> entry position
        self.by_key: dict[str, int] = {}  # identity key -> entry position
        for position, entry in enumerate(entries):
            if entry is None:
                continue
            own = name_key(entry.name)
            if not own or own in self.index:
                continue
            self.by_key[own] = position
            for name in (entry.name, *entry.aliases):
                if key := name_key(name):
                    self.index.setdefault(key, position)
        self.virtual: dict[str, str] = {}  # identity key -> item as first written
        self.in_drinks: dict[
            str, str
        ] = {}  # identity key -> as the first drink writes it
        self.spellings: dict[str, list[str]] = {}  # identity key -> items as written
        self.counts: dict[str, dict[str, int]] = {}  # identity key -> side -> recipes
        for recipe in _ordered(recipes):
            used: set[str] = set()
            for ingredient in recipe.ingredients:
                key = name_key(ingredient.item)
                if not key:
                    continue
                if key not in self.index:
                    self.virtual.setdefault(key, ingredient.item)
                identity = self.key(ingredient.item)
                assert identity is not None
                if recipe.side == "drinks":
                    self.in_drinks.setdefault(identity, ingredient.item)
                self.spellings.setdefault(identity, []).append(ingredient.item)
                if identity not in used:
                    used.add(identity)
                    counts = self.counts.setdefault(identity, dict.fromkeys(SIDES, 0))
                    counts[recipe.side] += 1

    def key(self, name: str) -> str | None:
        """The identity a name means: an entry's own key, an item's key, or None."""
        key = name_key(name)
        if key in self.index:
            entry = self.entries[self.index[key]]
            assert entry is not None
            return name_key(entry.name)
        return key if key in self.virtual else None

    def entry_position(self, key: str) -> int | None:
        return self.by_key.get(key)

    def name(self, key: str) -> str:
        position = self.by_key.get(key)
        if position is None:
            return self.virtual[key]
        entry = self.entries[position]
        assert entry is not None
        return entry.name

    def other_names(self, key: str) -> list[str]:
        """The entry's aliases, then other recipe spellings, each once by key."""
        position = self.by_key.get(key)
        entry = None if position is None else self.entries[position]
        seen = {key}
        names: list[str] = []
        aliases = entry.aliases if entry else []
        for alias in aliases:
            alias_key = name_key(alias)
            if alias_key not in seen and self.index.get(alias_key) == position:
                seen.add(alias_key)
                names.append(alias)
        for spelling in self.spellings.get(key, []):
            if (spelling_key := name_key(spelling)) not in seen:
                seen.add(spelling_key)
                names.append(spelling)
        return names

    def json(self, key: str, name: str | None = None) -> dict:
        """The `list_ingredients` entry. `name` stands in for an identity that no
        longer exists (a separated name no recipe uses): zero counts, no entry."""
        if key not in self.by_key and key not in self.virtual:
            if name is None:
                raise KeyError(key)
            return {
                "name": name,
                "other_names": [],
                "recipes": dict.fromkeys(SIDES, 0),
                "in_catalog": False,
                "g_per_tsp": None,
                "fresh": False,
                "kind": None,
            }
        position = self.by_key.get(key)
        entry = None if position is None else self.entries[position]
        return {
            "name": self.name(key),
            "other_names": self.other_names(key),
            "recipes": dict(self.counts.get(key, dict.fromkeys(SIDES, 0))),
            "in_catalog": entry is not None,
            "g_per_tsp": entry.g_per_tsp if entry else None,
            "fresh": entry.fresh if entry else False,
            "kind": entry.kind if entry else None,
        }

    def all(self, side: str | None) -> list[dict]:
        """Every identity in use on `side`, or, without a side, every identity
        any recipe uses plus every catalog entry; sorted by name."""
        if side is None:
            keys = set(self.counts) | set(self.by_key)
        else:
            keys = {k for k, counts in self.counts.items() if counts[side]}
        listing = [self.json(key) for key in keys]
        return sorted(listing, key=lambda i: (i["name"].casefold(), i["name"]))


def _check_conflicts(pairs: list[tuple[str, str]], separate: list[str]) -> None:
    """Refuse a call that contradicts itself, by `name_key`, before any lookup."""
    names = [name for pair in pairs for name in pair] + separate
    if any(not name_key(name) for name in names):
        raise IngredientError(EMPTY_NAME)
    merged = [name_key(a) for a, _ in pairs]
    for i, (_, b) in enumerate(pairs):
        if any(key == name_key(b) for j, key in enumerate(merged) if j != i):
            raise IngredientError(chain(b))
    seen: set[str] = set()
    for a, _ in pairs:
        if name_key(a) in seen:
            raise IngredientError(twice(a))
        seen.add(name_key(a))
    separated = {name_key(n) for n in separate}
    for a, _ in pairs:
        if name_key(a) in separated:
            raise IngredientError(merged_and_separated(a))
    if not pairs and not separate:
        raise IngredientError(NOTHING)


def _merge(
    raw: list,
    ids: Identities,
    is_on_bar: Callable[[str], bool],
    a: tuple[str, str],
    b_key: str,
) -> list:
    """Merge the identity `a` (its name as given, its key) into `b_key`'s; the
    new raw entries."""
    a_name, a_key = a
    moving = [ids.name(a_key), *ids.other_names(a_key)]
    if any(is_on_bar(name) for name in moving):
        raise IngredientError(on_bar(a_name))
    a_position, b_position = ids.entry_position(a_key), ids.entry_position(b_key)
    a_raw = {} if a_position is None else raw[a_position]
    if b_position is None:
        # Named as the bar names it when a drink uses it, else as recipes do.
        name = ids.in_drinks.get(b_key) or ids.name(b_key)
        target = {"name": name}
    else:
        target = raw[b_position]
    merged = dict(target)
    for field, value in a_raw.items():
        if field not in ("name", "aliases"):
            merged.setdefault(field, value)
    aliases = list(target.get("aliases", []))
    known = {name_key(name) for name in (target["name"], *aliases)}
    for name in moving:
        if name_key(name) not in known:
            known.add(name_key(name))
            aliases.append(name)
    merged["aliases"] = aliases
    result = [
        merged if position == b_position else entry
        for position, entry in enumerate(raw)
        if position != a_position
    ]
    if b_position is None:
        result.append(merged)
    return result


def _separate(raw: list, ids: Identities, n: str) -> list:
    """Take `n` off the entry it is another name of; the new raw entries."""
    key = name_key(n)
    if key in ids.by_key:
        raise IngredientError(main_name(n))
    position = ids.index.get(key)
    if position is None:
        raise IngredientError(not_alias(n))
    result = list(raw)
    entry = dict(raw[position])
    entry["aliases"] = [a for a in entry["aliases"] if name_key(a) != key]
    result[position] = entry
    return result


def merge(
    raw: list[dict],
    recipes: dict[str, list[Recipe]],
    is_on_bar: Callable[[str], bool],
    merges: dict[str, str],
    separate: list[str],
    *,
    after_merges: Callable[[list], None] | None = None,
) -> tuple[list[dict], list[str]]:
    """The catalog's raw entries after the whole call, and the identities it touched.

    `is_on_bar(name)` says whether a name is on the bar now. Conflicts in the
    call's names are refused first, then each merge in order, then each
    separate; any refusal raises `IngredientError` and nothing is returned.
    `after_merges(raw)`, when given, sees the entries after the merges and before
    the separates, and may refuse too. Never writes.
    """
    pairs = [(a.strip(), b.strip()) for a, b in merges.items()]
    names: list[str] = []
    for n in separate:
        if name_key(n) not in {name_key(m) for m in names}:
            names.append(n.strip())
    _check_conflicts(pairs, names)
    result = copy.deepcopy(raw)
    touched: list[str] = []
    # Identities as the call found them: what each A went into, and every B.
    first = Identities([_parse(r) for r in result], recipes)
    moved: dict[str, str] = {}
    targets: set[str] = set()
    for a, b in pairs:
        ids = Identities([_parse(r) for r in result], recipes)
        a_key, b_key = ids.key(a), ids.key(b)
        if a_key is None:
            raise IngredientError(no_ingredient(a))
        if b_key is None:
            raise IngredientError(no_ingredient(b))
        # Every name in use now was in use when the call began.
        first_a, first_b = first.key(a), first.key(b)
        assert first_a is not None and first_b is not None
        if first_a == first_b:
            raise IngredientError(same(a, b))
        if first_a in moved:
            if moved[first_a] != first_b:
                raise IngredientError(twice(a))
            touched.append(b_key)  # already there: nothing more to do
            continue
        if first_a in targets:
            raise IngredientError(chain(a))
        if first_b in moved:
            raise IngredientError(chain(b))
        moved[first_a] = first_b
        targets.add(first_b)
        assert a_key != b_key  # only an earlier merge could join them, refused above
        result = _merge(result, ids, is_on_bar, (a, a_key), b_key)
        touched.append(b_key)
    if after_merges is not None and pairs:
        after_merges(result)
    for n in names:
        ids = Identities([_parse(r) for r in result], recipes)
        result = _separate(result, ids, n)
        touched.append(name_key(n))
    # A later step can fold an earlier one's identity into another.
    final = Identities([_parse(r) for r in result], recipes)
    keys: list[str] = []
    for key in touched:
        key = final.key(key) or key
        if key not in keys:
            keys.append(key)
    return result, keys


def touched_json(ids: Identities, keys: list[str], separate: list[str]) -> list[dict]:
    """The `list_ingredients` entry of each key `merge` returned, in its order.

    A separated name no recipe uses is no identity any more; it is shown as
    first given, with zero counts and no entry.
    """
    given: dict[str, str] = {}
    for n in separate:
        given.setdefault(name_key(n), n.strip())
    return [ids.json(key, given.get(key)) for key in keys]
