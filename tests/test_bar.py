import json
import logging
import threading

import pytest
from pydantic import ValidationError

from app.recipes import bar as bar_module
from app.recipes.bar import (
    Bar,
    BarChanges,
    BarError,
    InventoryUnavailable,
    effective_kind,
)
from app.recipes.catalog import Catalog, CatalogUnavailable
from app.recipes.drafts import parse_draft
from app.recipes.store import RecipeStore
from app.recipes.uploads import UploadStore


@pytest.fixture
def catalog(tmp_path):
    return Catalog(tmp_path)


@pytest.fixture
def store(tmp_path, catalog):
    return RecipeStore(tmp_path, catalog, UploadStore(tmp_path))


@pytest.fixture
def bar(tmp_path, catalog, store):
    return Bar(tmp_path, catalog, store)


def drink(store, name, *items, category="cocktails"):
    """A drink recipe saved through the store, one ingredient per item."""
    return store.create(
        "drinks",
        parse_draft(
            {
                "name": name,
                "category": category,
                "servings": 1,
                "time_minutes": None,
                "ingredients": [
                    {"amount": 10, "unit": "ml", "item": item} for item in items
                ],
                "steps": [],
                "source": None,
                "tags": [],
                "image": None,
            }
        ),
        "app",
    )


def entries(catalog, *raw):
    catalog.save_raw(list(raw))


def write_inventory(bar, items):
    bar.inventory_path.write_text(json.dumps({"format_version": 1, "items": items}))


def read_inventory(bar):
    return json.loads(bar.inventory_path.read_text(encoding="utf-8"))


def raw_named(catalog, name):
    return [e for e in catalog.raw() if e.get("name") == name]


def names(view):
    return [i.name for i in view.items]


def item(view, name):
    found = [i for i in view.items if i.name == name]
    assert found, f"{name} is not in the bar: {names(view)}"
    return found[0]


def refused(bar, sentence, *, allow_delete=True, **changes):
    with pytest.raises(BarError) as exc:
        bar.apply(BarChanges(**changes), allow_delete=allow_delete)
    assert str(exc.value) == sentence


# --- items ---


def test_items_come_from_drinks_and_kinds(catalog, store, bar):
    entries(
        catalog,
        {"name": "lime juice", "fresh": True},
        {"name": "gin", "kind": "spirits"},
        {"name": "salt", "g_per_tsp": 6},
    )
    drink(store, "Daiquiri", "white rum", "lime juice")
    drink(store, "Jungle bird", "falernum")
    view = bar.view()
    assert names(view) == ["falernum", "gin", "lime juice", "white rum"]
    falernum = item(view, "falernum")
    assert (
        falernum.kind,
        falernum.tracked,
        falernum.untracked_because,
        falernum.state,
        falernum.aliases,
    ) == ("other", True, None, None, [])
    assert falernum.used_in == [{"slug": "jungle-bird", "name": "Jungle bird"}]
    gin = item(view, "gin")
    assert (gin.kind, gin.used_in) == ("spirits", [])
    lime = item(view, "lime juice")
    assert (lime.tracked, lime.untracked_because) == (False, "marked")
    assert item(view, "white rum").used_in == [{"slug": "daiquiri", "name": "Daiquiri"}]
    assert view.item_for("salt") is None


def test_ingredients_resolve_case_and_accent_insensitively(store, bar):
    drink(store, "Blue moon", "creme  de violette", "white rum")
    drink(store, "Aviation", "Crème de violette", "White Rum")
    view = bar.view()
    assert names(view) == ["Crème de violette", "White Rum"]
    both = [
        {"slug": "aviation", "name": "Aviation"},
        {"slug": "blue-moon", "name": "Blue moon"},
    ]
    for i in view.items:
        assert i.used_in == both


def test_alias_resolves_to_entry(catalog, store, bar):
    entries(catalog, {"name": "white rum", "aliases": ["light rum"]})
    drink(store, "Mojito", "light rum")
    view = bar.view()
    assert names(view) == ["white rum"]
    rum = item(view, "white rum")
    assert rum.aliases == ["light rum"]
    assert rum.used_in == [{"slug": "mojito", "name": "Mojito"}]
    assert view.item_for("Light Rum") is rum


def test_shadowed_catalog_entry_is_not_a_second_item(catalog, store, bar):
    entries(
        catalog,
        {"name": "gin", "aliases": ["genever"], "kind": "spirits"},
        {"name": "Genever", "kind": "spirits"},
        {"name": "Gin", "kind": "other"},
    )
    view = bar.view()
    assert names(view) == ["gin"]
    assert item(view, "gin").aliases == ["genever"]


