import json
import shutil

import pytest
from starlette.testclient import TestClient

from app.config import Settings
from app.main import create_app


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(Settings(), data_dir=tmp_path)) as c:
        yield c


def test_list_food_returns_seeds(client):
    slugs = {r["slug"] for r in client.get("/api/recipes?side=food").json()["recipes"]}
    assert slugs == {"chicken-leek-traybake", "red-lentil-dal"}


def test_list_returns_summaries(client):
    first = client.get("/api/recipes?side=drinks").json()["recipes"][0]
    assert first["slug"] == "daiquiri" and "ingredients" not in first
    assert set(first) == {
        "slug",
        "name",
        "side",
        "category",
        "time_minutes",
        "tags",
        "marks",
        "image",
        "rating",
        "last_made",
        "version",
        "bar",
    }
    assert first["rating"] is None and first["last_made"] is None
    assert first["version"] == 0


@pytest.mark.parametrize("query", ["", "?side=bar"])
def test_list_requires_valid_side(client, query):
    response = client.get(f"/api/recipes{query}")
    assert response.status_code == 400
    assert response.json() == {"error": "side must be food or drinks"}


def test_detail(client):
    body = client.get("/api/recipes/drinks/daiquiri").json()
    assert body["format_version"] == 3 and body["ingredients"][0]["unit"] == "ml"
    assert body["version"] == 0


def test_detail_adds_g_per_tsp(client):
    items = {
        i["item"]: i
        for i in client.get("/api/recipes/food/chicken-leek-traybake").json()[
            "ingredients"
        ]
    }
    assert items["smoked paprika"]["g_per_tsp"] == 2.3
    assert items["chicken thighs"]["g_per_tsp"] is None


@pytest.mark.parametrize(
    "path",
    [
        "/api/recipes/drinks/nope",
        "/api/recipes/bar/daiquiri",
        "/api/recipes/drinks/..%2Ffood",
        "/api/recipes/drinks/%2e%2e",
    ],
)
def test_detail_404(client, path):
    response = client.get(path)
    assert response.status_code == 404
    assert response.json() == {"error": "not found"}


def test_unknown_api_path_is_json_404(client):
    response = client.get("/api/nope")
    assert response.status_code == 404
    assert response.headers["content-type"] == "application/json"


def test_seed_examples_false_starts_empty(tmp_path):
    with TestClient(create_app(Settings(seed_examples=False), data_dir=tmp_path)) as c:
        assert c.get("/api/recipes?side=food").json() == {"recipes": []}
    assert not (tmp_path / "recipes").exists()


def test_app_starts_with_unwritable_data_dir(tmp_path, monkeypatch):
    def deny(*args, **kwargs):
        raise PermissionError("read-only file system")

    monkeypatch.setattr(shutil, "copytree", deny)
    with TestClient(create_app(Settings(), data_dir=tmp_path)) as c:
        assert c.get("/healthz").status_code == 200
        assert c.get("/api/recipes?side=food").json() == {"recipes": []}


