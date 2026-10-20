import json

from conftest import call, rpc
from test_mcp_bar import tool
from test_mcp_writes import text

from app.mcp_server import INSTRUCTIONS, STYLE_GUIDE
from app.recipes.bar import TOO_MANY, UNAVAILABLE
from app.recipes.catalog import UNAVAILABLE as CATALOG_UNAVAILABLE


def recipe(name, *items):
    return {
        "name": name,
        "category": "mains",
        "servings": 2,
        "ingredients": [{"amount": 100, "unit": "g", "item": item} for item in items],
        "steps": ["Cook."],
    }


def add(client, name, *items):
    res = call(client, "add_recipe", {"side": "food", "recipe": recipe(name, *items)})
    assert res["isError"] is False, res


def listing(client, **arguments):
    res = call(client, "list_ingredients", arguments)
    assert res["isError"] is False, res
    return res["structuredContent"]["result"]


def merge(client, **arguments):
    return call(client, "merge_ingredients", arguments)


def named(entries, name):
    return next(e for e in entries if e["name"] == name)


def catalog_bytes(tmp_path):
    return (tmp_path / "catalog" / "ingredients.json").read_bytes()


def test_tools_are_listed(client):
    tools = rpc(client, 2, "tools/list").json()["result"]["tools"]
    names = {t["name"] for t in tools}
    assert {"list_ingredients", "merge_ingredients"} <= names
    side = tool(client, "list_ingredients")["inputSchema"]
    assert set(side["properties"]) == {"side"}
    assert side.get("required", []) == []
    merging = tool(client, "merge_ingredients")["inputSchema"]
    assert set(merging["properties"]) == {"merges", "separate"}
    assert merging.get("required", []) == []


def test_list_ingredients_matches_the_bar(client):
    food = listing(client, side="food")
    assert {
        "name": "salt",
        "other_names": ["fine salt", "sea salt"],
        "recipes": {"food": 2, "drinks": 0},
        "in_catalog": True,
        "g_per_tsp": 6,
        "fresh": False,
        "kind": None,
    } in food
    assert [e["name"] for e in food] == sorted(
        (e["name"] for e in food), key=str.casefold
    )
    assert all(e["recipes"]["food"] > 0 for e in food)
    # Without a side, catalog entries no recipe uses are there with zero counts.
    everything = listing(client)
    assert named(everything, "honey")["recipes"] == {"food": 0, "drinks": 0}
    assert "honey" not in {e["name"] for e in listing(client, side="drinks")}


def test_merge_and_separate_round_trip(client):
    add(client, "Samphire bake", "samphire")
    add(client, "Samphire soup", "samphires")
    res = merge(client, merges={"samphires": "samphire"})
    assert res["isError"] is False, res
    [found] = res["structuredContent"]["ingredients"]
    assert (found["name"], found["other_names"], found["in_catalog"]) == (
        "samphire",
        ["samphires"],
        True,
    )
    assert found["recipes"] == {"food": 2, "drinks": 0}
    # Recipes keep their wording.
    shown = call(client, "read_recipe", {"side": "food", "slug": "samphire-soup"})
    assert shown["structuredContent"]["ingredients"][0]["item"] == "samphires"
    assert named(listing(client, side="food"), "samphire")["other_names"] == [
        "samphires"
    ]
    res = merge(client, separate=["samphires"])
    assert res["isError"] is False, res
    [apart] = res["structuredContent"]["ingredients"]
    assert (apart["name"], apart["in_catalog"], apart["recipes"]["food"]) == (
        "samphires",
        False,
        1,
    )
    assert named(listing(client, side="food"), "samphire")["other_names"] == []


def test_merge_refusals_are_sentences(client, tmp_path):
    before = catalog_bytes(tmp_path)
    res = merge(client, merges={"nope": "salt"})
    assert text(res) == "There is no ingredient ‘nope’."
    res = merge(client, merges={"white rum": "salt"})
    assert (
        text(res)
        == "‘white rum’ is on the bar. Fold it there instead (manage_inventory)."
    )
    res = merge(client, separate=["salt"])
    assert text(res) == (
        "‘salt’ is the main name of its ingredient. Merge it into another name instead."
    )
    res = merge(client)
    assert text(res) == "Nothing to change."
    res = merge(client, merges={" ": "salt"})
    assert text(res) == "A name can't be empty."
    assert catalog_bytes(tmp_path) == before


def test_merge_refuses_too_many_names(client, tmp_path):
    before = catalog_bytes(tmp_path)
    res = merge(client, merges={f"a{n}": f"b{n}" for n in range(101)})
    assert text(res) == TOO_MANY
    res = merge(client, separate=[f"x{n}" for n in range(201)])
    assert text(res) == TOO_MANY
    assert catalog_bytes(tmp_path) == before


def test_unreadable_catalog_is_tool_error(client, tmp_path):
    (tmp_path / "catalog" / "ingredients.json").write_text("{nope")
    assert text(merge(client, separate=["x"])) == CATALOG_UNAVAILABLE
    assert (tmp_path / "catalog" / "ingredients.json").read_text() == "{nope"
    # Reading is as forgiving as everywhere else: the catalog is ignored.
    assert call(client, "list_ingredients", {})["isError"] is False


def test_unreadable_inventory_is_tool_error(client, tmp_path):
    (tmp_path / "inventory.json").write_text("{nope")
    res = merge(client, merges={"sea salt": "salt"})
    assert text(res) == UNAVAILABLE
    assert (tmp_path / "inventory.json").read_text() == "{nope"


def test_instructions_and_style_guide_mention_them():
    assert "merge_ingredients" in INSTRUCTIONS
    assert "list_ingredients" in INSTRUCTIONS
    assert "wording" in INSTRUCTIONS
    assert "list_ingredients" in STYLE_GUIDE


def test_style_guide_tool_mentions_list_ingredients(client):
    res = call(client, "get_style_guide", {})
    assert "list_ingredients" in res["content"][0]["text"]
    json.dumps(res)