# --- a drink's status ---


@pytest.fixture
def stocked(catalog, store, bar):
    entries(catalog, {"name": "lime juice", "fresh": True})
    write_inventory(bar, {"Gin": "have", "mezcal": "dont", "absinthe": "dont"})
    return {
        "gimlet": drink(store, "Gimlet", "gin", "lime juice"),
        "gin shot": drink(store, "Gin shot", "gin"),
        "naked": drink(
            store, "Naked", "lime juice", "mezcal", "campari", "absinthe", "mezcal"
        ),
        "negroni": drink(store, "Negroni", "campari", "gin"),
    }


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        (
            "naked",
            {
                "status": "missing",
                "missing": ["mezcal", "absinthe"],
                "unsorted": ["campari"],
                "untracked": ["lime juice"],
            },
        ),
        (
            "negroni",
            {
                "status": "unsorted",
                "missing": [],
                "unsorted": ["campari"],
                "untracked": [],
            },
        ),
        (
            "gimlet",
            {
                "status": "can_make",
                "missing": [],
                "unsorted": [],
                "untracked": ["lime juice"],
            },
        ),
        (
            "gin shot",
            {"status": "can_make", "missing": [], "unsorted": [], "untracked": []},
        ),
    ],
)
def test_status_order(stocked, bar, name, expected):
    assert bar.view().status(stocked[name]) == expected


def test_drink_with_no_ingredients_can_be_made(stocked, bar):
    empty = stocked["gin shot"].model_copy(update={"ingredients": []})
    assert bar.view().status(empty) == {
        "status": "can_make",
        "missing": [],
        "unsorted": [],
        "untracked": [],
    }


def test_syrup_and_prep_recipe_links(catalog, store, bar):
    entries(catalog, {"name": "simple syrup", "aliases": ["sugar syrup"]})
    drink(store, "Simple syrup", "sugar", "water", category="syrups")
    drink(store, "Oleo saccharum", "lemon peel", category="prep")
    drink(store, "Daiquiri", "white rum", "Sugar syrup", "oleo saccharum")
    drink(store, "White rum", "white rum")  # a cocktail, not a syrup recipe
    view = bar.view()
    link = {"slug": "simple-syrup", "name": "Simple syrup"}
    assert item(view, "simple syrup").recipe == link
    oleo = item(view, "oleo saccharum")
    assert oleo.recipe == {"slug": "oleo-saccharum", "name": "Oleo saccharum"}
    assert (oleo.tracked, oleo.untracked_because) == (False, "recipe")
    rum = item(view, "white rum")
    assert (rum.recipe, rum.tracked) == (None, True)
    assert view.item_for("sugar") is None  # only a syrup recipe uses it
    assert view.ingredient("sugar syrup") == {
        "item": "simple syrup",
        "state": None,
        "tracked": False,
        "recipe": link,
    }
    assert view.ingredient("white rum") == {
        "item": "white rum",
        "state": None,
        "tracked": True,
        "recipe": None,
    }
    assert view.ingredient("nothing like it") is None


def test_set_up_and_counts(stocked, bar):
    data = bar.view().json()
    assert data["set_up"] is True
    assert data["counts"] == {
        "can_make": 2,
        "missing": 1,
        "unsorted": 1,
        "total": 4,
    }
    assert [i["name"] for i in data["items"]] == [
        "absinthe",
        "campari",
        "gin",
        "lime juice",
        "mezcal",
    ]
    assert data["items"][2] == {
        "name": "gin",
        "aliases": [],
        "kind": "other",
        "tracked": True,
        "untracked_because": None,
        "state": "have",
        "used_in": [
            {"slug": "gimlet", "name": "Gimlet"},
            {"slug": "gin-shot", "name": "Gin shot"},
            {"slug": "negroni", "name": "Negroni"},
        ],
        "recipe": None,
    }


def test_not_set_up_until_something_has_a_state(store, bar):
    drink(store, "Gin shot", "gin")
    write_inventory(bar, {"vodka": "have", "gin": "maybe"})
    data = bar.view().json()
    assert data["set_up"] is False
    assert data["counts"] == {
        "can_make": 0,
        "missing": 0,
        "unsorted": 1,
        "total": 1,
    }


def test_fresh_items_have_no_state(catalog, store, bar):
    entries(catalog, {"name": "lime juice", "fresh": True})
    drink(store, "Gimlet", "gin", "lime juice")
    write_inventory(bar, {"lime juice": "have"})
    view = bar.view()
    assert item(view, "lime juice").state is None
    assert view.json()["set_up"] is False