def test_data_dir_from_env(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    with TestClient(create_app(Settings())):
        pass
    assert (tmp_path / "recipes/drinks/daiquiri/recipe.json").is_file()


def test_list_with_q_filters_and_orders(client):
    recipes = client.get("/api/recipes?side=food&q=chiken leek").json()["recipes"]
    assert [r["slug"] for r in recipes] == ["chicken-leek-traybake"]
    assert client.get("/api/recipes?side=food&q=pizza").json() == {"recipes": []}
    drinks = client.get("/api/recipes?side=drinks&q=dai").json()["recipes"]
    assert [r["slug"] for r in drinks] == ["daiquiri"]


@pytest.mark.parametrize("q", ["", "   "])
def test_list_with_blank_q_is_unfiltered(client, q):
    unfiltered = client.get("/api/recipes?side=food").json()
    assert client.get("/api/recipes", params={"side": "food", "q": q}).json() == (
        unfiltered
    )


def test_list_with_q_still_requires_side(client):
    assert client.get("/api/recipes?q=dai").status_code == 400


def declare_image(tmp_path, data=b"\xff\xd8jpeg-bytes"):
    folder = tmp_path / "recipes/drinks/daiquiri"
    recipe = json.loads((folder / "recipe.json").read_text())
    recipe["image"] = "photo.jpg"
    (folder / "recipe.json").write_text(json.dumps(recipe))
    (folder / "photo.jpg").write_bytes(data)


def test_image_route_serves_bytes_and_cache_header(client, tmp_path):
    declare_image(tmp_path)
    response = client.get("/api/recipes/drinks/daiquiri/files/photo.jpg")
    assert response.status_code == 200
    assert response.content == b"\xff\xd8jpeg-bytes"
    assert response.headers["content-type"] == "image/jpeg"
    assert response.headers["cache-control"] == "private, max-age=3600"
    assert response.headers["x-content-type-options"] == "nosniff"


@pytest.mark.parametrize(
    "name",
    [
        "%2e%2e%2frecipe.json",
        "..%2Fdaiquiri%2Frecipe.json",
        "%2e%2e/x",
        "recipe.json",
        "timeline.jsonl",
        "other.jpg",
        "missing.jpg",
    ],
)
def test_image_route_404s_for_encoded_traversal(client, tmp_path, name):
    declare_image(tmp_path)
    (tmp_path / "recipes/drinks/daiquiri/timeline.jsonl").write_text("{}\n")
    (tmp_path / "recipes/drinks/daiquiri/other.jpg").write_bytes(b"x")
    response = client.get(f"/api/recipes/drinks/daiquiri/files/{name}")
    assert response.status_code == 404
    assert response.json() == {"error": "not found"}


@pytest.mark.parametrize(
    "path",
    [
        "/api/recipes/bar/daiquiri/files/photo.jpg",
        "/api/recipes/drinks/nope/files/photo.jpg",
        "/api/recipes/drinks/..%2Ffood/files/photo.jpg",
    ],
)
def test_image_route_404s_for_unknown_recipe(client, tmp_path, path):
    declare_image(tmp_path)
    response = client.get(path)
    assert response.status_code == 404
    assert response.json() == {"error": "not found"}


FOOD_ONLY = '"What you have" is for food only.'


def have_list(client, *params):
    return client.get("/api/recipes", params=[("side", "food"), *params])


def test_list_have_ranks_and_annotates(client):
    response = have_list(client, ("have", "chicken"), ("have", "leeks"))
    recipes = response.json()["recipes"]
    assert [r["slug"] for r in recipes] == ["chicken-leek-traybake"]
    assert recipes[0]["have"] == {
        "matched": ["chicken thighs", "leeks"],
        "missing": ["baby potatoes", "olive oil", "smoked paprika", "lemon"],
    }


def test_list_have_with_q(client):
    both = have_list(client, ("q", "dal"), ("have", "onion")).json()["recipes"]
    assert [r["slug"] for r in both] == ["red-lentil-dal"]
    response = have_list(client, ("q", "traybake"), ("have", "onion"))
    assert response.status_code == 200
    assert response.json() == {"recipes": []}


def test_list_have_nothing_matches(client):
    response = have_list(client, ("have", "zzzz"))
    assert response.status_code == 200
    assert response.json() == {"recipes": []}


@pytest.mark.parametrize("blank", ["", " "])
def test_list_blank_have_is_ignored(client, blank):
    plain = have_list(client).json()
    blanked = have_list(client, ("have", blank))
    assert blanked.status_code == 200
    assert blanked.json() == plain
    assert all("have" not in r for r in blanked.json()["recipes"])


def test_list_have_on_drinks_is_refused(client):
    response = client.get("/api/recipes?side=drinks&have=lime")
    assert response.status_code == 400
    assert response.json() == {"error": FOOD_ONLY}


def test_list_blank_have_on_drinks_is_fine(client):
    assert client.get("/api/recipes?side=drinks&have=%20").status_code == 200


def test_settings_returns_the_default_quick_tags(client):
    response = client.get("/api/settings")
    assert response.status_code == 200
    assert response.json() == {
        "food_quick_tags": [
            "breakfast",
            "dinner",
            "kid approved",
            "quick",
            "vegetarian",
        ]
    }


def test_settings_returns_configured_quick_tags(tmp_path):
    settings = Settings(food_quick_tags=("quick", "Kid approved"))
    with TestClient(create_app(settings, data_dir=tmp_path)) as c:
        assert c.get("/api/settings").json() == {
            "food_quick_tags": ["quick", "Kid approved"]
        }
    with TestClient(create_app(Settings(food_quick_tags=()), data_dir=tmp_path)) as c:
        assert c.get("/api/settings").json() == {"food_quick_tags": []}
