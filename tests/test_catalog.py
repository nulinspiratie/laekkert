import json
import logging
import os
import shutil

from app.recipes.catalog import SEED_CATALOG, Catalog


def write_catalog(catalog, entries, **extra):
    catalog.path.parent.mkdir(parents=True, exist_ok=True)
    catalog.path.write_text(
        json.dumps({"format_version": 1, "ingredients": entries, **extra})
    )


def test_lookup_matches_name_and_alias_case_insensitively(tmp_path):
    catalog = Catalog(tmp_path)
    write_catalog(
        catalog,
        [{"name": "ground cumin", "aliases": ["cumin"], "g_per_tsp": 2.0}],
    )
    assert catalog.g_per_tsp("Cumin ") == 2.0
    assert catalog.g_per_tsp("ground cumin") == 2.0
    assert catalog.g_per_tsp("saffron") is None


def test_missing_or_corrupt_file_means_empty_catalog(tmp_path, caplog):
    catalog = Catalog(tmp_path)
    with caplog.at_level(logging.WARNING, logger="app.recipes"):
        assert catalog.g_per_tsp("salt") is None
    assert caplog.records == []

    catalog.path.parent.mkdir(parents=True)
    catalog.path.write_text("{not json")
    with caplog.at_level(logging.WARNING, logger="app.recipes"):
        assert catalog.g_per_tsp("salt") is None
        assert catalog.g_per_tsp("salt") is None
    assert len(caplog.records) == 1
    assert "ingredients.json" in caplog.text


def test_entry_without_g_per_tsp_is_none(tmp_path):
    catalog = Catalog(tmp_path)
    write_catalog(catalog, [{"name": "lime", "fresh": True}])
    assert catalog.g_per_tsp("lime") is None


def test_newer_format_version_is_ignored_with_warning(tmp_path, caplog):
    catalog = Catalog(tmp_path)
    write_catalog(catalog, [{"name": "salt", "g_per_tsp": 6}], format_version=2)
    with caplog.at_level(logging.WARNING, logger="app.recipes"):
        assert catalog.g_per_tsp("salt") is None
    assert "format_version" in caplog.text


def test_rereads_file_when_it_changes(tmp_path):
    catalog = Catalog(tmp_path)
    write_catalog(catalog, [{"name": "salt", "g_per_tsp": 6}])
    assert catalog.g_per_tsp("salt") == 6
    write_catalog(catalog, [{"name": "salt", "g_per_tsp": 5}])
    stat = catalog.path.stat()
    os.utime(catalog.path, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000_000_000))
    assert catalog.g_per_tsp("salt") == 5


def test_seed_if_missing_copies_once(tmp_path):
    catalog = Catalog(tmp_path)
    assert catalog.seed_if_missing() is True
    assert catalog.g_per_tsp("smoked paprika") == 2.3
    catalog.path.write_text(catalog.path.read_text().replace("2.3", "9"))
    assert catalog.seed_if_missing() is False
    assert catalog.g_per_tsp("smoked paprika") == 9


def test_seed_failure_is_logged_not_raised(tmp_path, monkeypatch, caplog):
    def deny(*args, **kwargs):
        raise PermissionError("read-only file system")

    monkeypatch.setattr(shutil, "copyfile", deny)
    with caplog.at_level(logging.WARNING, logger="app.recipes"):
        assert Catalog(tmp_path).seed_if_missing() is False
    assert "read-only" in caplog.text


def test_seed_catalog_entries():
    entries = json.loads(SEED_CATALOG.read_text())["ingredients"]
    by_name = {e["name"]: e for e in entries}
    assert by_name["salt"]["aliases"] == ["fine salt", "sea salt"]
    assert by_name["honey"]["g_per_tsp"] == 7
    assert by_name["lime juice"]["fresh"] is True
    assert "g_per_tsp" not in by_name["mint"]
