import re

import httpx2
import pytest
from conftest import call, rpc

from app.api import SAVE_FAILED, SAVE_INCOMPLETE
from app.recipes.drafts import RecipeDraft
from app.recipes.fetch import Fetcher
from app.recipes.model import Source
from app.recipes.store import RecipeStore, SaveIncomplete
from app.recipes.uploads import UploadStore

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16
PAGE = "https://example.com/dal"
PHOTO = "https://example.com/dal.jpg"
OTHER_PHOTO = "https://example.com/other.png"
NO_PHOTO_PAGE = "https://example.com/plain"

RECIPE = {
    "name": "Quick dal",
    "category": "mains",
    "servings": 2,
    "ingredients": [{"amount": 200, "unit": "g", "item": "red lentils"}],
    "steps": ["Simmer."],
}


def html(head):
    return httpx2.Response(
        200,
        headers={"content-type": "text/html; charset=utf-8"},
        text=f"<html><head>{head}</head><body></body></html>",
    )


def image(body=PNG, content_type="image/png"):
    return httpx2.Response(200, headers={"content-type": content_type}, content=body)


@pytest.fixture(autouse=True)
def network(routes):
    routes[PAGE] = html('<meta property="og:image" content="/dal.jpg">')
    routes[PHOTO] = image()
    routes[OTHER_PHOTO] = image()
    routes[NO_PHOTO_PAGE] = html("<title>Plain</title>")


def add(client, side="food", **arguments):
    return call(client, "add_recipe", {"side": side, "recipe": RECIPE, **arguments})


def saved(res):
    assert res["isError"] is False, res
    return res["structuredContent"]


def text(res):
    """The sentence of a tool error; the SDK puts its own prefix before it."""
    assert res["isError"] is True
    message = res["content"][0]["text"]
    return re.sub(r"^Error executing tool \w+: ", "", message)


def read(client, side, slug):
    return call(client, "read_recipe", {"side": side, "slug": slug})[
        "structuredContent"
    ]


def test_add_recipe_minimal(client, store):
    result = saved(add(client))
    assert result["side"] == "food"
    assert result["slug"] == "quick-dal"
    assert result["version"] == 1
    assert result["path"] == "/food/quick-dal"
    assert result["link"] == "https://laekkert.serwan.me/food/quick-dal"
    assert result["photo"] is False
    assert result["warnings"] == []
    shown = read(client, "food", "quick-dal")
    assert shown["name"] == "Quick dal"
    assert shown["ingredients"][0]["item"] == "red lentils"
    assert shown["source"] is None
    assert store.timeline("food", "quick-dal")[0].via == "claude"


def test_add_recipe_on_drinks(client):
    recipe = {**RECIPE, "name": "Lime fizz", "category": "mocktails"}
    res = call(client, "add_recipe", {"side": "drinks", "recipe": recipe})
    assert saved(res)["path"] == "/drinks/lime-fizz"


def test_add_recipe_without_host_header_has_no_link(client):
    # The result's link comes from the Host header; without one there is none.
    res = client.post(
        "/mcp",
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": "add_recipe",
                "arguments": {"side": "food", "recipe": RECIPE},
            },
        },
        headers={
            "Accept": "application/json, text/event-stream",
            "MCP-Protocol-Version": "2025-06-18",
            "Host": "",
        },
    ).json()["result"]
    assert "link" not in saved(res)


def test_add_recipe_from_url_grabs_og_image(client):
    result = saved(add(client, source_url=PAGE))
    assert result["photo"] is True
    assert result["warnings"] == []
    shown = read(client, "food", result["slug"])
    assert shown["source"]["url"] == PAGE
    assert shown["image"].startswith("img-")


def test_add_recipe_image_url_wins(client, routes):
    asked = []
    routes[PAGE] = lambda request: asked.append(request) or html("")
    result = saved(add(client, source_url=PAGE, image_url=OTHER_PHOTO))
    assert result["photo"] is True
    assert result["warnings"] == []
    # The page was never asked for its own photo.
    assert asked == []
    assert read(client, "food", result["slug"])["source"]["url"] == PAGE


