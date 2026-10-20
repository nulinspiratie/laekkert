"""The bar: which drink ingredients the household has, and what it can make.

The catalog (`catalog/ingredients.json`) says what an item is: its name, other
names, kind and whether it is fresh. The inventory (`inventory.json`) says only
whether the household has it. The bar covers cocktails and mocktails: its items
are every ingredient of those, resolved through the catalog, plus every catalog
entry with a kind. Syrups and prep recipes are things you make: their
ingredients don't fill the bar and they have no status.

Only bottles are tracked. An item is not tracked when its kind is syrups (an
item with no kind counts as syrups when its name has the word "syrup"), when
Lækkert has a syrups or prep recipe for it, or when its entry is marked fresh.
An item that is not tracked has no state, whatever the inventory says (its
inventory entry is dropped on the next bar write), and never keeps a drink
from being made.

Reading is lenient, like the catalog: an inventory that cannot be read means
everything is unsorted, with a warning. Changing is strict: `Bar.apply` refuses
to write over a catalog or inventory it cannot read, applies a whole
`BarChanges` to copies, and writes only if every part of it is allowed.
"""

from __future__ import annotations

import copy
import itertools
import json
import logging
import threading
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, ValidationError, model_validator

from app.recipes.catalog import Catalog, CatalogEntry, Kind, name_key
from app.recipes.files import atomic_write
from app.recipes.ingredients import (
    EMPTY_NAME,
    Identities,
    IngredientError,
    merge,
    on_bar,
    touched_json,
)
from app.recipes.model import SIDES, Recipe
from app.recipes.search import words
from app.recipes.store import RecipeStore

INVENTORY_FORMAT_VERSION = 1
MAX_NAMES = 200

State = Literal["have", "dont"]
Status = Literal["can_make", "missing", "unsorted"]
UntrackedBecause = Literal["syrups", "recipe", "marked"]
STATES: tuple[State, ...] = ("have", "dont")
BAR_CATEGORIES = ("cocktails", "mocktails")  # the drinks the bar covers
MADE_CATEGORIES = ("syrups", "prep")  # recipes for items, with no bar status

UNAVAILABLE = (
    "The bar's inventory can't be read, so it can't be changed. "
    "Fix inventory.json on the NAS."
)
TOO_MANY = "That's too many changes at once."
FOLD_SELF = "An item can't be folded into itself."
OWN_NAME = "An item's own name can't be removed."
USED = "Only items no drink uses can be deleted."
NO_DELETE = "Deleting isn't possible here."

log = logging.getLogger("app.recipes")


def effective_kind(kind: Kind | None, name: str) -> Kind:
    """The kind an item counts as: its own, else syrups when its name has the
    word "syrup" or "syrups", else other."""
    if kind is not None:
        return kind
    return "syrups" if {"syrup", "syrups"} & set(words(name)) else "other"


def _no_item(name: str) -> str:
    return f"There is no ‘{name}’ in the bar."


def _no_target(name: str) -> str:
    return f"There is no ‘{name}’ in the bar to fold into."


def _taken(name: str) -> str:
    return f"‘{name}’ is already an item. Fold one into the other instead."


def _no_other_name(item: str, name: str) -> str:
    return f"‘{item}’ has no other name ‘{name}’."


def _two_ways(name: str) -> str:
    return f"‘{name}’ can't be changed two ways at once."


def _still_untracked(name: str, because: UntrackedBecause) -> str:
    if because == "syrups":
        return f"Syrups aren't tracked. Give ‘{name}’ another kind first."
    return f"Lækkert has a recipe for ‘{name}’, so it isn't tracked."


class BarError(ValueError):
    """A change the bar refuses; `str(exc)` is the sentence to show."""


class InventoryUnavailable(OSError):
    """inventory.json exists but cannot be read, so it must not be rewritten."""


