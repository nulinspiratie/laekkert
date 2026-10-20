import json

import pytest

from app.recipes.bar import Bar, InventoryUnavailable
from app.recipes.catalog import Catalog, CatalogUnavailable
from app.recipes.drafts import parse_draft
from app.recipes.ingredients import IngredientError
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


@pytest.fixture
def seeded(catalog, store):
    assert catalog.seed_if_missing()
    assert store.seed_if_empty()


def recipe(store, side, name, *items):
    """A recipe saved through the store, one ingredient per item."""
    return store.create(
        side,
        parse_draft(
            {
                "name": name,
                "category": "mains" if side == "food" else "cocktails",
                "servings": 1,
                "time_minutes": None,
                "ingredients": [
                    {"amount": 10, "unit": "g", "item": item} for item in items
                ],
                "steps": [],
                "source": None,
                "tags": [],
                "image": None,
            }
        ),
        "app",
    )


def food(store, name, *items):
    return recipe(store, "food", name, *items)


def drink(store, name, *items):
    return recipe(store, "drinks", name, *items)


def entries(catalog, *raw):
    catalog.save_raw(list(raw))


def named(listing, name):
    found = [i for i in listing if i["name"] == name]
    assert len(found) == 1, f"{name} not listed once: {[i['name'] for i in listing]}"
    return found[0]


def recipe_files(store):
    return {
        path: path.read_bytes()
        for path in sorted(store.recipes_dir.rglob("*"))
        if path.is_file()
    }


def refused(bar, catalog, sentence, merges=None, separate=None):
    before = catalog.path.read_bytes() if catalog.path.exists() else None
    with pytest.raises(IngredientError) as exc:
        bar.merge_ingredients(merges or {}, separate or [])
    assert str(exc.value) == sentence
    after = catalog.path.read_bytes() if catalog.path.exists() else None
    assert after == before


# --- listing ---


def test_list_ingredients_food(seeded, bar):
    listing = bar.ingredients("food")
    assert {
        "name": "salt",
        "other_names": ["fine salt", "sea salt"],
        "recipes": {"food": 2, "drinks": 0},
        "in_catalog": True,
        "g_per_tsp": 6,
        "fresh": False,
        "kind": None,
    } in listing
    listed = {i["name"] for i in listing}
    # Drinks-only entries and items, and catalog entries no recipe uses.
    assert not listed & {"white rum", "lime juice", "simple syrup", "honey", "sugar"}
    assert all(i["recipes"]["food"] > 0 for i in listing)
    leeks = named(listing, "leeks")
    assert (leeks["in_catalog"], leeks["other_names"]) == (False, [])
    assert named(listing, "ground turmeric")["recipes"] == {"food": 1, "drinks": 0}


def test_list_ingredients_drinks(seeded, bar):
    listing = bar.ingredients("drinks")
    assert [i["name"] for i in listing] == [
        "lime juice",
        "mint",
        "simple syrup",
        "soda water",
        "white rum",
    ]
    assert named(listing, "mint")["other_names"] == ["mint leaves"]
    assert named(listing, "white rum")["kind"] == "spirits"
    assert named(listing, "lime juice")["recipes"] == {"food": 0, "drinks": 2}


def test_list_ingredients_all_includes_unused_catalog(seeded, bar):
    listing = bar.ingredients(None)
    assert named(listing, "honey") == {
        "name": "honey",
        "other_names": [],
        "recipes": {"food": 0, "drinks": 0},
        "in_catalog": True,
        "g_per_tsp": 7,
        "fresh": False,
        "kind": None,
    }
    assert named(listing, "salt")["recipes"] == {"food": 2, "drinks": 0}
    assert named(listing, "white rum")["recipes"] == {"food": 0, "drinks": 1}
    names = [i["name"] for i in listing]
    assert names == sorted(names, key=str.casefold)
    assert len(names) == len(set(names))


def test_list_sorts_case_insensitively(catalog, store, bar):
    food(store, "Toast", "Butter", "apricot jam", "bread")
    assert [i["name"] for i in bar.ingredients("food")] == [
        "apricot jam",
        "bread",
        "Butter",
    ]


def test_name_is_first_recipe_spelling_food_before_drinks(catalog, store, bar):
    drink(store, "Alpha", "Sugar")
    food(store, "Zebra cake", "SUGAR")
    food(store, "Beta cake", "sugar")
    listing = bar.ingredients(None)
    assert named(listing, "sugar")["recipes"] == {"food": 2, "drinks": 1}
    assert named(bar.ingredients("drinks"), "sugar")["in_catalog"] is False