def test_add_recipe_page_without_photo_warns(client):
    result = saved(add(client, source_url=NO_PHOTO_PAGE))
    assert result["photo"] is False
    assert result["warnings"] == ["Saved without a photo: the page has no main photo"]
    assert read(client, "food", result["slug"])["source"]["url"] == NO_PHOTO_PAGE


def test_add_recipe_page_that_fails_warns(client):
    result = saved(add(client, source_url="https://example.com/gone"))
    assert result["warnings"] == ["Saved without a photo: the site answered 404"]


def test_add_recipe_no_source_no_photo_attempt(client, routes):
    seen = []
    routes[PHOTO] = lambda request: seen.append(request) or image()
    result = saved(add(client))
    assert result["warnings"] == []
    assert seen == []


@pytest.mark.parametrize(
    "url, response, sentence",
    [
        (
            "https://example.com/page.html",
            httpx2.Response(
                200, headers={"content-type": "image/jpeg"}, content=b"<html>hi</html>"
            ),
            "that link isn't a supported photo",
        ),
        (
            "https://example.com/pic.svg",
            httpx2.Response(
                200,
                headers={"content-type": "image/svg+xml"},
                content=b"<svg xmlns='http://www.w3.org/2000/svg'/>",
            ),
            "that link isn't a supported photo",
        ),
        ("https://evil.test/pic.jpg", image(), "that link points to a private address"),
        ("https://example.com/missing.jpg", None, "the site answered 404"),
    ],
    ids=["html", "svg", "private-host", "not-found"],
)
def test_add_recipe_bad_image_still_saves(client, routes, url, response, sentence):
    if response is not None:
        routes[url] = response
    result = saved(add(client, image_url=url))
    assert result["photo"] is False
    assert result["warnings"] == [f"Saved without a photo: {sentence}"]
    assert read(client, "food", result["slug"])["image"] is None


def test_add_recipe_refuses_cups(client, store):
    recipe = {
        **RECIPE,
        "ingredients": [{"amount": 1, "unit": "cup", "item": "flour"}],
    }
    res = call(client, "add_recipe", {"side": "food", "recipe": recipe})
    assert "unit" in text(res)
    assert [r.slug for r in store.list("food")] == [
        "chicken-leek-traybake",
        "red-lentil-dal",
    ]


def test_unit_description_points_to_the_style_guide(client):
    tools = rpc(client, 2, "tools/list").json()["result"]["tools"]
    schema = next(t for t in tools if t["name"] == "add_recipe")["inputSchema"]
    unit = schema["$defs"]["DraftIngredient"]["properties"]["unit"]
    assert unit["description"] == (
        "Metric only: g, ml, piece, dash, pinch, to taste; tsp/tbsp are converted. "
        "Convert cups and ounces first (see the style guide)."
    )


def test_add_recipe_wrong_category_sentence(client, routes):
    seen = []
    routes[PHOTO] = lambda request: seen.append(request) or image()
    recipe = {**RECIPE, "category": "cocktails"}
    res = call(
        client,
        "add_recipe",
        {"side": "food", "recipe": recipe, "image_url": PHOTO},
    )
    assert text(res) == (
        "Category for food must be one of mains, sides, desserts, sauces, prep"
    )
    assert seen == []


def test_add_recipe_tsp_converted(client):
    recipe = {
        **RECIPE,
        "ingredients": [{"amount": 1, "unit": "tsp", "item": "salt"}],
    }
    res = call(client, "add_recipe", {"side": "food", "recipe": recipe})
    shown = read(client, "food", saved(res)["slug"])
    assert shown["ingredients"][0]["amount"] == 6
    assert shown["ingredients"][0]["unit"] == "g"


def test_add_recipe_duplicate_source_refused(client, routes, store):
    saved(add(client, source_url=PAGE))
    seen = []
    routes[PHOTO] = lambda request: seen.append(request) or image()
    res = add(client, source_url=PAGE)
    assert text(res) == "Already in Lækkert as quick-dal; use edit_recipe to change it"
    assert seen == []
    assert len(store.list("food")) == 3


