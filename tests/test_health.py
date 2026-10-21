from starlette.testclient import TestClient

from app.config import Settings, load_settings
from app.main import create_app


def test_healthz_reports_version(monkeypatch, tmp_path):
    sha = "0123456789abcdef0123456789abcdef01234567"
    monkeypatch.setenv("APP_VERSION", sha)
    response = TestClient(create_app(Settings(), data_dir=tmp_path)).get("/healthz")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/json"
    assert response.json() == {"status": "ok", "version": sha}


def test_healthz_version_defaults_to_dev(monkeypatch, tmp_path):
    monkeypatch.delenv("APP_VERSION", raising=False)
    response = TestClient(create_app(Settings(), data_dir=tmp_path)).get("/healthz")
    assert response.json() == {"status": "ok", "version": "dev"}


def test_config_missing_file_gives_defaults(tmp_path):
    assert load_settings(tmp_path / "missing.toml") == Settings()


def test_config_file_overrides_defaults(tmp_path):
    path = tmp_path / "config.toml"
    path.write_text("seed_examples = false\nunknown_key = 1\n")
    assert load_settings(path) == Settings(seed_examples=False)


def test_config_path_from_app_config_env(tmp_path, monkeypatch):
    path = tmp_path / "config.toml"
    path.write_text("seed_examples = false\n")
    monkeypatch.setenv("APP_CONFIG", str(path))
    assert load_settings().seed_examples is False


def test_example_config_matches_defaults():
    assert load_settings("config.example.toml") == Settings()


def test_config_quick_tags_list_becomes_a_tuple(tmp_path):
    path = tmp_path / "config.toml"
    path.write_text('food_quick_tags = ["quick", "Kid approved"]\nunknown_key = 1\n')
    assert load_settings(path) == Settings(food_quick_tags=("quick", "Kid approved"))


def test_config_quick_tags_default():
    assert Settings().food_quick_tags == (
        "breakfast",
        "dinner",
        "kid approved",
        "quick",
        "vegetarian",
    )