# --- tracked and not tracked ---


@pytest.mark.parametrize(
    ("kind", "name", "expected"),
    [
        (None, "ginger syrup", "syrups"),
        (None, "Syrup, honey", "syrups"),
        (None, "Rich Syrups", "syrups"),
        (None, "syrupy thing", "other"),
        (None, "tonic", "other"),
        ("liqueurs", "syrup de liqueur", "liqueurs"),
        ("other", "ginger syrup", "other"),
    ],
)
def test_effective_kind(kind, name, expected):
    assert effective_kind(kind, name) == expected


def test_untracked_items_dont_block_can_make(bar, store, catalog):
    entries(
        catalog,
        {"name": "white rum", "kind": "spirits"},
        {"name": "lime juice", "fresh": True},
        {"name": "simple syrup", "kind": "syrups"},
    )
    drink(store, "Daiquiri", "white rum", "lime juice", "simple syrup")
    bar.apply(BarChanges(have=["white rum"]))
    status = bar.view().status(store.get("drinks", "daiquiri"))
    assert status == {
        "status": "can_make",
        "missing": [],
        "unsorted": [],
        "untracked": ["lime juice", "simple syrup"],
    }


def test_untracked_because_order(bar, store, catalog):
    entries(
        catalog,
        {"name": "simple syrup", "kind": "syrups", "fresh": True},
        {"name": "mint", "fresh": True},
    )
    drink(store, "Simple syrup", "sugar", category="syrups")
    drink(store, "Orgeat", "almonds", category="syrups")
    drink(store, "Mai tai", "simple syrup", "mint", "orgeat")
    items = {i.name: i for i in bar.view().items}
    assert items["simple syrup"].untracked_because == "syrups"
    assert items["orgeat"].untracked_because == "recipe"
    assert items["mint"].untracked_because == "marked"
    assert all(
        not items[n].tracked and items[n].state is None for n in items if n != "sugar"
    )


def test_syrup_word_rule(bar, store):
    drink(store, "Passion", "passion fruit syrup", "Syrup, honey", "syrupy thing")
    items = {i.name: i for i in bar.view().items}
    passion = items["passion fruit syrup"]
    assert passion.kind == "syrups" and not passion.tracked
    assert items["Syrup, honey"].kind == "syrups"
    assert items["syrupy thing"].kind == "other" and items["syrupy thing"].tracked


def test_kind_on_entry_beats_word_rule(bar, store, catalog):
    entries(catalog, {"name": "syrup de liqueur", "kind": "liqueurs"})
    drink(store, "X", "syrup de liqueur")
    assert bar.view().items[0].tracked


def test_untracked_items_ignore_their_inventory_state(bar, store, catalog):
    entries(catalog, {"name": "lime juice", "fresh": True})
    drink(store, "Orgeat", "almonds", category="syrups")
    drink(store, "Mai tai", "white rum", "orgeat", "lime juice", "honey syrup")
    stale = dict.fromkeys(["orgeat", "lime juice", "honey syrup"], "dont")
    write_inventory(bar, {**stale, "white rum": "have"})
    view = bar.view()
    assert [(i.name, i.state) for i in view.items] == [
        ("honey syrup", None),
        ("lime juice", None),
        ("orgeat", None),
        ("white rum", "have"),
    ]
    assert view.status(store.get("drinks", "mai-tai"))["status"] == "can_make"


def test_set_up_ignores_untracked_states(bar, store, tmp_path, catalog):
    entries(catalog, {"name": "simple syrup", "kind": "syrups"})
    drink(store, "X", "simple syrup")
    (tmp_path / "inventory.json").write_text(
        '{"format_version": 1, "items": {"simple syrup": "have"}}'
    )
    assert bar.view().set_up is False


# --- which drinks the bar covers ---


def test_made_recipes_have_no_status_and_dont_fill_the_bar(bar, store):
    drink(store, "Ginger syrup", "ginger", "sugar", category="syrups")
    drink(store, "Oleo", "lemon peel", category="prep")
    view = bar.view()
    assert view.status(store.get("drinks", "ginger-syrup")) is None
    assert view.status(store.get("drinks", "oleo")) is None
    assert [i.name for i in view.items] == []
    assert view.json()["counts"] == {
        "can_make": 0,
        "missing": 0,
        "unsorted": 0,
        "total": 0,
    }