class BarChanges(BaseModel):
    """One change to the bar, applied all or nothing (see `Bar.apply`)."""

    model_config = ConfigDict(extra="forbid")

    have: list[str] = []
    dont_have: list[str] = []
    unsorted: list[str] = []
    untrack: list[str] = []
    track: list[str] = []
    kinds: dict[str, Kind] = {}
    add_names: dict[str, list[str]] = {}
    remove_names: dict[str, list[str]] = {}
    fold: dict[str, str] = {}
    delete: list[str] = []

    @model_validator(mode="after")
    def _check_names(self) -> BarChanges:
        names = self.names()
        if len(names) > MAX_NAMES:
            raise ValueError(TOO_MANY)
        if any(not name_key(name) for name in names):
            raise ValueError(EMPTY_NAME)
        return self

    def names(self) -> list[str]:
        """Every name the change mentions."""
        names = [
            *self.have,
            *self.dont_have,
            *self.unsorted,
            *self.untrack,
            *self.track,
            *self.kinds,
            *self.fold,
            *self.fold.values(),
            *self.delete,
        ]
        for lists in (self.add_names, self.remove_names):
            for item, others in lists.items():
                names += [item, *others]
        return names


@dataclass
class BarItem:
    name: str
    aliases: list[str]
    kind: Kind  # the effective kind
    tracked: bool
    untracked_because: UntrackedBecause | None
    state: State | None
    used_in: list[dict]
    recipe: dict | None

    def json(self) -> dict:
        return asdict(self)


def _parse(raw: object) -> CatalogEntry | None:
    try:
        return CatalogEntry.model_validate(raw)
    except ValidationError:
        return None


def _link(recipe: Recipe) -> dict:
    return {"slug": recipe.slug, "name": recipe.name}


class _Inventory:
    """An inventory's items, with each name findable by its key.

    Changes go through `remove` and `set`, so the index stays true to `items`.
    """

    def __init__(self, items: dict):
        self.items = items
        self._order = itertools.count()
        self._by_key: dict[str, dict[str, int]] = {}  # key -> {name: file order}
        for name in items:
            self._index(name)

    def _index(self, name: str) -> None:
        self._by_key.setdefault(name_key(name), {})[name] = next(self._order)

    def names(self, keys: list[str]) -> list[str]:
        """The names under any of these keys, in file order."""
        found: dict[str, int] = {}
        for key in keys:
            found.update(self._by_key.get(key, {}))
        return sorted(found, key=found.__getitem__)

    def remove(self, name: str) -> None:
        del self.items[name]
        del self._by_key[name_key(name)][name]

    def set(self, name: str, state: State) -> None:
        if name not in self.items:
            self._index(name)  # a new name goes last, as in the dict
        self.items[name] = state


