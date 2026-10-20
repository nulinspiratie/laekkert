import json

from conftest import call, rpc
from test_mcp_writes import text


def tool(client, name):
    tools = rpc(client, 2, "tools/list").json()["result"]["tools"]
    return next(t for t in tools if t["name"] == name)


def manage(client, **arguments):
    return call(client, "manage_inventory", arguments)


def drinks(client, name="list_recipes", **arguments):
    result = call(client, name, {"side": "drinks", **arguments})
    assert result["isError"] is False, result
    return {r["slug"]: r for r in result["structuredContent"]["result"]}


def test_read_bar(client):
    res = call(client, "read_bar", {})
    assert res["isError"] is False
    bar = res["structuredContent"]
    assert bar == client.get("/api/bar").json()
    assert bar["set_up"] is False
    assert {i["name"] for i in bar["items"]} >= {"white rum", "simple syrup"}


def test_manage_inventory_sets_state(client, tmp_path):
    res = manage(
        client,
        have=["white rum"],
        dont_have=["simple syrup"],
        kinds={"white rum": "spirits"},
        add_names={"white rum": ["rum"]},
    )
    assert res["isError"] is False, res
    bar = res["structuredContent"]
    rum = next(i for i in bar["items"] if i["name"] == "white rum")
    assert rum["state"] == "have"
    assert rum["kind"] == "spirits"
    assert rum["aliases"] == ["rum"]
    assert bar["set_up"] is True
    assert bar == call(client, "read_bar", {})["structuredContent"]
    stored = json.loads((tmp_path / "inventory.json").read_text(encoding="utf-8"))
    assert stored["items"] == {"white rum": "have", "simple syrup": "dont"}


def test_manage_inventory_fresh_items_are_never_tracked(client, tmp_path):
    res = manage(client, have=["white rum"], fresh=["lime juice", "mint"])
    bar = res["structuredContent"]
    lime = next(i for i in bar["items"] if i["name"] == "lime juice")
    assert (lime["fresh"], lime["state"]) == (True, None)
    # An unknown name is added, and a fresh one is not put in the inventory.
    res = manage(client, fresh=["tonic"], have=["campari"], dont_have=["falernum"])
    names = {i["name"] for i in res["structuredContent"]["items"]}
    assert {"tonic", "campari", "falernum"} <= names
    stored = json.loads((tmp_path / "inventory.json").read_text(encoding="utf-8"))
    assert set(stored["items"]) == {"white rum", "campari", "falernum"}


def test_manage_inventory_refusal_is_tool_error(client, tmp_path):
    res = manage(client, remove_names={"white rum": ["rum"]})
    assert text(res) == "‘white rum’ has no other name ‘rum’."
    res = manage(client, add_names={"nothing": ["x"]})
    assert text(res) == "There is no ‘nothing’ in the bar."
    res = manage(client, have=["white rum"], dont_have=["white rum"])
    assert text(res) == "‘white rum’ can't be changed two ways at once."
    res = manage(client, have=[" "])
    assert text(res) == "A name can't be empty."
    res = manage(client, have=[f"x{n}" for n in range(201)])
    assert text(res) == "That's too many changes at once."
    assert not (tmp_path / "inventory.json").exists()


def test_manage_inventory_invalid_kind_is_a_sentence(client):
    res = manage(client, kinds={"white rum": "wine-ish"})
    assert text(res) == (
        "‘wine-ish’ isn't a kind. Use spirits, liqueurs, aperitifs, bitters, "
        "syrups or other."
    )


def test_manage_inventory_unreadable_inventory_is_tool_error(client, tmp_path):
    (tmp_path / "inventory.json").write_text("{nope")
    res = manage(client, have=["white rum"])
    assert "inventory.json" in text(res)
    assert (tmp_path / "inventory.json").read_text() == "{nope"


def test_manage_inventory_unreadable_catalog_is_tool_error(client, tmp_path):
    (tmp_path / "catalog" / "ingredients.json").write_text("{nope")
    res = manage(client, have=["white rum"])
    assert text(res)
    assert not (tmp_path / "inventory.json").exists()


def test_manage_inventory_has_no_delete(client):
    schema = tool(client, "manage_inventory")["inputSchema"]
    assert set(schema["properties"]) == {
        "have",
        "dont_have",
        "fresh",
        "not_fresh",
        "kinds",
        "add_names",
        "remove_names",
        "fold",
    }
    assert "delete" not in schema["properties"]
    assert "unsorted" not in schema["properties"]
    assert schema.get("required", []) == []
    # A client that sends it anyway gets nothing deleted.
    manage(client, delete=["white rum"])
    bar = call(client, "read_bar", {})["structuredContent"]
    assert "white rum" in {i["name"] for i in bar["items"]}


def test_search_recipes_bar_filter(client):
    assert drinks(client, "search_recipes", bar="can_make") == {}
    manage(
        client,
        have=["white rum", "simple syrup", "lime juice"],
        not_fresh=["lime juice"],
    )
    assert set(drinks(client, "search_recipes", bar="can_make")) == {"daiquiri"}
    assert set(drinks(client, "search_recipes", bar="fresh_only")) == {"virgin-mojito"}
    assert set(drinks(client, "search_recipes")) == {"daiquiri", "virgin-mojito"}
    both = drinks(client, "search_recipes", bar="can_make", query="mojito")
    assert both == {}


def test_search_recipes_bar_filter_food_refused(client):
    res = call(client, "search_recipes", {"side": "food", "bar": "can_make"})
    assert text(res) == "The bar filter is for drinks only."


def test_search_recipes_bar_filter_rejects_other_values(client):
    res = call(client, "search_recipes", {"side": "drinks", "bar": "missing"})
    assert res["isError"] is True


def test_list_recipes_drinks_have_bar(client):
    listed = drinks(client)
    assert listed["daiquiri"]["bar"] == {
        "status": "unsorted",
        "missing": [],
        "unsorted": ["white rum", "simple syrup"],
        "fresh": ["lime juice"],
    }
    assert "bar" in drinks(client, "search_recipes")["daiquiri"]
    food = call(client, "list_recipes", {"side": "food"})["structuredContent"]["result"]
    assert food
    assert all("bar" not in r for r in food)
    food = call(client, "search_recipes", {"side": "food"})["structuredContent"]
    assert all("bar" not in r for r in food["result"])


def test_instructions_mention_bar(client):
    r = rpc(
        client,
        1,
        "initialize",
        {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": {"name": "t", "version": "1"},
        },
    )
    instructions = r.json()["result"]["instructions"]
    assert instructions.endswith(
        " Drinks have a bar of bottles the household has or doesn't have "
        "(read_bar, manage_inventory); fresh items such as limes are never tracked."
    )
