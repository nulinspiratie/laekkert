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
        dont_have=["campari"],
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
    assert stored["items"] == {"white rum": "have", "campari": "dont"}


def test_manage_inventory_untracked_items_are_never_tracked(client, tmp_path):
    res = manage(client, have=["white rum"], untrack=["lime juice", "mint"])
    bar = res["structuredContent"]
    lime = next(i for i in bar["items"] if i["name"] == "lime juice")
    assert (lime["tracked"], lime["state"]) == (False, None)
    # An unknown name is added, and an untracked one is not put in the inventory.
    res = manage(client, untrack=["tonic"], have=["campari"], dont_have=["falernum"])
    names = {i["name"] for i in res["structuredContent"]["items"]}
    assert {"tonic", "campari", "falernum"} <= names
    stored = json.loads((tmp_path / "inventory.json").read_text(encoding="utf-8"))
    assert set(stored["items"]) == {"white rum", "campari", "falernum"}
    # Syrups are skipped silently, in the same call as the bottles.
    res = manage(client, have=["simple syrup", "gin"])
    assert res["isError"] is False
    syrup = next(
        i for i in res["structuredContent"]["items"] if i["name"] == "simple syrup"
    )
    assert (syrup["tracked"], syrup["state"]) == (False, None)


def test_manage_inventory_track_undoes_untrack(client):
    manage(client, untrack=["white rum"])
    res = manage(client, track=["white rum"])
    rum = next(i for i in res["structuredContent"]["items"] if i["name"] == "white rum")
    assert (rum["tracked"], rum["state"]) == (True, None)


def test_manage_inventory_track_refusal_is_a_sentence(client):
    res = manage(client, track=["simple syrup"])
    assert text(res) == (
        "Syrups aren't tracked. Give ‘simple syrup’ another kind first."
    )


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
        "untrack",
        "track",
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
    # Out of the box only the mocktail has no tracked bottle to wait for.
    assert set(drinks(client, "search_recipes", bar="can_make")) == {"virgin-mojito"}
    manage(client, have=["white rum"])
    assert set(drinks(client, "search_recipes", bar="can_make")) == {
        "daiquiri",
        "virgin-mojito",
    }
    manage(client, dont_have=["white rum"])
    assert set(drinks(client, "search_recipes", bar="can_make")) == {"virgin-mojito"}
    both = drinks(client, "search_recipes", bar="can_make", query="daiquiri")
    assert both == {}


def test_search_recipes_bar_filter_leaves_out_syrups_and_prep(client):
    detail = client.get("/api/recipes/drinks/daiquiri").json()
    keep = "name category servings time_minutes ingredients steps source tags image"
    draft = {key: detail[key] for key in keep.split()}
    draft["ingredients"] = [
        {k: v for k, v in i.items() if k not in ("g_per_tsp", "bar")}
        for i in detail["ingredients"]
    ]
    for name, category in (("Honey syrup", "syrups"), ("Lime cordial", "prep")):
        body = {**draft, "side": "drinks", "name": name, "category": category}
        assert client.post("/api/recipes", json=body).status_code == 201
    made = drinks(client)
    assert made["honey-syrup"]["bar"] is None and made["lime-cordial"]["bar"] is None
    found = drinks(client, "search_recipes", bar="can_make")
    assert set(found) == {"virgin-mojito"}


def test_search_recipes_bar_filter_rejects_fresh_only(client):
    res = call(client, "search_recipes", {"side": "drinks", "bar": "fresh_only"})
    assert res["isError"] is True


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
        "unsorted": ["white rum"],
        "untracked": ["lime juice", "simple syrup"],
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
    assert (
        " The drinks side has a bar (read_bar, manage_inventory). Only bottles are "
        "tracked; fresh items, syrups and mixers never are, and ‘can make’ means "
        "every tracked bottle is in."
    ) in instructions