def test_add_recipe_same_source_on_other_side_is_fine(client):
    saved(add(client, source_url=PAGE))
    recipe = {**RECIPE, "category": "mocktails"}
    res = call(
        client,
        "add_recipe",
        {"side": "drinks", "recipe": recipe, "source_url": PAGE},
    )
    assert saved(res)["side"] == "drinks"


def test_add_recipe_javascript_source_refused(client, routes):
    seen = []
    routes["javascript:alert(1)"] = lambda request: seen.append(request) or image()
    res = add(client, source_url="javascript:alert(1)")
    assert text(res) == "The source link must start with http:// or https://"
    assert seen == []


def test_add_recipe_rejects_unknown_field(client):
    recipe = {**RECIPE, "colour": "red"}
    res = call(client, "add_recipe", {"side": "food", "recipe": recipe})
    assert "colour" in text(res)


def test_add_recipe_blank_name_sentence(client):
    res = add(client, recipe={**RECIPE, "name": "  "})
    assert text(res) == "Give the recipe a name"


def test_add_recipe_save_failures(client, monkeypatch):
    def broken(self, *args, **kwargs):
        raise OSError("disk full")

    def half(self, *args, **kwargs):
        raise SaveIncomplete("rollback failed")

    monkeypatch.setattr(RecipeStore, "create", broken)
    assert text(add(client)) == SAVE_FAILED
    monkeypatch.setattr(RecipeStore, "create", half)
    assert text(add(client)) == SAVE_INCOMPLETE


def test_add_recipe_malformed_og_image_still_saves(client, routes):
    routes[PAGE] = html('<meta property="og:image" content="http://[oops">')
    result = saved(add(client, source_url=PAGE))
    assert result["photo"] is False
    assert result["warnings"] == ["Saved without a photo: the page has no main photo"]


def test_add_recipe_unexpected_fetch_failure_still_saves(client, monkeypatch, caplog):
    async def boom(self, url):
        raise RuntimeError("surprise")

    monkeypatch.setattr(Fetcher, "image", boom)
    result = saved(add(client, image_url=PHOTO))
    assert result["photo"] is False
    assert result["warnings"] == [
        "Saved without a photo: the photo could not be fetched"
    ]
    assert "surprise" in caplog.text


def test_add_recipe_disk_error_while_parking_is_not_a_warning(client, monkeypatch):
    def full(self, body):
        raise OSError("disk full")

    monkeypatch.setattr(UploadStore, "save_detected", full)
    assert text(add(client, image_url=PHOTO)) == SAVE_FAILED


def test_add_recipe_refuses_a_duplicate_made_during_the_fetch(client, routes, store):
    def competing(request):
        # Another request saves the same page while this one waits for its photo.
        draft = RecipeDraft(
            **{**RECIPE, "time_minutes": None, "tags": []},
            source=Source(url=PAGE),
            image=None,
        )
        store.create("food", draft, "claude")
        return image()

    routes[PHOTO] = competing
    res = add(client, source_url=PAGE, image_url=PHOTO)
    assert text(res) == "Already in Lækkert as quick-dal; use edit_recipe to change it"
    sources = [r.source.url for r in store.list("food") if r.source]
    assert sources == [PAGE]


# edit_recipe


def edit(client, slug, version, changes=None, side="food", **arguments):
    return call(
        client,
        "edit_recipe",
        {
            "side": side,
            "slug": slug,
            "version": version,
            "changes": changes or {},
            **arguments,
        },
    )


def stale_sentence(version):
    return (
        f"The recipe changed since you read it (it is now version {version}); "
        "read it again and redo the change"
    )


@pytest.fixture
def dal(client):
    """Quick dal, saved with a page, a tag, a time and a photo."""
    recipe = {**RECIPE, "time_minutes": 30, "tags": ["vegan"]}
    res = call(
        client,
        "add_recipe",
        {"side": "food", "recipe": recipe, "source_url": PAGE, "image_url": PHOTO},
    )
    assert saved(res)["version"] == 1
    return "quick-dal"