def test_other_names_include_recipe_spellings(catalog, store, bar):
    entries(
        catalog,
        {"name": "leek", "aliases": ["leeks"]},
        {"name": "ground cumin"},
    )
    food(store, "Soup", "Leeks", "Ground Cumin")
    food(store, "Pie", "leek")
    listing = bar.ingredients("food")
    assert named(listing, "leek")["other_names"] == ["leeks"]
    assert named(listing, "leek")["recipes"] == {"food": 2, "drinks": 0}
    assert named(listing, "ground cumin")["other_names"] == []
    assert [i["name"] for i in listing] == ["ground cumin", "leek"]


def test_first_entry_wins_on_a_taken_name(catalog, store, bar):
    entries(
        catalog,
        {"name": "coriander", "aliases": ["cilantro"]},
        {"name": "Cilantro", "g_per_tsp": 1},
        {"name": "parsley", "aliases": ["coriander", "flat parsley"]},
    )
    food(store, "Salsa", "cilantro", "flat parsley")
    listing = bar.ingredients(None)
    assert [i["name"] for i in listing] == ["coriander", "parsley"]
    assert named(listing, "coriander")["other_names"] == ["cilantro"]
    assert named(listing, "parsley")["other_names"] == ["flat parsley"]


def test_list_with_unreadable_catalog_uses_recipes(catalog, store, bar):
    food(store, "Soup", "leeks")
    catalog.path.parent.mkdir(parents=True, exist_ok=True)
    catalog.path.write_text("not json")
    assert [i["name"] for i in bar.ingredients(None)] == ["leeks"]


# --- merging ---


def test_merge_food_names(catalog, store, bar, tmp_path):
    food(store, "Soup", "leeks", "onion")
    food(store, "Pie", "leek")
    files = recipe_files(store)
    result = bar.merge_ingredients({"leeks": "leek"}, [])
    assert catalog.raw() == [{"name": "leek", "aliases": ["leeks"]}]
    assert result == [
        {
            "name": "leek",
            "other_names": ["leeks"],
            "recipes": {"food": 2, "drinks": 0},
            "in_catalog": True,
            "g_per_tsp": None,
            "fresh": False,
            "kind": None,
        }
    ]
    assert recipe_files(store) == files
    assert all("kind" not in entry for entry in catalog.raw())
    assert not bar.inventory_path.exists()
    assert [i["name"] for i in bar.ingredients("food")] == ["leek", "onion"]


def test_merge_names_the_new_entry_as_recipes_write_it(catalog, store, bar):
    food(store, "Soup", "Leek", "leeks")
    bar.merge_ingredients({" Leeks ": "LEEK"}, [])
    # The aliases gain the name as recipes write it, not as given.
    assert catalog.raw() == [{"name": "Leek", "aliases": ["leeks"]}]


def test_merge_returns_touched_in_call_order(catalog, store, bar):
    food(store, "Salsa", "cilantro", "coriander", "leeks", "leek", "spring onion")
    result = bar.merge_ingredients(
        {"cilantro": "coriander", "leeks": "leek", "spring onion": "leek"}, []
    )
    assert [i["name"] for i in result] == ["coriander", "leek"]
    assert result[1]["other_names"] == ["leeks", "spring onion"]


def test_merge_copies_missing_fields_and_keeps_targets(catalog, store, bar):
    entries(
        catalog,
        {"name": "caster sugar", "g_per_tsp": 4.2, "note": "x"},
        {"name": "sugar", "g_per_tsp": 4},
    )
    [result] = bar.merge_ingredients({"caster sugar": "sugar"}, [])
    assert catalog.raw() == [
        {"name": "sugar", "g_per_tsp": 4, "note": "x", "aliases": ["caster sugar"]}
    ]
    assert (result["g_per_tsp"], result["other_names"]) == (4, ["caster sugar"])


def test_merge_copies_fields_into_a_new_entry(catalog, store, bar):
    entries(catalog, {"name": "jeera", "g_per_tsp": 2.1, "fresh": False})
    food(store, "Dal", "cumin seeds")
    bar.merge_ingredients({"jeera": "cumin seeds"}, [])
    assert catalog.raw() == [
        {
            "name": "cumin seeds",
            "g_per_tsp": 2.1,
            "fresh": False,
            "aliases": ["jeera"],
        }
    ]


