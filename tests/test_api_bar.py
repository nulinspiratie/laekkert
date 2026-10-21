import asyncio
import json

import pytest
from starlette.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.recipes.bar import Bar
from app.recipes.store import RecipeStore


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(Settings(), data_dir=tmp_path)) as c:
        yield c


def item(bar, name):
    return next(i for i in bar["items"] if i["name"].lower() == name)


def test_get_bar_shape(client):
    bar = client.get("/api/bar").json()
    assert set(bar) == {"items", "set_up", "counts"}
    assert bar["set_up"] is False
    assert bar["counts"] == {
        "can_make": 1,
        "missing": 0,
        "unsorted": 1,
        "total": 2,
    }
    assert [i["name"] for i in bar["items"]] == sorted(
        (i["name"] for i in bar["items"]), key=str.lower
    )
    assert set(item(bar, "white rum")) == {
        "name",
        "aliases",
        "kind",
        "state",
        "used_in",
        "recipe",
        "tracked",
        "untracked_because",
    }
    assert item(bar, "white rum")["state"] is None
    assert item(bar, "white rum")["tracked"] is True
    assert item(bar, "white rum")["untracked_because"] is None
    assert item(bar, "simple syrup")["untracked_because"] == "syrups"
    assert item(bar, "lime juice")["untracked_because"] == "marked"
    assert item(bar, "white rum")["used_in"] == [
        {"slug": "daiquiri", "name": "Daiquiri"}
    ]


def test_post_bar_applies(client, tmp_path):
    response = client.post("/api/bar", json={"have": ["white rum"]})
    assert response.status_code == 200
    bar = response.json()
    assert item(bar, "white rum")["state"] == "have"
    assert bar["set_up"] is True
    assert bar == client.get("/api/bar").json()
    stored = json.loads((tmp_path / "inventory.json").read_text(encoding="utf-8"))
    assert stored["items"] == {"white rum": "have"}


def test_post_bar_refusal_is_400(client):
    response = client.post("/api/bar", json={"delete": ["white rum"]})
    assert response.status_code == 400
    assert response.json() == {"error": "Only items no drink uses can be deleted."}


def test_post_bar_unknown_field_is_400(client):
    response = client.post("/api/bar", json={"hav": ["white rum"]})
    assert response.status_code == 400
    assert response.json() == {"error": "The change has an unknown field: hav"}


@pytest.mark.parametrize(
    "body, sentence",
    [
        ({"have": "gin"}, "The change isn't valid"),
        ({"kinds": {"gin": "wine-ish"}}, "The change isn't valid"),
        ({"have": [" "]}, "A name can't be empty."),
        ({"have": [f"x{n}" for n in range(201)]}, "That's too many changes at once."),
    ],
)
def test_post_bar_invalid_body_is_400(client, body, sentence):
    response = client.post("/api/bar", json=body)
    assert response.status_code == 400
    assert response.json() == {"error": sentence}


def test_post_bar_refuses_non_json(client):
    response = client.post("/api/bar", content="have=gin")
    assert response.status_code == 415


def test_post_bar_unreadable_inventory_is_503(client, tmp_path):
    (tmp_path / "inventory.json").write_text("{nope")
    response = client.post("/api/bar", json={"have": ["white rum"]})
    assert response.status_code == 503
    assert "inventory.json" in response.json()["error"]
    assert (tmp_path / "inventory.json").read_text() == "{nope"


def test_post_bar_unreadable_catalog_is_503(client, tmp_path):
    (tmp_path / "catalog" / "ingredients.json").write_text("{nope")
    response = client.post("/api/bar", json={"have": ["white rum"]})
    assert response.status_code == 503
    assert "error" in response.json()
    assert not (tmp_path / "inventory.json").exists()


def test_get_bar_with_unreadable_inventory_still_answers(client, tmp_path):
    (tmp_path / "inventory.json").write_text("{nope")
    response = client.get("/api/bar")
    assert response.status_code == 200
    assert response.json()["set_up"] is False


def test_post_bar_plain_write_failure_is_the_usual_503(client, monkeypatch):
    def fail(path, data):
        raise OSError("disk full")

    monkeypatch.setattr("app.recipes.bar.atomic_write", fail)
    response = client.post("/api/bar", json={"have": ["white rum"]})
    assert response.status_code == 503
    assert response.json() == {"error": "could not save; nothing was changed"}


def test_drinks_list_has_bar(client):
    recipes = client.get("/api/recipes?side=drinks").json()["recipes"]
    daiquiri = next(r for r in recipes if r["slug"] == "daiquiri")
    assert daiquiri["bar"] == {
        "status": "unsorted",
        "missing": [],
        "unsorted": ["white rum"],
        "untracked": ["lime juice", "simple syrup"],
    }
    client.post("/api/bar", json={"dont_have": ["white rum"]})
    recipes = client.get("/api/recipes?side=drinks").json()["recipes"]
    daiquiri = next(r for r in recipes if r["slug"] == "daiquiri")
    assert daiquiri["bar"]["status"] == "missing"
    assert daiquiri["bar"]["missing"] == ["white rum"]


def test_syrups_recipe_has_no_bar(client):
    detail = client.get("/api/recipes/drinks/daiquiri").json()
    draft = draft_from(detail)
    syrup = {**draft, "side": "drinks", "name": "Honey syrup", "category": "syrups"}
    assert client.post("/api/recipes", json=syrup).status_code == 201
    recipes = client.get("/api/recipes?side=drinks").json()["recipes"]
    made = next(r for r in recipes if r["slug"] == "honey-syrup")
    assert made["bar"] is None
    body = client.get("/api/recipes/drinks/honey-syrup").json()
    assert body["bar"] is None
    assert all(i["bar"] is None for i in body["ingredients"])