class _Registry:
    """Which item each name means, for catalog entries (None = unreadable) and
    every drink, whatever its category.

    An entry whose name is already taken by an earlier entry is left out, so
    every name means at most one entry, the first, as in `Catalog.entry`.
    Ingredients that match no entry are virtual items, named as the first drink
    (in name order) writes them. An item is identified by the key of its name.
    """

    def __init__(self, entries: list[CatalogEntry | None], drinks: list[Recipe]):
        self.entries = entries
        self.drinks = drinks
        self.index: dict[str, int] = {}  # any name's key -> entry position
        self.by_item: dict[str, int] = {}  # item key -> entry position
        for position, entry in enumerate(entries):
            if entry is None:
                continue
            own = name_key(entry.name)
            if not own or own in self.index:
                continue
            self.by_item[own] = position
            for name in (entry.name, *entry.aliases):
                if key := name_key(name):
                    self.index.setdefault(key, position)
        self.virtual: dict[str, str] = {}  # item key -> name
        self.used_in: dict[str, list[Recipe]] = {}  # item key -> every drink
        self.bar_used: dict[str, list[Recipe]] = {}  # item key -> bar drinks
        self.made: dict[str, Recipe] = {}  # recipe name's key -> syrup or prep
        for recipe in drinks:
            if recipe.category in MADE_CATEGORIES:
                self.made.setdefault(name_key(recipe.name), recipe)
            for ingredient in recipe.ingredients:
                key = name_key(ingredient.item)
                if not key:
                    continue
                if key not in self.index:
                    self.virtual.setdefault(key, ingredient.item)
                item = self.item_key(ingredient.item)
                indexes = [self.used_in]
                if recipe.category in BAR_CATEGORIES:
                    indexes.append(self.bar_used)
                for index in indexes:
                    users = index.setdefault(item, [])
                    if not users or users[-1] is not recipe:
                        users.append(recipe)

    def item_key(self, name: str) -> str | None:
        """The item this name means: an entry (shown or not), a virtual item or None."""
        key = name_key(name)
        if key in self.index:
            return name_key(self.entries[self.index[key]].name)
        return key if key in self.virtual else None

    def entry(self, item: str) -> CatalogEntry | None:
        position = self.by_item.get(item)
        return None if position is None else self.entries[position]

    def in_bar(self, item: str | None) -> bool:
        """Shown on the bar: used by a cocktail or mocktail, or an entry with a
        kind, unless it is an M4 leftover (see `made_only_other`)."""
        if item is None:
            return False
        if item in self.bar_used:
            return True
        entry = self.entry(item)
        return (
            entry is not None
            and entry.kind is not None
            and not self.made_only_other(item)
        )

    def made_only_other(self, item: str) -> bool:
        """Kind Other and used only by syrups and prep recipes: M4 sorted every
        drink's ingredients, so it gave such items (sugar, water) kind Other and
        a state. They are not on the bar, whatever state they kept. An Other
        bottle no recipe uses stays."""
        entry = self.entry(item)
        return (
            entry is not None
            and entry.kind == "other"
            and item in self.used_in
            and item not in self.bar_used
        )

    def name(self, item: str) -> str:
        entry = self.entry(item)
        return entry.name if entry else self.virtual[item]

    def aliases(self, item: str) -> list[str]:
        """The other names that mean this item."""
        entry = self.entry(item)
        if entry is None:
            return []
        position = self.by_item[item]
        return [
            alias
            for alias in entry.aliases
            if name_key(alias) != item and self.index.get(name_key(alias)) == position
        ]

    def fresh(self, item: str) -> bool:
        entry = self.entry(item)
        return entry is not None and entry.fresh

    def kind(self, item: str) -> Kind:
        """The item's effective kind (see `effective_kind`)."""
        entry = self.entry(item)
        return effective_kind(entry.kind if entry else None, self.name(item))

    def recipe(self, item: str) -> Recipe | None:
        """The syrups or prep recipe named like the item or one of its names."""
        for name in (self.name(item), *self.aliases(item)):
            if recipe := self.made.get(name_key(name)):
                return recipe
        return None

    def untracked_because(self, item: str) -> UntrackedBecause | None:
        """Why the item is not tracked, the first reason that holds; None if it is."""
        if self.kind(item) == "syrups":
            return "syrups"
        if self.recipe(item) is not None:
            return "recipe"
        if self.fresh(item):
            return "marked"
        return None

    def keys(self, item: str) -> list[str]:
        """The keys of every name that means this item (`item_key` gives it)."""
        position = self.by_item.get(item)
        if position is None:
            return [item] if item in self.virtual else []
        entry = self.entries[position]
        assert entry is not None
        keys: list[str] = []
        for name in (entry.name, *entry.aliases):
            key = name_key(name)
            if key and key not in keys and self.index.get(key) == position:
                keys.append(key)
        return keys

    def state(self, item: str, inventory: _Inventory) -> State | None:
        """The first inventory state under any of the item's names; None if the
        item is not tracked."""
        if self.untracked_because(item) is not None:
            return None
        for name in inventory.names(self.keys(item)):
            if (state := inventory.items[name]) in STATES:
                return state
        return None

    def inventory_names(self, item: str, inventory: _Inventory) -> list[str]:
        return inventory.names(self.keys(item))

    def appended(self, entry: CatalogEntry | None) -> bool:
        """Take in an entry added at the end of the catalog, as a rebuild would.

        Only an entry whose names all mean one new item is taken in (a virtual
        item becoming an entry, or a new bottle); for any other, nothing is
        changed and the answer is False, so the caller rebuilds.
        """
        if entry is None:
            return False
        own = name_key(entry.name)
        if not own or own in self.index:
            return False
        if any(name_key(alias) not in ("", own) for alias in entry.aliases):
            return False
        position = len(self.entries)
        self.entries.append(entry)
        self.by_item[own] = self.index[own] = position
        # Drinks that named it keep it: their ingredients' key is its key.
        self.virtual.pop(own, None)
        return True

    def replaced(self, item: str, entry: CatalogEntry | None) -> bool:
        """Take in a new copy of an item's entry with the same names (a kind or
        freshness changed); False if its names changed, so the caller rebuilds."""
        position = self.by_item.get(item)
        if position is None or entry is None:
            return False
        old = self.entries[position]
        assert old is not None
        if (entry.name, entry.aliases) != (old.name, old.aliases):
            return False
        self.entries[position] = entry
        return True


