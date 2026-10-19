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


@pytest.mark.parametrize("query", ["", "?side=bar"])
def test_list_requires_valid_side(client, query):
    response = client.get(f"/api/recipes{query}")
    assert response.status_code == 400
    assert response.json() == {"error": "side must be food or drinks"}


def test_detail(client):
    body = client.get("/api/recipes/drinks/daiquiri").json()
    assert body["format_version"] == 1 and body["ingredients"][0]["unit"] == "ml"


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