def test_used_in_keeps_every_drink(bar, store, catalog):
    entries(catalog, {"name": "vodka", "kind": "spirits"})
    drink(store, "Infused vodka", "vodka", category="prep")
    drink(store, "Mule", "vodka")
    (item,) = bar.view().items
    assert [d["name"] for d in item.used_in] == ["Infused vodka", "Mule"]


def test_mocktail_without_bottles_can_make(bar, store, catalog):
    entries(catalog, {"name": "mint", "fresh": True})
    drink(store, "Virgin", "mint", category="mocktails")
    assert bar.view().status(store.get("drinks", "virgin"))["status"] == "can_make"


def test_counts_cover_cocktails_and_mocktails(bar, store):
    drink(store, "Gin shot", "gin")
    drink(store, "Virgin", "soda water", category="mocktails")
    drink(store, "Ginger syrup", "ginger", category="syrups")
    counts = bar.view().json()["counts"]
    assert counts == {"can_make": 0, "missing": 0, "unsorted": 2, "total": 2}


def test_status_order_missing_then_unsorted(bar, store, catalog):
    entries(
        catalog,
        {"name": "campari", "kind": "aperitifs"},
        {"name": "gin", "kind": "spirits"},
    )
    drink(store, "Negroni", "gin", "campari", "sweet vermouth")
    bar.apply(BarChanges(dont_have=["campari"]))
    s = bar.view().status(store.get("drinks", "negroni"))
    assert (s["status"], s["missing"], s["unsorted"]) == (
        "missing",
        ["campari"],
        ["gin", "sweet vermouth"],
    )


def test_status_of_a_recipe_saved_since_the_view(bar, store, catalog):
    entries(catalog, {"name": "lime juice", "fresh": True})
    drink(store, "Gin shot", "gin")
    view = bar.view()
    later = drink(store, "Gimlet", "gin", "lime juice", "honey syrup", "cognac")
    assert view.status(later) == {
        "status": "unsorted",
        "missing": [],
        "unsorted": ["gin", "cognac"],
        "untracked": ["lime juice", "honey syrup"],
    }


# --- changes: states and fresh ---


def test_have_unknown_name_adds_item(catalog, bar):
    view = bar.apply(BarChanges(have=["Campari"], dont_have=["Aperol"]))
    campari = item(view, "Campari")
    assert (campari.kind, campari.state, campari.used_in) == ("other", "have", [])
    assert item(view, "Aperol").state == "dont"
    assert raw_named(catalog, "Campari") == [{"name": "Campari", "kind": "other"}]
    assert read_inventory(bar) == {
        "format_version": 1,
        "items": {"Aperol": "dont", "Campari": "have"},
    }


def test_inventory_file_has_sorted_keys(bar):
    bar.apply(BarChanges(have=["mezcal", "Campari", "aperol"]))
    text = bar.inventory_path.read_text(encoding="utf-8")
    assert list(json.loads(text)["items"]) == ["Campari", "aperol", "mezcal"]
    assert text.endswith("\n")


def test_fresh_unknown_name_adds_fresh_item(catalog, bar):
    view = bar.apply(BarChanges(fresh=["Orange juice"]))
    juice = item(view, "Orange juice")
    assert (juice.tracked, juice.state, juice.kind) == (False, None, "other")
    assert raw_named(catalog, "Orange juice") == [
        {"name": "Orange juice", "kind": "other", "fresh": True}
    ]
    assert not bar.inventory_path.exists()


def test_fresh_unknown_name_drops_a_stale_inventory_key(catalog, bar):
    write_inventory(bar, {"Orange juice": "have", "gin": "have"})
    bar.apply(BarChanges(fresh=["orange juice"]))
    assert read_inventory(bar)["items"] == {"gin": "have"}


def test_fresh_clears_state_and_not_fresh_is_unsorted(catalog, store, bar):
    drink(store, "Paloma", "tequila", "grapefruit juice")
    bar.apply(BarChanges(have=["grapefruit juice", "tequila"]))
    view = bar.apply(BarChanges(fresh=["Grapefruit juice"]))
    juice = item(view, "grapefruit juice")
    assert (juice.tracked, juice.state) == (False, None)
    assert read_inventory(bar)["items"] == {"tequila": "have"}
    # A state for a fresh item is never stored.
    bar.apply(BarChanges(have=["grapefruit juice"]))
    assert read_inventory(bar)["items"] == {"tequila": "have"}
    view = bar.apply(BarChanges(not_fresh=["grapefruit juice"]))
    juice = item(view, "grapefruit juice")
    assert (juice.tracked, juice.state) == (True, None)