class BarView:
    """The bar at one moment: its items and what each drink needs."""

    def __init__(
        self, entries: list[CatalogEntry], inventory: dict, drinks: list[Recipe]
    ):
        self._registry = registry = _Registry(list(entries), drinks)
        self._drinks = drinks
        shelf = _Inventory(inventory)
        keys = set(registry.bar_used)
        keys.update(key for key in registry.by_item if registry.in_bar(key))
        self._items: dict[str, BarItem] = {}
        for key in sorted(keys):
            because = registry.untracked_because(key)
            recipe = registry.recipe(key)
            self._items[key] = BarItem(
                name=registry.name(key),
                aliases=registry.aliases(key),
                kind=registry.kind(key),
                tracked=because is None,
                untracked_because=because,
                state=registry.state(key, shelf),
                used_in=[_link(r) for r in registry.used_in.get(key, [])],
                recipe=_link(recipe) if recipe else None,
            )
        self.items: list[BarItem] = list(self._items.values())
        # Untracked items have no state, so only a tracked one sets the bar up.
        self.set_up: bool = any(i.state is not None for i in self.items)

    def item_for(self, text: str) -> BarItem | None:
        key = self._registry.item_key(text)
        return self._items.get(key) if key else None

    def _line(self, text: str) -> tuple[str, bool, State | None]:
        """An ingredient's item name, whether it is tracked, and its state."""
        if item := self.item_for(text):
            return item.name, item.tracked, item.state
        # Not on the bar in this view (a recipe saved since): not sorted.
        registry = self._registry
        key = registry.item_key(text)
        if key is None:
            made = name_key(text) in registry.made
            return text, not made and effective_kind(None, text) != "syrups", None
        return registry.name(key), registry.untracked_because(key) is None, None

    def status(self, recipe: Recipe) -> dict | None:
        """What a cocktail or mocktail needs; None for a syrups or prep recipe."""
        if recipe.category in MADE_CATEGORIES:
            return None
        missing: list[str] = []
        unsorted: list[str] = []
        untracked: list[str] = []
        for ingredient in recipe.ingredients:
            name, tracked, state = self._line(ingredient.item)
            if not tracked:
                group = untracked
            elif state == "dont":
                group = missing
            elif state is None:
                group = unsorted
            else:
                continue
            if name not in group:
                group.append(name)
        if missing:
            status: Status = "missing"
        elif unsorted:
            status = "unsorted"
        else:
            status = "can_make"
        return {
            "status": status,
            "missing": missing,
            "unsorted": unsorted,
            "untracked": untracked,
        }

    def ingredient(self, text: str) -> dict | None:
        item = self.item_for(text)
        if item is None:
            return None
        return {
            "item": item.name,
            "state": item.state,
            "tracked": item.tracked,
            "recipe": item.recipe,
        }

    def json(self) -> dict:
        counts = {"can_make": 0, "missing": 0, "unsorted": 0}
        for recipe in self._drinks:
            if (status := self.status(recipe)) is not None:
                counts[status["status"]] += 1
        return {
            "items": [item.json() for item in self.items],
            "set_up": self.set_up,
            "counts": {**counts, "total": sum(counts.values())},
        }