def test_edit_recipe_changes_only_given_fields(client, dal):
    before = read(client, "food", dal)
    assert before["image"].startswith("img-")
    result = saved(edit(client, dal, 1, {"servings": 4}))
    assert result["version"] == 2
    assert result["path"] == "/food/quick-dal"
    assert result["photo"] is True
    assert result["warnings"] == []
    after = read(client, "food", dal)
    assert after["servings"] == 4
    assert after["version"] == 2
    for kept in ("name", "ingredients", "steps", "tags", "time_minutes", "source"):
        assert after[kept] == before[kept]
    assert after["image"] == before["image"]


def test_edit_recipe_replaces_whole_lists_and_renames_without_moving(client, dal):
    changes = {
        "name": "Better dal",
        "tags": ["quick"],
        "steps": ["Rinse.", "Simmer."],
        "ingredients": [{"amount": 1, "unit": "tsp", "item": "salt"}],
    }
    result = saved(edit(client, dal, 1, changes))
    assert result["slug"] == "quick-dal"
    after = read(client, "food", dal)
    assert after["name"] == "Better dal"
    assert after["tags"] == ["quick"]
    assert [step["text"] for step in after["steps"]] == ["Rinse.", "Simmer."]
    assert [(i["amount"], i["unit"]) for i in after["ingredients"]] == [(6, "g")]


def test_edit_recipe_clears_time_with_null(client, dal):
    saved(edit(client, dal, 1, {"time_minutes": None}))
    assert read(client, "food", dal)["time_minutes"] is None


def test_edit_recipe_leaving_time_out_keeps_it(client, dal):
    saved(edit(client, dal, 1, {"name": "Dal"}))
    assert read(client, "food", dal)["time_minutes"] == 30


def test_edit_recipe_source_url_set_and_cleared(client, dal):
    saved(edit(client, dal, 1, {"source_url": "https://example.com/other"}))
    assert read(client, "food", dal)["source"]["url"] == "https://example.com/other"
    saved(edit(client, dal, 2, {"source_url": None}))
    assert read(client, "food", dal)["source"] is None


def test_edit_recipe_javascript_source_refused(client, dal):
    res = edit(client, dal, 1, {"source_url": "javascript:alert(1)"})
    assert text(res) == "The source link must start with http:// or https://"


@pytest.mark.parametrize("field", ["name", "servings", "ingredients"])
def test_edit_recipe_null_for_a_required_field_refused(client, dal, field):
    res = edit(client, dal, 1, {field: None})
    assert res["isError"] is True
    assert read(client, "food", dal)["version"] == 1


def test_edit_recipe_timeline_via_claude(client, store, dal):
    saved(edit(client, dal, 1, {"servings": 4, "tags": ["vegan", "quick"]}))
    entries = store.timeline("food", dal)
    assert [e.kind for e in entries] == ["created", "edit"]
    last = entries[-1]
    assert last.via == "claude"
    assert last.version == 2
    assert [(c.section, c.kind, c.text) for c in last.changes] == [
        ("details", "changed", "servings 2 → 4"),
        ("tags", "added", "“quick”"),
    ]


def test_edit_recipe_stale_version_refused(client, dal):
    shown = read(client, "food", dal)
    body = {
        key: shown[key]
        for key in (
            "name",
            "category",
            "servings",
            "time_minutes",
            "ingredients",
            "steps",
            "source",
            "tags",
            "image",
        )
    }
    # Requests still send steps as plain strings.
    body["steps"] = [step["text"] for step in shown["steps"]]
    api = client.put(
        "/api/recipes/food/quick-dal", json={**body, "name": "Dal!", "base_version": 1}
    )
    assert api.status_code == 200
    res = edit(client, dal, 1, {"servings": 9})
    assert text(res) == stale_sentence(2)
    after = read(client, "food", dal)
    assert after["name"] == "Dal!"
    assert after["servings"] == 2
    assert after["version"] == 2


def test_edit_recipe_conflict_inside_the_store_gives_the_same_sentence(
    client, dal, monkeypatch
):
    from app.recipes.store import VersionConflict

    def lost(self, *args, **kwargs):
        raise VersionConflict(7)

    monkeypatch.setattr(RecipeStore, "update", lost)
    assert text(edit(client, dal, 1, {"servings": 3})) == stale_sentence(7)