def test_unsorted_clears_state(store, bar):
    drink(store, "Gin shot", "gin")
    bar.apply(BarChanges(have=["gin"]))
    view = bar.apply(BarChanges(unsorted=["GIN"]))
    assert item(view, "gin").state is None
    assert read_inventory(bar)["items"] == {}
    refused(bar, "There is no ‘vodka’ in the bar.", unsorted=["vodka"])
    refused(bar, "There is no ‘vodka’ in the bar.", not_fresh=["vodka"])


def test_state_is_found_under_any_name(catalog, store, bar):
    entries(catalog, {"name": "white rum", "aliases": ["light rum"]})
    drink(store, "Mojito", "white rum")
    write_inventory(bar, {"Light Rum": "dont", "vodka": "have"})
    assert item(bar.view(), "white rum").state == "dont"
    bar.apply(BarChanges(have=["white rum"]))
    assert read_inventory(bar)["items"] == {"vodka": "have", "white rum": "have"}


def test_changes_to_virtual_item_create_catalog_entry(catalog, store, bar):
    entries(catalog, {"name": "angostura", "g_per_tsp": 4.6, "note": "by hand"})
    drink(store, "Jungle bird", "falernum", "angostura")
    view = bar.apply(BarChanges(kinds={"Falernum": "liqueurs"}, have=["angostura"]))
    assert item(view, "falernum").kind == "liqueurs"
    assert raw_named(catalog, "falernum") == [{"name": "falernum", "kind": "liqueurs"}]
    # An entry with no kind gets `other`, and keeps what it had.
    assert raw_named(catalog, "angostura") == [
        {"name": "angostura", "g_per_tsp": 4.6, "note": "by hand", "kind": "other"}
    ]
    refused(bar, "There is no ‘vodka’ in the bar.", kinds={"vodka": "spirits"})


def test_have_on_food_entry_takes_it_into_the_bar(catalog, bar):
    entries(catalog, {"name": "salt", "g_per_tsp": 6})
    refused(bar, "There is no ‘salt’ in the bar.", unsorted=["salt"])
    view = bar.apply(BarChanges(have=["Salt"]))
    assert item(view, "salt").state == "have"
    assert catalog.raw() == [{"name": "salt", "g_per_tsp": 6, "kind": "other"}]


def test_unchanged_files_are_not_rewritten(catalog, store, bar):
    entries(catalog, {"name": "gin", "kind": "spirits"})
    bar.apply(BarChanges(have=["gin"]))
    before = (catalog.path.stat().st_mtime_ns, bar.inventory_path.stat().st_mtime_ns)
    bar.apply(BarChanges(have=["gin"], kinds={"gin": "spirits"}))
    after = (catalog.path.stat().st_mtime_ns, bar.inventory_path.stat().st_mtime_ns)
    assert before == after


# --- changes: names ---


def test_add_name_taken_is_refused(catalog, store, bar):
    entries(catalog, {"name": "white rum", "aliases": ["light rum"]})
    drink(store, "Jungle bird", "white rum", "falernum", "gin")
    taken = "‘{}’ is already an item. Fold one into the other instead."
    refused(bar, taken.format("Light Rum"), add_names={"gin": ["Light Rum"]})
    refused(bar, taken.format("Falernum"), add_names={"gin": ["Falernum"]})
    refused(bar, "There is no ‘vodka’ in the bar.", add_names={"vodka": ["x"]})
    view = bar.apply(BarChanges(add_names={"Gin": ["genever", "gin"]}))
    assert item(view, "gin").aliases == ["genever"]
    assert raw_named(catalog, "gin") == [
        {"name": "gin", "aliases": ["genever"], "kind": "other"}
    ]


def test_remove_names(catalog, store, bar):
    entries(catalog, {"name": "white rum", "aliases": ["light rum", "silver rum"]})
    drink(store, "Daiquiri", "white rum", "falernum")
    refused(
        bar,
        "‘White rum’ has no other name ‘dark rum’.",
        remove_names={"White rum": ["dark rum"]},
    )
    refused(
        bar,
        "An item's own name can't be removed.",
        remove_names={"light rum": ["White Rum"]},
    )
    refused(
        bar,
        "‘falernum’ has no other name ‘velvet’.",
        remove_names={"falernum": ["velvet"]},
    )
    view = bar.apply(BarChanges(remove_names={"white rum": ["Light Rum"]}))
    assert item(view, "white rum").aliases == ["silver rum"]
    assert raw_named(catalog, "white rum")[0]["aliases"] == ["silver rum"]