class _Draft:
    """Copies of the catalog's entries and the inventory, changed step by step."""

    def __init__(self, raw: list, inventory: dict, drinks: list[Recipe]):
        self.raw = copy.deepcopy(raw)
        self.inventory = dict(inventory)
        self._shelf = _Inventory(self.inventory)
        self.drinks = drinks
        self._registry: _Registry | None = None

    @property
    def registry(self) -> _Registry:
        if self._registry is None:
            self._registry = _Registry([_parse(r) for r in self.raw], self.drinks)
        return self._registry

    def changed(self) -> None:
        """The entries changed: the registry is built again when next used."""
        self._registry = None

    def updated(self, item: str) -> None:
        """The item's entry changed, but not its names."""
        entry = self.raw_entry(item)
        if self._registry is None or entry is None:
            self.changed()
        elif not self._registry.replaced(item, _parse(entry)):
            self.changed()

    def key(self, name: str) -> str:
        """The item a name means, or the key of a name that is new to the bar."""
        return self.registry.item_key(name) or name_key(name)

    def bar_item(self, name: str, refusal: str | None = None) -> str:
        item = self.registry.item_key(name)
        if not self.registry.in_bar(item):
            raise BarError(refusal or _no_item(name))
        assert item is not None
        return item

    def raw_entry(self, item: str) -> dict | None:
        position = self.registry.by_item.get(item)
        return None if position is None else self.raw[position]

    def drop_entry(self, entry: dict) -> None:
        self.raw = [e for e in self.raw if e is not entry]
        self.changed()

    def add_entry(self, entry: dict) -> dict:
        registry = self._registry
        self.raw.append(entry)
        if registry is None or not registry.appended(_parse(entry)):
            self.changed()
        return entry

    def touch(self, item: str) -> dict:
        """The item's catalog entry, made if it is virtual, with a kind (its
        effective kind, when it had none)."""
        entry = self.raw_entry(item)
        name = self.registry.name(item)
        if entry is None:
            return self.add_entry({"name": name, "kind": effective_kind(None, name)})
        if entry.get("kind") is None:
            entry["kind"] = effective_kind(None, name)
            self.updated(item)
        return entry

    def new_item(self, name: str, **fields) -> str:
        name = name.strip()
        self.add_entry({"name": name, "kind": effective_kind(None, name), **fields})
        return self.key(name)

    def state(self, item: str) -> State | None:
        return self.registry.state(item, self._shelf)

    def clear_state(self, item: str) -> None:
        for name in self.registry.inventory_names(item, self._shelf):
            self._shelf.remove(name)

    def set_state(self, item: str, state: State) -> None:
        if self.registry.untracked_because(item) is not None:
            return  # an untracked item has no state
        names = self.registry.inventory_names(item, self._shelf)
        if len(names) == 1 and self.inventory[names[0]] == state:
            return
        self.clear_state(item)
        self._shelf.set(self.registry.name(item), state)

    def prune_untracked(self) -> None:
        """Drop every inventory name whose item is not tracked."""
        registry = self.registry
        for name in list(self.inventory):
            item = registry.item_key(name)
            if item is not None and registry.untracked_because(item) is not None:
                self._shelf.remove(name)


