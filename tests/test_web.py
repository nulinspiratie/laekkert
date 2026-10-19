import pytest
from starlette.testclient import TestClient

from app.config import Settings
from app.main import create_app

INDEX = '<!doctype html><div id="root"></div>'


@pytest.fixture
def dist(tmp_path):
    root = tmp_path / "dist"
    (root / "assets").mkdir(parents=True)
    (root / "index.html").write_text(INDEX)
    (root / "assets" / "app.js").write_text("console.log('app')")
    (root / "favicon.svg").write_text("<svg/>")
    (tmp_path / "secret.txt").write_text("secret")
    return root


@pytest.fixture
def client(tmp_path, dist):
    app = create_app(Settings(), data_dir=tmp_path / "data", static_dir=dist)
    with TestClient(app) as c:
        yield c


def test_root_serves_index(client):
    response = client.get("/")
    assert response.status_code == 200 and response.text == INDEX


def test_deep_link_serves_index(client):
    assert client.get("/drinks/daiquiri").text == INDEX


def test_asset_served(client):
    response = client.get("/assets/app.js")
    assert response.text == "console.log('app')"
    assert "javascript" in response.headers["content-type"]


def test_top_level_file_served(client):
    assert client.get("/favicon.svg").text == "<svg/>"


@pytest.mark.parametrize(
    "path", ["/%2e%2e/secret.txt", "/../secret.txt", "/a/%2e%2e/%2e%2e/secret.txt"]
)
def test_traversal_serves_index_not_file(client, path):
    response = client.get(path)
    assert "secret" not in response.text


def test_api_404_not_swallowed_by_spa(client):
    response = client.get("/api/nope")
    assert response.status_code == 404
    assert response.json() == {"error": "not found"}


def test_healthz_not_swallowed_by_spa(client):
    assert client.get("/healthz").json()["status"] == "ok"


def test_no_static_dir_root_message(tmp_path, monkeypatch):
    monkeypatch.delenv("STATIC_DIR", raising=False)
    with TestClient(create_app(Settings(), data_dir=tmp_path)) as c:
        response = c.get("/")
    assert response.status_code == 200
    assert "Frontend not built" in response.text


def test_static_dir_from_env(tmp_path, dist, monkeypatch):
    monkeypatch.setenv("STATIC_DIR", str(dist))
    with TestClient(create_app(Settings(), data_dir=tmp_path / "data")) as c:
        assert c.get("/food").text == INDEX