def test_names_move_from_one_item_to_another(catalog, store, bar):
    entries(
        catalog,
        {"name": "gold rum", "aliases": ["light rum"], "kind": "spirits"},
        {"name": "white rum", "kind": "spirits"},
    )
    view = bar.apply(
        BarChanges(
            remove_names={"gold rum": ["light rum"]},
            add_names={"white rum": ["light rum"]},
        )
    )
    assert item(view, "gold rum").aliases == []
    assert item(view, "white rum").aliases == ["light rum"]


# --- changes: fold ---


def test_fold_moves_names_state_and_drinks(catalog, store, bar):
    entries(
        catalog,
        {
            "name": "demerara rum",
            "aliases": ["demerara"],
            "g_per_tsp": 5.0,
            "kind": "spirits",
        },
        {"name": "dark rum", "kind": "spirits"},
    )
    drink(store, "Old fashioned", "bourbon", "demerara rum")
    drink(store, "Zombie", "dark rum")
    write_inventory(bar, {"demerara": "have"})
    view = bar.apply(BarChanges(fold={"Demerara Rum": "dark rum"}))
    dark = item(view, "dark rum")
    assert dark.state == "have"
    assert dark.aliases == ["demerara rum", "demerara"]
    assert dark.used_in == [
        {"slug": "old-fashioned", "name": "Old fashioned"},
        {"slug": "zombie", "name": "Zombie"},
    ]
    assert names(view) == ["bourbon", "dark rum"]
    assert raw_named(catalog, "demerara rum") == []
    assert raw_named(catalog, "dark rum") == [
        {
            "name": "dark rum",
            "kind": "spirits",
            "aliases": ["demerara rum", "demerara"],
            "g_per_tsp": 5.0,
        }
    ]
    assert read_inventory(bar)["items"] == {"dark rum": "have"}
    assert view.ingredient("demerara rum")["item"] == "dark rum"

    refused(bar, "An item can't be folded into itself.", fold={"demerara": "Dark Rum"})
    refused(
        bar,
        "There is no ‘orgeat’ in the bar to fold into.",
        fold={"dark rum": "orgeat"},
    )
    refused(bar, "There is no ‘orgeat’ in the bar.", fold={"orgeat": "dark rum"})


def test_fold_keeps_the_targets_state(catalog, store, bar):
    entries(
        catalog,
        {"name": "gin", "kind": "spirits"},
        {"name": "london dry gin", "kind": "spirits"},
    )
    write_inventory(bar, {"gin": "dont", "london dry gin": "have"})
    view = bar.apply(BarChanges(fold={"gin": "london dry gin"}))
    assert item(view, "london dry gin").state == "have"
    assert read_inventory(bar)["items"] == {"london dry gin": "have"}


def test_fold_into_virtual_item_creates_entry(catalog, store, bar):
    entries(catalog, {"name": "velvet falernum", "kind": "liqueurs", "fresh": False})
    drink(store, "Jungle bird", "Falernum")
    drink(store, "Mai tai", "velvet falernum")
    bar.apply(BarChanges(have=["velvet falernum"]))
    view = bar.apply(BarChanges(fold={"velvet falernum": "falernum"}))
    falernum = item(view, "Falernum")
    assert (falernum.kind, falernum.state) == ("liqueurs", "have")
    assert len(falernum.used_in) == 2
    assert catalog.raw() == [
        {"name": "Falernum", "kind": "liqueurs", "aliases": ["velvet falernum"]}
    ]


def test_fold_virtual_item_into_entry(catalog, store, bar):
    entries(catalog, {"name": "white rum", "kind": "spirits"})
    drink(store, "Daiquiri", "Light rum")
    view = bar.apply(BarChanges(fold={"light rum": "white rum"}))
    assert names(view) == ["white rum"]
    assert item(view, "white rum").aliases == ["Light rum"]


# --- changes: delete ---


def test_delete_rules(catalog, store, bar):
    entries(
        catalog,
        {"name": "white rum", "kind": "spirits"},
        {"name": "campari", "kind": "aperitifs"},
        {"name": "angostura", "kind": "bitters", "g_per_tsp": 4.6},
    )
    drink(store, "Daiquiri", "white rum", "falernum")
    write_inventory(bar, {"campari": "have", "angostura": "dont", "white rum": "have"})
    used = "Only items no drink uses can be deleted."
    refused(bar, used, delete=["White Rum"])
    refused(bar, used, delete=["falernum"])
    refused(bar, "There is no ‘vodka’ in the bar.", delete=["vodka"])
    refused(
        bar, "Deleting isn't possible here.", allow_delete=False, delete=["campari"]
    )

    view = bar.apply(BarChanges(delete=["Campari", "angostura", "campari"]))
    assert names(view) == ["falernum", "white rum"]
    assert catalog.raw() == [
        {"name": "white rum", "kind": "spirits"},
        {"name": "angostura", "g_per_tsp": 4.6},
    ]
    assert read_inventory(bar)["items"] == {"white rum": "have"}