def _check_conflicts(changes: BarChanges, draft: _Draft) -> None:
    """Refuse a name in two lists that contradict each other."""

    def keyed(names) -> dict[str, str]:
        found: dict[str, str] = {}
        for name in names:
            found.setdefault(draft.key(name), name)
        return found

    have, dont = keyed(changes.have), keyed(changes.dont_have)
    unsorted = keyed(changes.unsorted)
    untrack, track = keyed(changes.untrack), keyed(changes.track)
    others = keyed(
        [
            *changes.have,
            *changes.dont_have,
            *changes.unsorted,
            *changes.untrack,
            *changes.track,
            *changes.kinds,
            *changes.add_names,
            *changes.remove_names,
            *changes.fold,
            *changes.fold.values(),
        ]
    )
    pairs = [
        (have, dont),
        (have, unsorted),
        (dont, unsorted),
        (untrack, track),
        (have, untrack),
        (dont, untrack),
        (others, keyed(changes.delete)),
    ]
    for first, second in pairs:
        for key in second:
            if key in first:
                raise BarError(_two_ways(first[key]))
    for item, added in changes.add_names.items():
        for other, removed in changes.remove_names.items():
            if draft.key(item) != draft.key(other):
                continue
            taken_off = {name_key(name) for name in removed}
            for name in added:
                if name_key(name) in taken_off:
                    raise BarError(_two_ways(name))


def _fold(draft: _Draft, source: str, into: str) -> None:
    registry = draft.registry
    a = draft.bar_item(source)
    b = draft.bar_item(into, _no_target(into))
    if a == b:
        raise BarError(FOLD_SELF)
    a_entry, a_raw = registry.entry(a), draft.raw_entry(a)
    a_names = [registry.name(a), *registry.aliases(a)]
    a_state = draft.state(a)
    b_state = draft.state(b)
    b_raw = draft.raw_entry(b)
    draft.clear_state(a)
    if a_raw is not None:
        draft.drop_entry(a_raw)
    if b_raw is None:
        b_name = registry.name(b)
        b_raw = {
            "name": b_name,
            "kind": (a_entry and a_entry.kind) or effective_kind(None, b_name),
        }
        if a_entry and a_entry.fresh:
            b_raw["fresh"] = True
        draft.add_entry(b_raw)
    elif b_raw.get("kind") is None:
        b_raw["kind"] = effective_kind(None, b_raw["name"])
    aliases = list(b_raw.get("aliases", []))
    known = {name_key(n) for n in (b_raw["name"], *aliases)}
    for name in a_names:
        if name_key(name) not in known:
            aliases.append(name)
            known.add(name_key(name))
    b_raw["aliases"] = aliases
    if b_raw.get("g_per_tsp") is None and a_entry and a_entry.g_per_tsp is not None:
        b_raw["g_per_tsp"] = a_entry.g_per_tsp
    draft.changed()
    if b_state is None and a_state is not None:
        draft.set_state(b, a_state)


def _remove_names(draft: _Draft, item_name: str, names: list[str]) -> None:
    item = draft.bar_item(item_name)
    for name in names:
        key = name_key(name)
        if key == item:
            raise BarError(OWN_NAME)
        if key not in {name_key(a) for a in draft.registry.aliases(item)}:
            raise BarError(_no_other_name(item_name, name))
        entry = draft.touch(item)
        entry["aliases"] = [a for a in entry["aliases"] if name_key(a) != key]
        draft.changed()


def _add_names(draft: _Draft, item_name: str, names: list[str]) -> None:
    item = draft.bar_item(item_name)
    for name in names:
        owner = draft.registry.item_key(name)
        if owner == item:
            continue
        if owner is not None:
            raise BarError(_taken(name))
        entry = draft.touch(item)
        entry["aliases"] = [*entry.get("aliases", []), name.strip()]
        draft.changed()