def test_edit_recipe_stale_version_does_not_fetch(client, routes, dal):
    seen = []
    routes[OTHER_PHOTO] = lambda request: seen.append(request) or image()
    res = edit(client, dal, 5, image_url=OTHER_PHOTO)
    assert text(res) == stale_sentence(1)
    assert seen == []


def test_edit_recipe_unknown_slug(client):
    res = edit(client, "nope", 1, {"servings": 3})
    assert text(res) == "No recipe 'nope' on the food side"
    res = edit(client, "quick-dal", 1, {"servings": 3}, side="drinks")
    assert text(res) == "No recipe 'quick-dal' on the drinks side"


def test_edit_recipe_invalid_change_does_not_fetch(client, routes, dal):
    seen = []
    routes[OTHER_PHOTO] = lambda request: seen.append(request) or image()
    res = edit(client, dal, 1, {"category": "cocktails"}, image_url=OTHER_PHOTO)
    assert text(res) == (
        "Category for food must be one of mains, sides, desserts, sauces, prep"
    )
    res = edit(client, dal, 1, {"servings": 0}, image_url=OTHER_PHOTO)
    assert text(res) == "Servings must be at least 1"
    assert seen == []


def test_edit_recipe_rejects_unknown_field(client, dal):
    res = edit(client, dal, 1, {"colour": "red"})
    assert "colour" in text(res)


def test_edit_recipe_new_image_url(client, routes, dal):
    routes[OTHER_PHOTO] = image(PNG + b"other")
    old = read(client, "food", dal)["image"]
    result = saved(edit(client, dal, 1, image_url=OTHER_PHOTO))
    assert result["version"] == 2
    assert result["photo"] is True
    assert result["warnings"] == []
    new = read(client, "food", dal)["image"]
    assert new.startswith("img-")
    assert new != old


def test_edit_recipe_remove_image(client, dal):
    result = saved(edit(client, dal, 1, remove_image=True))
    assert result["photo"] is False
    assert result["version"] == 2
    assert read(client, "food", dal)["image"] is None


def test_edit_recipe_image_url_and_remove_image_refused(client, routes, dal):
    seen = []
    routes[OTHER_PHOTO] = lambda request: seen.append(request) or image()
    res = edit(client, dal, 1, image_url=OTHER_PHOTO, remove_image=True)
    assert text(res) == "Pass image_url or remove_image, not both"
    assert seen == []
    assert read(client, "food", dal)["version"] == 1


def test_edit_recipe_bad_image_keeps_old_photo(client, dal):
    old = read(client, "food", dal)["image"]
    result = saved(
        edit(client, dal, 1, {"servings": 3}, image_url="https://example.com/gone.jpg")
    )
    assert result["photo"] is True
    assert result["version"] == 2
    assert result["warnings"] == ["Saved without the new photo: the site answered 404"]
    after = read(client, "food", dal)
    assert after["image"] == old
    assert after["servings"] == 3


def test_edit_recipe_no_change_is_ok(client, store, dal):
    result = saved(edit(client, dal, 1))
    assert result["version"] == 1
    assert result["warnings"] == []
    assert [e.kind for e in store.timeline("food", dal)] == ["created"]


def test_edit_recipe_same_values_is_no_change(client, dal):
    assert saved(edit(client, dal, 1, {"servings": 2}))["version"] == 1


def test_edit_recipe_save_failures(client, dal, monkeypatch):
    def broken(self, *args, **kwargs):
        raise OSError("disk full")

    def half(self, *args, **kwargs):
        raise SaveIncomplete("rollback failed")

    monkeypatch.setattr(RecipeStore, "update", broken)
    assert text(edit(client, dal, 1, {"servings": 3})) == SAVE_FAILED
    monkeypatch.setattr(RecipeStore, "update", half)
    assert text(edit(client, dal, 1, {"servings": 3})) == SAVE_INCOMPLETE


def test_edit_recipe_disk_error_while_parking_is_not_a_warning(
    client, dal, monkeypatch
):
    def full(self, body):
        raise OSError("disk full")

    monkeypatch.setattr(UploadStore, "save_detected", full)
    assert text(edit(client, dal, 1, image_url=OTHER_PHOTO)) == SAVE_FAILED