# --- refusals ---


@pytest.mark.parametrize(
    ("changes", "name"),
    [
        ({"have": ["gin"], "dont_have": ["Gin"]}, "gin"),
        ({"have": ["light rum"], "dont_have": ["white rum"]}, "light rum"),
        ({"dont_have": ["gin"], "unsorted": ["gin"]}, "gin"),
        ({"fresh": ["lime"], "not_fresh": ["lime"]}, "lime"),
        ({"have": ["lime"], "fresh": ["Lime"]}, "lime"),
        ({"kinds": {"gin": "spirits"}, "delete": ["gin"]}, "gin"),
        ({"fold": {"gin": "white rum"}, "delete": ["white rum"]}, "white rum"),
        ({"add_names": {"gin": ["x"]}, "remove_names": {"gin": ["X"]}}, "x"),
    ],
)
def test_conflicting_lists_refused(catalog, store, bar, changes, name):
    entries(
        catalog,
        {"name": "white rum", "aliases": ["light rum"], "kind": "spirits"},
        {"name": "gin", "kind": "spirits"},
    )
    refused(bar, f"‘{name}’ can't be changed two ways at once.", **changes)


def test_refused_change_writes_nothing(catalog, store, bar):
    entries(
        catalog,
        {"name": "white rum", "kind": "spirits"},
        {"name": "rhum agricole", "kind": "spirits"},
    )
    drink(store, "Daiquiri", "white rum")
    drink(store, "Jungle bird", "falernum")
    write_inventory(bar, {"white rum": "dont"})
    before = (catalog.path.read_bytes(), bar.inventory_path.read_bytes())
    refused(
        bar,
        "Only items no drink uses can be deleted.",
        fold={"rhum agricole": "white rum"},
        add_names={"white rum": ["light rum"]},
        fresh=["lime"],
        kinds={"white rum": "other"},
        have=["campari"],
        delete=["falernum"],
    )
    assert (catalog.path.read_bytes(), bar.inventory_path.read_bytes()) == before
    assert names(bar.view()) == ["falernum", "rhum agricole", "white rum"]


@pytest.mark.parametrize(
    "content",
    [
        b"{bad",
        b'{"format_version": 2, "items": {}}',
        b'{"format_version": 1, "items": []}',
        b'{"items": {}}',
        b'{"format_version": 1, "items": {"cr\xe8me": "have"}}',  # not UTF-8
    ],
)
def test_unreadable_inventory_refuses_writes(catalog, store, bar, caplog, content):
    entries(catalog, {"name": "gin", "kind": "spirits"})
    drink(store, "Gin shot", "gin", "vermouth")
    bar.inventory_path.write_bytes(content)
    before = (catalog.path.read_bytes(), bar.inventory_path.read_bytes())
    with caplog.at_level(logging.WARNING, logger="app.recipes"):
        view = bar.view()
    assert [i.state for i in view.items] == [None, None]
    assert "inventory.json" in caplog.text
    with pytest.raises(InventoryUnavailable) as exc:
        bar.apply(BarChanges(have=["gin"], kinds={"vermouth": "aperitifs"}))
    assert str(exc.value) == (
        "The bar's inventory can't be read, so it can't be changed. "
        "Fix inventory.json on the NAS."
    )
    assert (catalog.path.read_bytes(), bar.inventory_path.read_bytes()) == before


def test_unreadable_catalog_refuses_writes(catalog, store, bar):
    drink(store, "Gin shot", "gin")
    catalog.path.parent.mkdir(parents=True, exist_ok=True)
    catalog.path.write_text("{not json")
    assert names(bar.view()) == ["gin"]
    with pytest.raises(CatalogUnavailable):
        bar.apply(BarChanges(have=["gin"]))
    assert catalog.path.read_text() == "{not json"
    assert not bar.inventory_path.exists()


def test_undecodable_catalog_refuses_writes(catalog, store, bar):
    drink(store, "Gin shot", "gin")
    catalog.path.parent.mkdir(parents=True, exist_ok=True)
    content = b'{"format_version": 1, "ingredients": [{"name": "cr\xe8me"}]}'
    catalog.path.write_bytes(content)
    assert names(bar.view()) == ["gin"]
    with pytest.raises(CatalogUnavailable):
        bar.apply(BarChanges(have=["gin"]))
    assert catalog.path.read_bytes() == content


