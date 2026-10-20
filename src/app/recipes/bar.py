"""The bar: which drink ingredients the household has, and what it can make.

The catalog (`catalog/ingredients.json`) says what an item is: its name, other
names, kind and whether it is fresh. The inventory (`inventory.json`) says only
whether the household has it. The bar's items are every ingredient of every
drink, resolved through the catalog, plus every catalog entry with a kind.
Fresh items are never tracked.

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
from app.recipes.ingredients import EMPTY_NAME, Identities, merge, touched_json
from app.recipes.model import SIDES, Recipe
from app.recipes.store import RecipeStore

INVENTORY_FORMAT_VERSION = 1
MAX_NAMES = 200

State = Literal["have", "dont"]
Status = Literal["can_make", "fresh_only", "missing", "unsorted"]
STATES: tuple[State, ...] = ("have", "dont")

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
    fresh: list[str] = []
    not_fresh: list[str] = []
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
            *self.fresh,
            *self.not_fresh,
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
    kind: Kind
    fresh: bool
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
    """Which item each name means, for catalog entries (None = unreadable) and drinks.

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
        self.used_in: dict[str, list[Recipe]] = {}  # item key -> drinks
        for recipe in drinks:
            for ingredient in recipe.ingredients:
                key = name_key(ingredient.item)
                if not key:
                    continue
                if key not in self.index:
                    self.virtual.setdefault(key, ingredient.item)
                users = self.used_in.setdefault(self.item_key(ingredient.item), [])
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
        """Shown on the bar: used by a drink, or an entry with a kind."""
        if item is None:
            return False
        if item in self.used_in:
            return True
        entry = self.entry(item)
        return entry is not None and entry.kind is not None

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
        """The first inventory state under any of the item's names; None if fresh."""
        if self.fresh(item):
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
        syrups: dict[str, Recipe] = {}
        for recipe in drinks:
            if recipe.category == "syrups":
                syrups.setdefault(name_key(recipe.name), recipe)
        keys = set(registry.used_in)
        keys.update(key for key in registry.by_item if registry.in_bar(key))
        self._items: dict[str, BarItem] = {}
        for key in sorted(keys):
            entry = registry.entry(key)
            name = registry.name(key)
            aliases = registry.aliases(key)
            recipe = next(
                (
                    syrups[name_key(n)]
                    for n in (name, *aliases)
                    if name_key(n) in syrups
                ),
                None,
            )
            self._items[key] = BarItem(
                name=name,
                aliases=aliases,
                kind=(entry.kind if entry else None) or "other",
                fresh=registry.fresh(key),
                state=registry.state(key, shelf),
                used_in=[_link(r) for r in registry.used_in.get(key, [])],
                recipe=_link(recipe) if recipe else None,
            )
        self.items: list[BarItem] = list(self._items.values())
        self.set_up: bool = any(i.state is not None for i in self.items)

    def item_for(self, text: str) -> BarItem | None:
        key = self._registry.item_key(text)
        return self._items.get(key) if key else None

    def status(self, recipe: Recipe) -> dict:
        missing: list[str] = []
        unsorted: list[str] = []
        fresh: list[str] = []
        for ingredient in recipe.ingredients:
            item = self.item_for(ingredient.item)
            if item is None:
                # Not in this view (a recipe saved since): an unsorted bottle.
                name, is_fresh, state = ingredient.item, False, None
            else:
                name, is_fresh, state = item.name, item.fresh, item.state
            if is_fresh:
                group = fresh
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
        elif fresh:
            status = "fresh_only"
        else:
            status = "can_make"
        return {
            "status": status,
            "missing": missing,
            "unsorted": unsorted,
            "fresh": fresh,
        }

    def ingredient(self, text: str) -> dict | None:
        item = self.item_for(text)
        if item is None:
            return None
        return {
            "item": item.name,
            "state": item.state,
            "fresh": item.fresh,
            "recipe": item.recipe,
        }

    def json(self) -> dict:
        counts = {"can_make": 0, "fresh_only": 0, "missing": 0, "unsorted": 0}
        for recipe in self._drinks:
            counts[self.status(recipe)["status"]] += 1
        return {
            "items": [item.json() for item in self.items],
            "set_up": self.set_up,
            "counts": {**counts, "total": len(self._drinks)},
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
        """The item's catalog entry, made if it is virtual, with a kind."""
        entry = self.raw_entry(item)
        if entry is None:
            return self.add_entry({"name": self.registry.name(item), "kind": "other"})
        if entry.get("kind") is None:
            entry["kind"] = "other"
            self.updated(item)
        return entry

    def new_item(self, name: str, **fields) -> str:
        self.add_entry({"name": name.strip(), "kind": "other", **fields})
        return self.key(name)

    def state(self, item: str) -> State | None:
        return self.registry.state(item, self._shelf)

    def clear_state(self, item: str) -> None:
        for name in self.registry.inventory_names(item, self._shelf):
            self._shelf.remove(name)

    def set_state(self, item: str, state: State) -> None:
        if self.registry.fresh(item):
            return  # fresh items are never tracked
        names = self.registry.inventory_names(item, self._shelf)
        if len(names) == 1 and self.inventory[names[0]] == state:
            return
        self.clear_state(item)
        self._shelf.set(self.registry.name(item), state)


def _check_conflicts(changes: BarChanges, draft: _Draft) -> None:
    """Refuse a name in two lists that contradict each other."""

    def keyed(names) -> dict[str, str]:
        found: dict[str, str] = {}
        for name in names:
            found.setdefault(draft.key(name), name)
        return found

    have, dont = keyed(changes.have), keyed(changes.dont_have)
    unsorted = keyed(changes.unsorted)
    fresh, not_fresh = keyed(changes.fresh), keyed(changes.not_fresh)
    others = keyed(
        [
            *changes.have,
            *changes.dont_have,
            *changes.unsorted,
            *changes.fresh,
            *changes.not_fresh,
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
        (fresh, not_fresh),
        (have, fresh),
        (dont, fresh),
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
        b_raw = {
            "name": registry.name(b),
            "kind": (a_entry and a_entry.kind) or "other",
        }
        if a_entry and a_entry.fresh:
            b_raw["fresh"] = True
        draft.add_entry(b_raw)
    elif b_raw.get("kind") is None:
        b_raw["kind"] = "other"
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

    for name in changes.fresh:
        item = draft.registry.item_key(name)
        if item is None:
            draft.clear_state(draft.new_item(name, fresh=True))
            continue
        draft.clear_state(item)
        entry = draft.touch(item)
        if entry.get("fresh") is not True:
            entry["fresh"] = True
            draft.updated(item)
    for name in changes.not_fresh:
        item = draft.bar_item(name)
        draft.clear_state(item)
        entry = draft.touch(item)
        if "fresh" in entry:
            del entry["fresh"]
            draft.updated(item)

    for name, kind in changes.kinds.items():
        item = draft.bar_item(name)
        entry = draft.touch(item)
        entry["kind"] = kind
        draft.updated(item)

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

            def on_bar(name: str) -> bool:
                item = registry.item_key(name)
                return registry.in_bar(item) or (
                    item is not None and registry.state(item, shelf) is not None
                )

            new_raw, touched = merge(raw, recipes, on_bar, merges, separate)
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