def test_merge_keeps_other_entries_in_place(catalog, store, bar):
    entries(
        catalog,
        {"name": "salt", "g_per_tsp": 6},
        {"name": "leeks", "aliases": ["baby leeks"]},
        "not an entry",
        {"name": "leek"},
        {"name": "honey", "g_per_tsp": 7},
    )
    bar.merge_ingredients({"leeks": "leek"}, [])
    assert catalog.raw() == [
        {"name": "salt", "g_per_tsp": 6},
        "not an entry",
        {"name": "leek", "aliases": ["leeks", "baby leeks"]},
        {"name": "honey", "g_per_tsp": 7},
    ]


def test_merge_into_bar_item_keeps_bar(catalog, store, bar):
    entries(catalog, {"name": "caster sugar", "g_per_tsp": 4.2})
    drink(store, "Old fashioned", "bourbon", "sugar")
    food(store, "Cake", "caster sugar", "flour")
    bar.inventory_path.write_text(
        json.dumps({"format_version": 1, "items": {"sugar": "have"}})
    )
    inventory = bar.inventory_path.read_bytes()
    before = bar.view().json()
    [result] = bar.merge_ingredients({"caster sugar": "sugar"}, [])
    assert bar.inventory_path.read_bytes() == inventory
    after = bar.view().json()
    sugar = [i for i in after["items"] if i["name"] == "sugar"]
    assert sugar[0]["aliases"] == ["caster sugar"]
    sugar[0]["aliases"] = []
    assert after == before
    assert result["recipes"] == {"food": 1, "drinks": 1}
    assert result["kind"] is None
    assert catalog.raw() == [
        {"name": "sugar", "g_per_tsp": 4.2, "aliases": ["caster sugar"]}
    ]


def test_merge_moves_whole_identity(seeded, catalog, store, bar):
    food(store, "Curry", "jeera")
    [result] = bar.merge_ingredients({"cumin": "jeera"}, [])
    assert not [e for e in catalog.raw() if e["name"] == "ground cumin"]
    [jeera] = [e for e in catalog.raw() if e["name"] == "jeera"]
    assert jeera == {
        "name": "jeera",
        "g_per_tsp": 2.1,
        "aliases": ["ground cumin", "cumin"],
    }
    assert result["other_names"] == ["ground cumin", "cumin"]


def test_merge_refusals(seeded, catalog, store, bar):
    entries(
        catalog,
        *catalog.raw(),
        {"name": "gin", "kind": "spirits"},
        {"name": "rosemary", "aliases": ["rosmarin"]},
    )
    bar.inventory_path.write_text(
        json.dumps({"format_version": 1, "items": {"rosmarin": "have"}})
    )
    food(store, "Pie", "leek", "onion")
    refused(bar, catalog, "There is no ingredient ‘nope’.", {"nope": "salt"})
    refused(bar, catalog, "There is no ingredient ‘nope’.", {" salt ": " nope "})
    refused(
        bar,
        catalog,
        "‘cumin’ and ‘ground cumin’ are already the same ingredient.",
        {"cumin": "ground cumin"},
    )
    refused(
        bar,
        catalog,
        "‘Leek’ and ‘leek’ are already the same ingredient.",
        {"Leek": "leek"},
    )
    on_bar = "‘{}’ is on the bar. Fold it there instead (manage_inventory)."
    refused(bar, catalog, on_bar.format("white rum"), {"white rum": "salt"})
    refused(bar, catalog, on_bar.format("lime juice"), {"lime juice": "salt"})
    refused(bar, catalog, on_bar.format("gin"), {"gin": "salt"})
    refused(bar, catalog, on_bar.format("rosemary"), {"rosemary": "salt"})
    refused(
        bar,
        catalog,
        "Chains aren't allowed in one call: ‘b’ is merged and merged into.",
        {"a": "b", "b": "c"},
    )
    refused(
        bar,
        catalog,
        "Chains aren't allowed in one call: ‘Leek’ is merged and merged into.",
        {"onion": "Leek", "leek": "salt"},
    )
    refused(
        bar,
        catalog,
        "‘leeks’ is merged twice.",
        {"Leeks": "leek", "leeks ": "onion"},
    )
    refused(
        bar,
        catalog,
        "‘leeks’ can't be merged and separated in one call.",
        {"leeks": "leek"},
        ["Leeks"],
    )
    refused(bar, catalog, "A name can't be empty.", {"": "x"})
    refused(bar, catalog, "A name can't be empty.", {"leeks": "  "})
    refused(bar, catalog, "A name can't be empty.", {}, [" "])
    refused(bar, catalog, "Nothing to change.")
    # A later refusal undoes the earlier merges of the call.
    refused(
        bar,
        catalog,
        "There is no ingredient ‘nope’.",
        {"leeks": "leek", "nope": "salt"},
    )
    refused(
        bar,
        catalog,
        "‘onion’ isn't another name of anything.",
        {"leeks": "leek"},
        ["onion"],
    )


