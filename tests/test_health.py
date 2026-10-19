from starlette.testclient import TestClient

from app.config import Settings, load_settings
from app.main import create_app


def test_healthz_reports_version(monkeypatch):
    sha = "0123456789abcdef0123456789abcdef01234567"
    monkeypatch.setenv("APP_VERSION", sha)
    response = TestClient(create_app(Settings())).get("/healthz")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/json"
    assert response.json() == {"status": "ok", "version": sha}


def test_healthz_version_defaults_to_dev(monkeypatch):
    monkeypatch.delenv("APP_VERSION", raising=False)
    response = TestClient(create_app(Settings())).get("/healthz")
    assert response.json() == {"status": "ok", "version": "dev"}


def test_index_shows_greeting_from_config():
    client = TestClient(create_app(Settings(greeting="Hi <NAS>")))
    response = client.get("/")
    assert response.status_code == 200
    assert "Hi &lt;NAS&gt;" in response.text


def test_config_missing_file_gives_defaults(tmp_path):
    assert load_settings(tmp_path / "missing.toml") == Settings()


def test_config_file_overrides_defaults(tmp_path):
    path = tmp_path / "config.toml"
    path.write_text('greeting = "Hej"\nunknown_key = 1\n')
    assert load_settings(path) == Settings(greeting="Hej")


def test_config_path_from_app_config_env(tmp_path, monkeypatch):
    path = tmp_path / "config.toml"
    path.write_text('greeting = "From env"\n')
    monkeypatch.setenv("APP_CONFIG", str(path))
    assert load_settings().greeting == "From env"


def test_example_config_matches_defaults():
    assert load_settings("config.example.toml") == Settings()