def _apply(changes: BarChanges, draft: _Draft) -> None:
    """Every part of the change, in the spec's order; raises on the first refusal."""
    for source, into in changes.fold.items():
        _fold(draft, source, into)
    for item, names in changes.remove_names.items():
        _remove_names(draft, item, names)
    for item, names in changes.add_names.items():
        _add_names(draft, item, names)

    for name in changes.untrack:
        item = draft.registry.item_key(name)
        if item is None:
            draft.clear_state(draft.new_item(name, fresh=True))
            continue
        draft.clear_state(item)
        entry = draft.touch(item)
        if entry.get("fresh") is not True:
            entry["fresh"] = True
            draft.updated(item)
    tracked: dict[str, str] = {}  # item -> its name as given
    for name in changes.track:
        item = draft.bar_item(name)
        tracked.setdefault(item, name)
        draft.clear_state(item)
        entry = draft.touch(item)
        if "fresh" in entry:
            del entry["fresh"]
            draft.updated(item)

    for name, kind in changes.kinds.items():
        item = draft.bar_item(name)
        entry = draft.touch(item)
        entry["kind"] = kind
        draft.updated(item)  # syrups: its state goes with `prune_untracked`
    # Only now, so a new kind in the same change can make an item trackable.
    for item, name in tracked.items():
        if (because := draft.registry.untracked_because(item)) is not None:
            raise BarError(_still_untracked(name, because))

    for names, state in ((changes.have, "have"), (changes.dont_have, "dont")):
        for name in names:
            item = draft.registry.item_key(name)
            if item is None:
                item = draft.new_item(name)
            else:
                draft.touch(item)
            draft.set_state(item, state)
    for name in changes.unsorted:
        item = draft.bar_item(name)
        draft.touch(item)
        draft.clear_state(item)

    deleted: set[str] = set()
    for name in changes.delete:
        if draft.key(name) in deleted:
            continue  # the same item named twice
        item = draft.bar_item(name)
        deleted.add(item)
        if item in draft.registry.used_in:
            raise BarError(USED)
        entry = draft.registry.entry(item)
        raw = draft.raw_entry(item)
        assert entry is not None and raw is not None
        draft.clear_state(item)
        if entry.g_per_tsp is not None:
            raw.pop("kind", None)
            draft.changed()
        else:
            draft.drop_entry(raw)


def _bar_states(raw: list, drinks: list[Recipe], shelf: _Inventory) -> dict:
    """Whether each bar item is tracked, and its state, by item key."""
    registry = _Registry([_parse(r) for r in raw], drinks)
    keys = set(registry.bar_used)
    keys.update(key for key in registry.by_item if registry.in_bar(key))
    return {
        key: (registry.untracked_because(key) is None, registry.state(key, shelf))
        for key in sorted(keys)
    }


def _check_bar_kept(
    raw: list,
    new_raw: list,
    recipes: dict[str, list[Recipe]],
    shelf: _Inventory,
    merges: dict[str, str],
) -> None:
    """Refuse merges that change the bar: the same items, each with its state,
    unless a merge untracked it (untracked items have no state).

    A merged name can carry an inventory state no bar item showed (left from a
    drink since deleted); merged into a bar item, it would show there. The
    refusal names the first A with a name in the inventory.
    """
    before = _bar_states(raw, recipes["drinks"], shelf)
    after = _bar_states(new_raw, recipes["drinks"], shelf)
    if before.keys() == after.keys() and all(
        after[key] == before[key] or (before[key][0] and not after[key][0])
        for key in before
    ):
        return
    identities = Identities([_parse(r) for r in raw], recipes)

    def in_inventory(a: str) -> bool:
        key = identities.key(a)
        names = [identities.name(key), *identities.other_names(key)] if key else [a]
        return bool(shelf.names([name_key(n) for n in names]))

    sources = [a.strip() for a in merges]
    raise IngredientError(on_bar(next(filter(in_inventory, sources), sources[0])))