def test_merge_refuses_unreadable_catalog(catalog, store, bar):
    food(store, "Soup", "leeks", "leek")
    catalog.path.parent.mkdir(parents=True, exist_ok=True)
    catalog.path.write_text("not json")
    with pytest.raises(CatalogUnavailable):
        bar.merge_ingredients({"leeks": "leek"}, [])
    assert catalog.path.read_text() == "not json"


def test_merge_refuses_unreadable_inventory(catalog, store, bar):
    food(store, "Soup", "leeks", "leek")
    entries(catalog, {"name": "salt"})
    before = catalog.path.read_bytes()
    bar.inventory_path.write_text("not json")
    with pytest.raises(InventoryUnavailable):
        bar.merge_ingredients({"leeks": "leek"}, [])
    assert catalog.path.read_bytes() == before
    assert bar.inventory_path.read_text() == "not json"


# --- separating ---


def test_separate(catalog, store, bar):
    food(store, "Soup", "leeks", "onion")
    food(store, "Pie", "leek")
    bar.merge_ingredients({"leeks": "leek"}, [])
    [result] = bar.merge_ingredients({}, [" Leeks "])
    [leek] = catalog.raw()
    assert leek["name"] == "leek"
    assert leek.get("aliases", []) == []
    assert result == {
        "name": "leeks",
        "other_names": [],
        "recipes": {"food": 1, "drinks": 0},
        "in_catalog": False,
        "g_per_tsp": None,
        "fresh": False,
        "kind": None,
    }
    listing = bar.ingredients("food")
    assert [i["name"] for i in listing] == ["leek", "leeks", "onion"]
    assert named(listing, "leek")["other_names"] == []
    refused(
        bar,
        catalog,
        "‘leek’ is the main name of its ingredient. "
        "Merge it into another name instead.",
        separate=["leek"],
    )
    refused(bar, catalog, "‘onion’ isn't another name of anything.", separate=["onion"])
    refused(bar, catalog, "‘nope’ isn't another name of anything.", separate=["nope"])


def test_separate_keeps_copied_fields_with_the_entry(catalog, store, bar):
    entries(
        catalog,
        {"name": "caster sugar", "g_per_tsp": 4.2},
        {"name": "sugar"},
    )
    food(store, "Cake", "caster sugar")
    bar.merge_ingredients({"caster sugar": "sugar"}, [])
    [result] = bar.merge_ingredients({}, ["caster sugar"])
    assert catalog.raw() == [{"name": "sugar", "g_per_tsp": 4.2, "aliases": []}]
    assert (result["name"], result["in_catalog"], result["g_per_tsp"]) == (
        "caster sugar",
        False,
        None,
    )


def test_separate_an_alias_no_recipe_uses(seeded, catalog, bar):
    [result] = bar.merge_ingredients({}, ["fine salt", "Fine Salt"])
    [salt] = [e for e in catalog.raw() if e["name"] == "salt"]
    assert salt["aliases"] == ["sea salt"]
    assert result == {
        "name": "fine salt",
        "other_names": [],
        "recipes": {"food": 0, "drinks": 0},
        "in_catalog": False,
        "g_per_tsp": None,
        "fresh": False,
        "kind": None,
    }
    assert "fine salt" not in [i["name"] for i in bar.ingredients(None)]


def test_merge_then_separate_in_one_call(catalog, store, bar):
    entries(catalog, {"name": "coriander", "aliases": ["dhania"]})
    food(store, "Salsa", "cilantro", "coriander", "dhania")
    result = bar.merge_ingredients({"cilantro": "coriander"}, ["dhania"])
    assert catalog.raw() == [{"name": "coriander", "aliases": ["cilantro"]}]
    assert [i["name"] for i in result] == ["coriander", "dhania"]
