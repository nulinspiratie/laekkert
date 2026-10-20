import json
import logging
import os
import shutil

import pytest

from app.recipes import catalog as catalog_module
from app.recipes.catalog import (
    KINDS,
    SEED_CATALOG,
    Catalog,
    CatalogUnavailable,
    name_key,
)


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
    assert by_name["soda water"]["fresh"] is True
    assert by_name["white rum"]["kind"] == "spirits"
    assert by_name["simple syrup"]["kind"] == "syrups"


def test_seed_catalog_names_are_unique():
    entries = json.loads(SEED_CATALOG.read_text())["ingredients"]
    keys = [name_key(n) for e in entries for n in (e["name"], *e.get("aliases", []))]
    assert len(keys) == len(set(keys))


def test_key_ignores_accents_case_and_spacing(tmp_path):
    catalog = Catalog(tmp_path)
    write_catalog(catalog, [{"name": "Crème de violette"}])
    assert name_key("Crème de violette") == "creme de violette"
    assert catalog.entry("creme  DE violette ").name == "Crème de violette"
    assert catalog.entry("campari") is None


def test_kinds_are_in_display_order():
    assert KINDS == (
        "spirits",
        "liqueurs",
        "aperitifs",
        "bitters",
        "syrups",
        "other",
    )


def test_entry_kind_parses_and_rejects_unknown(tmp_path):
    catalog = Catalog(tmp_path)
    write_catalog(
        catalog,
        [
            {"name": "gin", "kind": "spirits"},
            {"name": "claret", "kind": "wine"},
            {"name": "salt"},
        ],
    )
    assert catalog.entry("gin").kind == "spirits"
    assert catalog.entry("salt").kind is None
    assert [e.name for e in catalog.entries()] == ["gin", "salt"]


def test_entries_lists_each_entry_once_in_file_order(tmp_path):
    catalog = Catalog(tmp_path)
    write_catalog(
        catalog,
        [
            {"name": "ground cumin", "aliases": ["cumin"]},
            {"name": "aperol"},
            {"name": "Cumin"},
        ],
    )
    # An alias does not repeat its entry; a later entry with a taken name is
    # still listed, but lookups find the first.
    assert [e.name for e in catalog.entries()] == ["ground cumin", "aperol", "Cumin"]
    assert catalog.entry("cumin").name == "ground cumin"


def test_raw_missing_file_is_empty(tmp_path):
    assert Catalog(tmp_path).raw() == []


@pytest.mark.parametrize(
    "text",
    [
        "{not json",
        json.dumps({"format_version": 2, "ingredients": []}),
        json.dumps({"format_version": 1, "ingredients": {}}),
        json.dumps({"ingredients": []}),
        json.dumps([]),
    ],
)
def test_raw_unreadable_or_newer_raises(tmp_path, text):
    catalog = Catalog(tmp_path)
    catalog.path.parent.mkdir(parents=True)
    catalog.path.write_text(text)
    with pytest.raises(CatalogUnavailable, match="Fix catalog/ingredients.json"):
        catalog.raw()
    with pytest.raises(CatalogUnavailable):
        catalog.save_raw([{"name": "gin"}])


def test_save_keeps_untouched_entries_verbatim(tmp_path):
    catalog = Catalog(tmp_path)
    first = {"name": "salt", "g_per_tsp": 6.0, "note": "hand"}
    write_catalog(catalog, [first, {"name": ""}])
    assert catalog.entry("salt").g_per_tsp == 6.0
    catalog.save_raw(catalog.raw() + [{"name": "gin", "kind": "spirits"}])
    saved = json.loads(catalog.path.read_text(encoding="utf-8"))
    assert saved["format_version"] == 1
    assert saved["ingredients"] == [
        first,
        {"name": ""},
        {"name": "gin", "kind": "spirits"},
    ]
    assert catalog.entry("gin").kind == "spirits"
    assert catalog.path.read_text(encoding="utf-8").endswith("}\n")


def test_save_keeps_other_top_level_keys(tmp_path):
    catalog = Catalog(tmp_path)
    write_catalog(catalog, [{"name": "salt"}], comment="edited by hand")
    catalog.save_raw([{"name": "gin"}])
    saved = json.loads(catalog.path.read_text(encoding="utf-8"))
    assert saved["comment"] == "edited by hand"
    assert saved["ingredients"] == [{"name": "gin"}]


def test_save_into_missing_file_writes_it(tmp_path):
    catalog = Catalog(tmp_path)
    catalog.save_raw([{"name": "Crème de cassis"}])
    assert json.loads(catalog.path.read_text(encoding="utf-8")) == {
        "format_version": 1,
        "ingredients": [{"name": "Crème de cassis"}],
    }
    assert "Crème" in catalog.path.read_text(encoding="utf-8")


def test_a_reload_swaps_the_lookup_in_one_step(tmp_path, monkeypatch):
    """A reader on another thread sees the old names or the new, never a part."""
    catalog = Catalog(tmp_path)
    write_catalog(catalog, [{"name": "gin", "g_per_tsp": 1.0}])
    assert catalog.g_per_tsp("gin") == 1.0
    write_catalog(catalog, [{"name": "gin", "g_per_tsp": 1.0}, {"name": "tonic"}])
    moved = catalog.path.stat().st_mtime_ns + 1_000_000
    os.utime(catalog.path, ns=(moved, moved))
    seen = []
    real = catalog_module.name_key

    def watched(name):
        # What entry("gin") on another thread would get at this moment.
        seen.append(catalog._entries.get("gin"))
        return real(name)

    monkeypatch.setattr(catalog_module, "name_key", watched)
    catalog.entries()  # reloads
    monkeypatch.undo()
    assert seen
    assert None not in seen
    assert catalog.entry("tonic") is not None