class Bar:
    def __init__(self, data_dir: Path, catalog: Catalog, store: RecipeStore):
        self.inventory_path = Path(data_dir) / "inventory.json"
        self._catalog = catalog
        self._store = store
        self._lock = threading.Lock()
        self._cache: tuple[int | None, dict] = (None, {})

    def view(self, drinks: list[Recipe] | None = None) -> BarView:
        """The bar now. `drinks` is every drink, when the caller has just read them."""
        if drinks is None:
            drinks = self._store.list("drinks")
        return BarView(self._catalog.entries(), self._inventory(), drinks)

    def apply(self, changes: BarChanges, *, allow_delete: bool = True) -> BarView:
        """Apply the whole change or none of it, and return the bar after it."""
        if changes.delete and not allow_delete:
            raise BarError(NO_DELETE)
        with self._lock:
            raw = self._catalog.raw()
            data = self._read_strict()
            items = data.get("items", {})
            drinks = self._store.list("drinks")
            draft = _Draft(raw, items, drinks)
            _check_conflicts(changes, draft)
            _apply(changes, draft)
            draft.prune_untracked()
            if draft.raw != raw:
                self._catalog.save_raw(draft.raw)
            if draft.inventory != items:
                self._write({**data, "items": draft.inventory})
            return self.view(drinks)

    def ingredients(self, side: str | None) -> list[dict]:
        """Every ingredient identity in use (see `Identities.all`)."""
        recipes = {s: self._store.list(s) for s in SIDES}
        return Identities(list(self._catalog.entries()), recipes).all(side)

    def merge_ingredients(
        self, merges: dict[str, str], separate: list[str]
    ) -> list[dict]:
        """Merge and separate names in the catalog, all or nothing; the touched
        identities after it. The inventory is read, to refuse when it is bad and
        to know what is on the bar, but never written."""
        with self._lock:
            raw = self._catalog.raw()
            shelf = _Inventory(dict(self._read_strict().get("items", {})))
            recipes = {s: self._store.list(s) for s in SIDES}
            registry = _Registry([_parse(r) for r in raw], recipes["drinks"])

            def is_on_bar(name: str) -> bool:
                item = registry.item_key(name)
                if item is None:
                    return False
                if registry.in_bar(item):
                    return True
                # An M4 leftover's stored state doesn't put it on the bar.
                return (
                    not registry.made_only_other(item)
                    and registry.state(item, shelf) is not None
                )

            def bar_kept(merged: list) -> None:
                _check_bar_kept(raw, merged, recipes, shelf, merges)

            new_raw, touched = merge(
                raw, recipes, is_on_bar, merges, separate, after_merges=bar_kept
            )
            if new_raw != raw:
                self._catalog.save_raw(new_raw)
            identities = Identities([_parse(r) for r in new_raw], recipes)
            return touched_json(identities, touched, separate)

    def _read_strict(self) -> dict:
        """The inventory file as parsed; raises InventoryUnavailable if it is bad."""
        try:
            content = self.inventory_path.read_bytes()
        except FileNotFoundError:
            return {"format_version": INVENTORY_FORMAT_VERSION, "items": {}}
        except OSError as exc:
            raise InventoryUnavailable(UNAVAILABLE) from exc
        try:
            data = json.loads(content.decode("utf-8"))
            version = data["format_version"]
            items = data["items"]
        except (ValueError, KeyError, TypeError) as exc:
            raise InventoryUnavailable(UNAVAILABLE) from exc
        if (
            not isinstance(version, int)
            or isinstance(version, bool)
            or version > INVENTORY_FORMAT_VERSION
            or not isinstance(items, dict)
        ):
            raise InventoryUnavailable(UNAVAILABLE)
        return data

    def _inventory(self) -> dict:
        """The inventory's items; {} with a warning when the file can't be read."""
        try:
            mtime_ns: int | None = self.inventory_path.stat().st_mtime_ns
        except OSError:
            mtime_ns = None
        if mtime_ns is None:
            return {}
        # One read of the cache: a write on another thread may replace it.
        cached_mtime_ns, cached = self._cache
        if cached_mtime_ns == mtime_ns:
            return cached
        try:
            items = self._read_strict()["items"]
        except InventoryUnavailable as exc:
            log.warning("ignoring %s: %s", self.inventory_path, exc.__cause__ or exc)
            items = {}
        self._cache = (mtime_ns, items)
        return items

    def _write(self, data: dict) -> None:
        data = {**data, "format_version": INVENTORY_FORMAT_VERSION}
        text = json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
        atomic_write(self.inventory_path, text.encode("utf-8"))
        self._cache = (None, {})