def test_food_list_has_no_bar(client):
    recipes = client.get("/api/recipes?side=food").json()["recipes"]
    assert recipes and all("bar" not in r for r in recipes)


def test_food_detail_has_no_bar(client):
    body = client.get("/api/recipes/food/red-lentil-dal").json()
    assert "bar" not in body
    assert all("bar" not in i for i in body["ingredients"])


def test_drink_detail_has_ingredient_bar(client):
    client.post("/api/bar", json={"have": ["white rum"]})
    body = client.get("/api/recipes/drinks/daiquiri").json()
    assert body["bar"] == {
        "status": "can_make",
        "missing": [],
        "unsorted": [],
        "untracked": ["lime juice", "simple syrup"],
    }
    rum, lime, syrup = body["ingredients"]
    assert rum["bar"] == {
        "item": "white rum",
        "state": "have",
        "tracked": True,
        "recipe": None,
    }
    assert lime["bar"]["tracked"] is False and lime["bar"]["state"] is None
    assert syrup["bar"]["tracked"] is False and syrup["bar"]["state"] is None


def test_post_bar_untrack_and_track(client):
    response = client.post("/api/bar", json={"untrack": ["white rum"]})
    assert response.status_code == 200
    assert item(response.json(), "white rum")["tracked"] is False
    assert item(response.json(), "white rum")["untracked_because"] == "marked"
    response = client.post("/api/bar", json={"track": ["white rum"]})
    assert response.status_code == 200
    assert item(response.json(), "white rum")["tracked"] is True


def test_post_bar_fresh_is_gone(client):
    response = client.post("/api/bar", json={"fresh": ["lime juice"]})
    assert response.status_code == 400
    assert response.json() == {"error": "The change has an unknown field: fresh"}
    response = client.post("/api/bar", json={"not_fresh": ["lime juice"]})
    assert response.status_code == 400


def test_post_bar_track_refused_for_a_syrup_is_400(client):
    response = client.post("/api/bar", json={"track": ["simple syrup"]})
    assert response.status_code == 400
    assert response.json() == {
        "error": "Syrups aren't tracked. Give ‘simple syrup’ another kind first."
    }


def test_ingredient_bar_is_null_when_the_bar_does_not_know_it(client, monkeypatch):
    from app.recipes.bar import BarView

    monkeypatch.setattr(BarView, "ingredient", lambda self, text: None)
    body = client.get("/api/recipes/drinks/daiquiri").json()
    assert all(i["bar"] is None for i in body["ingredients"])


def draft_from(recipe):
    keep = (
        "name category servings time_minutes ingredients steps source tags image"
    ).split()
    draft = {key: recipe[key] for key in keep}
    draft["ingredients"] = [
        {k: v for k, v in i.items() if k not in ("g_per_tsp", "bar")}
        for i in recipe["ingredients"]
    ]
    return draft


def test_every_route_that_returns_a_drink_carries_bar(client):
    detail = client.get("/api/recipes/drinks/daiquiri").json()
    draft = draft_from(detail)

    created = client.post("/api/recipes", json={**draft, "side": "drinks", "name": "B"})
    assert created.status_code == 201
    assert created.json()["bar"]["status"] == "unsorted"
    assert all("bar" in i for i in created.json()["ingredients"])

    updated = client.put(
        "/api/recipes/drinks/b",
        json={**draft, "name": "B", "steps": ["Shake."], "base_version": 1},
    )
    assert updated.status_code == 200
    assert "bar" in updated.json()

    marked = client.post(
        "/api/recipes/drinks/daiquiri/marks", json={"add": ["favourite"]}
    )
    assert "bar" in marked.json()

    entry = client.post(
        "/api/recipes/drinks/daiquiri/timeline", json={"kind": "note", "text": "ok"}
    )
    assert entry.status_code == 201
    assert "bar" in entry.json()["recipe"]

    restored = client.post("/api/recipes/drinks/b/restore", json={"version": 1})
    assert restored.status_code == 200
    assert "bar" in restored.json()


def test_food_writes_carry_no_bar(client):
    marked = client.post(
        "/api/recipes/food/red-lentil-dal/marks", json={"add": ["favourite"]}
    )
    assert marked.status_code == 200
    assert "bar" not in marked.json()


def test_drinks_list_reads_the_drinks_once(client, monkeypatch):
    """The list and its bar view share one read of every drink."""
    lists = []
    real = RecipeStore.list

    def counted(self, side):
        lists.append(side)
        return real(self, side)

    monkeypatch.setattr(RecipeStore, "list", counted)
    recipes = client.get("/api/recipes?side=drinks&q=rum").json()["recipes"]
    assert [r["slug"] for r in recipes] == ["daiquiri"]
    assert recipes[0]["bar"]["status"] == "unsorted"
    assert lists == ["drinks"]


def test_bar_work_runs_off_the_event_loop(client, monkeypatch):
    """A bar write waits on a lock an MCP call may hold; other requests must not."""
    calls = []

    def on_loop() -> bool:
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            return False
        return True

    for name in ("view", "apply"):
        real = getattr(Bar, name)

        def watched(self, *args, _real=real, _name=name, **kwargs):
            calls.append((_name, on_loop()))
            return _real(self, *args, **kwargs)

        monkeypatch.setattr(Bar, name, watched)
    assert client.get("/api/bar").status_code == 200
    assert client.post("/api/bar", json={"have": ["white rum"]}).status_code == 200
    assert client.get("/api/recipes?side=drinks").status_code == 200
    assert client.get("/api/recipes/drinks/daiquiri").status_code == 200
    assert {name for name, _ in calls} == {"view", "apply"}
    assert [call for call in calls if call[1]] == []
