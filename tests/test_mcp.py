import importlib.resources

import pytest
from conftest import HEADERS, call, rpc
from starlette.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.mcp_server import STYLE_GUIDE
from app.recipes.drafts import RecipeDraft


def test_initialize_through_public_hostname(client):
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
    assert r.status_code == 200
    result = r.json()["result"]
    assert result["serverInfo"]["name"] == "laekkert"
    assert "never mixed" in result["instructions"]


def test_tools_listed(client):
    names = {t["name"] for t in rpc(client, 2, "tools/list").json()["result"]["tools"]}
    assert names == {
        "list_recipes",
        "read_recipe",
        "search_recipes",
        "add_recipe",
        "get_style_guide",
    }


def test_list_recipes_tool(client):
    res = call(client, "list_recipes", {"side": "drinks"})
    assert [r["slug"] for r in res["structuredContent"]["result"]] == [
        "daiquiri",
        "virgin-mojito",
    ]


def test_list_recipes_rejects_unknown_side(client):
    assert call(client, "list_recipes", {"side": "bar"})["isError"] is True


def test_read_recipe_tool(client):
    res = call(client, "read_recipe", {"side": "drinks", "slug": "daiquiri"})
    assert res["isError"] is False
    assert res["structuredContent"]["ingredients"][0]["item"] == "white rum"


@pytest.mark.parametrize("slug", ["nope", "../x", "../../food/red-lentil-dal"])
def test_read_unknown_recipe_is_tool_error(client, slug):
    res = call(client, "read_recipe", {"side": "drinks", "slug": slug})
    assert res["isError"] is True
    assert "No recipe" in res["content"][0]["text"]


def slugs(res):
    assert res["isError"] is False
    return [r["slug"] for r in res["structuredContent"]["result"]]


def search(client, **arguments):
    return call(client, "search_recipes", {"side": "food", **arguments})


def add_untimed(store):
    """A food recipe with no time, to sit last when sorting by time."""
    draft = RecipeDraft(
        name="Apple crumble",
        category="desserts",
        servings=4,
        time_minutes=None,
        ingredients=[{"amount": 800, "unit": "g", "item": "apples"}],
        steps=["Bake."],
        source=None,
        tags=[],
        image=None,
    )
    return store.create("food", draft, "app")


def test_search_by_query(client):
    assert slugs(search(client, query="lentil")) == ["red-lentil-dal"]


def test_search_by_tag_and_category(client):
    assert slugs(search(client, tags=["Batch Cook"])) == ["chicken-leek-traybake"]
    both = search(client, tags=["batch cook", "kid approved"], category="mains")
    assert slugs(both) == ["chicken-leek-traybake"]
    assert slugs(search(client, tags=["batch cook", "vegetarian"])) == []
    assert slugs(search(client, category="mains")) == [
        "chicken-leek-traybake",
        "red-lentil-dal",
    ]


def test_search_by_mark(client, store):
    assert slugs(search(client, marks=["tried"])) == ["chicken-leek-traybake"]
    store.set_marks("food", "red-lentil-dal", ["tried"], [], "app")
    assert slugs(search(client, marks=["tried"])) == [
        "chicken-leek-traybake",
        "red-lentil-dal",
    ]
    # Every mark has to be there.
    assert slugs(search(client, marks=["tried", "try_next"])) == ["red-lentil-dal"]


def test_search_sort_time_puts_unknown_last(client, store):
    add_untimed(store)
    res = search(client, sort="time")
    assert slugs(res) == ["red-lentil-dal", "chicken-leek-traybake", "apple-crumble"]
    assert res["structuredContent"]["result"][2]["time_minutes"] is None


def test_search_sort_rating(client, store):
    add_untimed(store)
    store.add_rating("food", "red-lentil-dal", 3.0, "app")
    store.add_rating("food", "chicken-leek-traybake", 4.5, "app")
    res = search(client, sort="rating")
    assert slugs(res) == ["chicken-leek-traybake", "red-lentil-dal", "apple-crumble"]
    assert [r["rating"] for r in res["structuredContent"]["result"]] == [4.5, 3.0, None]


def test_search_sort_recently_made(client, store):
    add_untimed(store)
    store.add_made("food", "red-lentil-dal", None, "", "app")
    # Never made comes last, by name: the crumble would lead on name alone.
    assert slugs(search(client, sort="recently_made")) == [
        "red-lentil-dal",
        "apple-crumble",
        "chicken-leek-traybake",
    ]


def test_search_sorts_by_name_and_breaks_ties_by_name(client, store):
    add_untimed(store)
    names = ["apple-crumble", "chicken-leek-traybake", "red-lentil-dal"]
    assert slugs(search(client, sort="name")) == names
    assert slugs(search(client)) == names
    # Nothing is rated, so the order falls back to the name.
    assert slugs(search(client, sort="rating")) == names