class _RacyBar(Bar):
    """A bar whose cache, once armed, is cleared right after it is next read.

    That is what a write on another thread does if it lands while `view()`
    is using the cache.
    """

    armed = False

    @property
    def _cache(self):
        value = self.__dict__["_racy_cache"]
        if self.armed:
            self.armed = False
            self.__dict__["_racy_cache"] = (None, {})
        return value

    @_cache.setter
    def _cache(self, value):
        self.__dict__["_racy_cache"] = value


def test_view_never_sees_a_cache_cleared_under_it(tmp_path, catalog, store):
    drink(store, "Gin shot", "gin")
    bar = _RacyBar(tmp_path, catalog, store)
    write_inventory(bar, {"gin": "have"})
    assert item(bar.view(), "gin").state == "have"  # fills the cache
    bar.armed = True
    assert item(bar.view(), "gin").state == "have"  # served from the cache


def test_concurrent_changes_are_all_kept(store, bar):
    names_ = [f"bottle {i}" for i in range(20)]
    threads = [
        threading.Thread(target=bar.apply, args=(BarChanges(have=[name]),))
        for name in names_
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert sorted(read_inventory(bar)["items"]) == sorted(names_)


def test_too_many_names_refused():
    BarChanges(have=[f"x{i}" for i in range(200)])
    BarChanges(
        have=[f"x{i}" for i in range(150)],
        add_names={"gin": [f"y{i}" for i in range(49)]},
    )
    with pytest.raises(ValidationError, match="That's too many changes at once."):
        BarChanges(have=[f"x{i}" for i in range(201)])
    with pytest.raises(ValidationError, match="That's too many changes at once."):
        BarChanges(
            have=[f"x{i}" for i in range(150)],
            add_names={"gin": [f"y{i}" for i in range(50)]},
        )


@pytest.mark.parametrize(
    "data",
    [
        {"kinds": {"gin": "wine"}},
        {"have": ["gin"], "colour": "red"},
        {"have": ["  "]},
        {"fold": {"gin": ""}},
    ],
)
def test_bad_changes_fail_validation(data):
    with pytest.raises(ValidationError):
        BarChanges.model_validate(data)


# --- scale ---


def count_calls(monkeypatch, module, name) -> list:
    """Every call of `module.name` from here on, by its arguments."""
    calls = []
    real = getattr(module, name)

    def counted(*args, **kwargs):
        calls.append(args)
        return real(*args, **kwargs)

    monkeypatch.setattr(module, name, counted)
    return calls


def count_registries(monkeypatch) -> list:
    """Every registry built from here on."""
    builds = []

    class Counted(bar_module._Registry):
        def __init__(self, *args):
            builds.append(args)
            super().__init__(*args)

    monkeypatch.setattr(bar_module, "_Registry", Counted)
    return builds


def test_a_view_compares_names_in_linear_time(monkeypatch, catalog, store, bar):
    bottles = [f"bottle {i}" for i in range(120)]
    for i in range(150):
        drink(store, f"Drink {i}", *(bottles[(i * 7 + j * 13) % 120] for j in range(5)))
    entries(
        catalog,
        *(
            {"name": name, "kind": "spirits", "aliases": [f"{name} alias"]}
            for name in bottles[:60]
        ),
    )
    bar.apply(BarChanges(have=bottles[:60], dont_have=bottles[60:]))
    calls = count_calls(monkeypatch, bar_module, "name_key")
    view = bar.view()
    view.json()
    assert len(view.items) == 120
    # A handful of comparisons per item, alias and ingredient line, never one
    # per item per inventory name.
    assert len(calls) <= 8 * (120 + 60 + 150 * 5)


@pytest.mark.parametrize("catalogued", [False, True])
def test_a_bulk_change_builds_the_registry_a_few_times(
    monkeypatch, catalog, store, bar, catalogued
):
    bottles = [f"bottle {i}" for i in range(100)]
    for i in range(20):
        drink(store, f"Drink {i}", *bottles[i * 5 : i * 5 + 5])
    if catalogued:  # entries without a kind, which the change gives one
        entries(catalog, *({"name": name} for name in bottles))
    builds = count_registries(monkeypatch)
    view = bar.apply(BarChanges(dont_have=bottles))
    assert len(builds) <= 3
    assert catalog.raw() == [{"name": name, "kind": "other"} for name in bottles]
    assert read_inventory(bar)["items"] == dict.fromkeys(bottles, "dont")
    assert all(i.state == "dont" for i in view.items)