def test_search_relevance_keeps_search_order(client, store):
    # Matches "chicken" through an ingredient only, and sorts first by name.
    draft = RecipeDraft(
        name="Apple bake",
        category="desserts",
        servings=2,
        time_minutes=30,
        ingredients=[{"amount": 300, "unit": "g", "item": "chicken"}],
        steps=["Bake."],
        source=None,
        tags=[],
        image=None,
    )
    store.create("food", draft, "app")
    # A name hit ranks above an ingredient hit, whatever the name order.
    assert slugs(search(client, query="chicken")) == [
        "chicken-leek-traybake",
        "apple-bake",
    ]
    assert slugs(search(client, query="chicken", sort="name")) == [
        "apple-bake",
        "chicken-leek-traybake",
    ]


def test_search_entries_match_list_recipes(client):
    listed = call(client, "list_recipes", {"side": "food"})
    found = search(client)
    assert found["structuredContent"] == listed["structuredContent"]
    entry = found["structuredContent"]["result"][0]
    assert {"rating", "last_made", "version"} <= set(entry)


def test_search_limit(client):
    assert len(slugs(search(client, limit=1))) == 1
    assert len(slugs(search(client))) == 2
    assert search(client, limit=0)["isError"] is True
    assert search(client, limit=51)["isError"] is True


def test_search_unknown_category_is_empty_not_error(client):
    res = search(client, category="nonsense")
    assert res["isError"] is False
    assert slugs(res) == []


def test_search_rejects_unknown_side(client):
    res = call(client, "search_recipes", {"side": "bar"})
    assert res["isError"] is True


def test_read_recipe_has_version_and_rating(client, store):
    store.add_rating("drinks", "daiquiri", 4.0, "app")
    res = call(client, "read_recipe", {"side": "drinks", "slug": "daiquiri"})
    body = res["structuredContent"]
    assert body["rating"] == 4.0
    assert body["last_made"] is None
    assert body["version"] == 0
    seed = call(client, "read_recipe", {"side": "drinks", "slug": "virgin-mojito"})
    assert seed["structuredContent"]["rating"] is None


def test_list_recipes_has_rating_and_version(client, store):
    store.add_made("drinks", "daiquiri", 5.0, "", "app")
    entries = call(client, "list_recipes", {"side": "drinks"})["structuredContent"]
    daiquiri = entries["result"][0]
    assert daiquiri["rating"] == 5.0
    assert daiquiri["last_made"] is not None
    assert daiquiri["version"] == 0


def test_healthz_still_works_with_mcp_mounted(client):
    assert client.get("/healthz").json()["status"] == "ok"


def test_mcp_get_is_not_swallowed_by_spa(tmp_path):
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<div id=root></div>")
    app = create_app(Settings(), data_dir=tmp_path / "data", static_dir=dist)
    with TestClient(app) as c:
        # A JSON-only GET is refused by the MCP transport, not served the SPA.
        # (Accepting event streams would open an SSE stream that never ends.)
        response = c.get("/mcp", headers={"Accept": "application/json"})
    assert response.status_code == 406
    assert response.json()["jsonrpc"] == "2.0"


def test_style_guide_tool(client):
    res = call(client, "get_style_guide", {})
    assert res["isError"] is False
    assert "Metric only" in res["content"][0]["text"]
    assert res["content"][0]["text"] == STYLE_GUIDE


def test_style_guide_resource(client):
    listed = rpc(client, 4, "resources/list").json()["result"]["resources"]
    assert "laekkert://style-guide" in {r["uri"] for r in listed}
    read = rpc(client, 5, "resources/read", {"uri": "laekkert://style-guide"})
    content = read.json()["result"]["contents"][0]
    assert content["mimeType"] == "text/markdown"
    assert content["text"] == STYLE_GUIDE
    assert "Metric only" in content["text"]


def test_import_prompt(client):
    url = "https://example.com/r"
    res = rpc(
        client, 6, "prompts/get", {"name": "import_recipe", "arguments": {"url": url}}
    )
    messages = res.json()["result"]["messages"]
    assert len(messages) == 1
    assert messages[0]["role"] == "user"
    text = messages[0]["content"]["text"]
    assert url in text
    assert "Metric only" in text


def test_instructions_mention_style_guide(client):
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
    assert "get_style_guide" in instructions
    assert "laekkert://style-guide" in instructions


def test_plain_text_post_refused(client, tmp_path):
    body = (
        '{"jsonrpc":"2.0","id":9,"method":"tools/call",'
        '"params":{"name":"list_recipes","arguments":{"side":"food"}}}'
    )
    before = sorted(p.name for p in tmp_path.rglob("*"))
    r = client.post(
        "/mcp", content=body, headers={**HEADERS, "Content-Type": "text/plain"}
    )
    assert 400 <= r.status_code < 500
    assert sorted(p.name for p in tmp_path.rglob("*")) == before


def test_style_guide_in_wheel():
    assert importlib.resources.files("app").joinpath("style_guide.md").is_file()
