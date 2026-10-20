import json
import logging
import shutil

import pytest

from app.recipes.model import SIDES, parse_recipe
from app.recipes.store import SEED_DIR, RecipeStore


@pytest.fixture
def store(tmp_path):
    s = RecipeStore(tmp_path)
    assert s.seed_if_empty()
    return s


def write(store, side, slug, text):
    path = store.recipes_dir / side / slug / "recipe.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    return path


def test_seed_recipes_are_valid():
    for side in SIDES:
        folders = sorted((SEED_DIR / side).iterdir())
        assert folders, f"no seed recipes for {side}"
        for folder in folders:
            r = parse_recipe(json.loads((folder / "recipe.json").read_text()))
            assert (r.side, r.slug) == (side, folder.name)


def test_seeds_are_format_2():
    for path in SEED_DIR.glob("*/*/recipe.json"):
        assert json.loads(path.read_text())["format_version"] == 2, path


def test_loads_v1_file_from_disk(store):
    # The M1 traybake as it was written on the NAS.
    path = store.recipes_dir / "food" / "chicken-leek-traybake" / "recipe.json"
    data = json.loads(path.read_text())
    data.update(format_version=1, tags=["batch cook"], marks=["tried", "kid_approved"])
    path.write_text(json.dumps(data))
    r = store.get("food", "chicken-leek-traybake")
    assert r is not None and r.format_version == 2
    assert r.marks == ["tried"]
    assert r.tags == ["batch cook", "kid approved"]


def test_list_is_per_side_and_sorted(store):
    assert [r.slug for r in store.list("drinks")] == ["daiquiri", "virgin-mojito"]
    assert {r.side for r in store.list("food")} == {"food"}


def test_get_returns_recipe(store):
    assert store.get("drinks", "daiquiri").name == "Daiquiri"


def test_get_unknown_returns_none(store):
    assert store.get("drinks", "nope") is None
    assert store.get("bar", "daiquiri") is None


@pytest.mark.parametrize("slug", ["../food", "..", "daiquiri/../x", "%2e%2e", ""])
def test_get_rejects_unsafe_slug(store, slug):
    assert store.get("drinks", slug) is None


def test_corrupt_file_is_skipped_with_warning(store, caplog):
    write(store, "drinks", "broken", "{not json")
    with caplog.at_level(logging.WARNING, logger="app.recipes"):
        assert [r.slug for r in store.list("drinks")] == ["daiquiri", "virgin-mojito"]
    assert "broken" in caplog.text
    assert store.get("drinks", "broken") is None


def test_newer_format_file_is_skipped(store, caplog):
    data = json.loads((store.recipes_dir / "drinks/daiquiri/recipe.json").read_text())
    write(store, "drinks", "future", json.dumps({**data, "format_version": 99}))
    with caplog.at_level(logging.WARNING, logger="app.recipes"):
        assert "future" not in [r.slug for r in store.list("drinks")]
    assert "future" in caplog.text


def test_folder_slug_mismatch_is_skipped(store, caplog):
    text = (store.recipes_dir / "drinks/daiquiri/recipe.json").read_text()
    write(store, "drinks", "other", text)
    with caplog.at_level(logging.WARNING, logger="app.recipes"):
        assert [r.slug for r in store.list("drinks")] == ["daiquiri", "virgin-mojito"]
    assert "other" in caplog.text
    assert store.get("drinks", "other") is None


def test_seed_if_empty_copies_once(tmp_path):
    s = RecipeStore(tmp_path)
    assert s.seed_if_empty() is True
    path = tmp_path / "recipes/drinks/daiquiri/recipe.json"
    path.write_text(path.read_text().replace("Daiquiri", "Edited"))
    assert s.seed_if_empty() is False
    assert "Edited" in path.read_text()


def test_seed_skipped_when_any_recipe_exists(tmp_path):
    s = RecipeStore(tmp_path)
    src = SEED_DIR / "drinks/daiquiri/recipe.json"
    write(s, "drinks", "daiquiri", src.read_text())
    assert s.seed_if_empty() is False
    assert s.list("food") == []


def test_missing_data_dir_lists_empty(tmp_path):
    assert RecipeStore(tmp_path / "nope").list("food") == []


def test_seed_failure_is_logged_not_raised(tmp_path, monkeypatch, caplog):
    def deny(*args, **kwargs):
        raise PermissionError("read-only file system")

    monkeypatch.setattr(shutil, "copytree", deny)
    with caplog.at_level(logging.WARNING, logger="app.recipes"):
        assert RecipeStore(tmp_path).seed_if_empty() is False
    assert "read-only" in caplog.text


@pytest.mark.parametrize("text", ["[]", "null", "42", '"x"'])
def test_non_object_file_is_skipped(store, caplog, text):
    write(store, "drinks", "odd", text)
    with caplog.at_level(logging.WARNING, logger="app.recipes"):
        assert [r.slug for r in store.list("drinks")] == ["daiquiri", "virgin-mojito"]
    assert "odd" in caplog.text


@pytest.mark.parametrize("version", [0, -1])
def test_unsupported_old_format_is_skipped(store, caplog, version):
    data = json.loads((store.recipes_dir / "drinks/daiquiri/recipe.json").read_text())
    write(store, "drinks", "ancient", json.dumps({**data, "format_version": version}))
    with caplog.at_level(logging.WARNING, logger="app.recipes"):
        assert "ancient" not in [r.slug for r in store.list("drinks")]
    assert "ancient" in caplog.text


def declare(store, side, slug, **fields):
    path = store.recipes_dir / side / slug / "recipe.json"
    data = json.loads(path.read_text())
    data.update(fields)
    path.write_text(json.dumps(data))
    return path.parent


def test_file_path_serves_declared_image(store):
    folder = declare(store, "drinks", "daiquiri", image="photo.jpg")
    (folder / "photo.jpg").write_bytes(b"jpeg")
    assert store.file_path("drinks", "daiquiri", "photo.jpg") == folder / "photo.jpg"


def test_file_path_serves_source_photo(store):
    folder = declare(
        store,
        "drinks",
        "daiquiri",
        source={"url": "https://x.example", "photo": "card.png"},
    )
    (folder / "card.png").write_bytes(b"png")
    assert store.file_path("drinks", "daiquiri", "card.png") == folder / "card.png"


def test_file_path_refuses_undeclared_and_data_files(store):
    folder = declare(store, "drinks", "daiquiri", image="photo.jpg")
    (folder / "photo.jpg").write_bytes(b"jpeg")
    (folder / "other.jpg").write_bytes(b"jpeg")
    (folder / "timeline.jsonl").write_text("{}\n")
    for name in ["recipe.json", "timeline.jsonl", "other.jpg", "missing.jpg"]:
        assert store.file_path("drinks", "daiquiri", name) is None
    # Declared but absent on disk.
    declare(store, "drinks", "virgin-mojito", image="gone.jpg")
    assert store.file_path("drinks", "virgin-mojito", "gone.jpg") is None


def test_file_path_refuses_declared_data_file_names(store):
    folder = declare(store, "drinks", "daiquiri", image="recipe.json")
    assert (folder / "recipe.json").is_file()
    assert store.file_path("drinks", "daiquiri", "recipe.json") is None


def test_file_path_refuses_traversal(store):
    for name in ["../daiquiri/recipe.json", "..\\x", "a/b.jpg", ".hidden", "..", ""]:
        declare(store, "drinks", "daiquiri", image=name)
        assert store.file_path("drinks", "daiquiri", name) is None
    folder = declare(store, "drinks", "daiquiri", image=".hidden")
    (folder / ".hidden").write_bytes(b"x")
    assert store.file_path("drinks", "daiquiri", ".hidden") is None


def test_file_path_refuses_symlink_out_of_folder(store, tmp_path):
    outside = tmp_path / "secret.jpg"
    outside.write_bytes(b"secret")
    folder = declare(store, "drinks", "daiquiri", image="photo.jpg")
    (folder / "photo.jpg").symlink_to(outside)
    assert store.file_path("drinks", "daiquiri", "photo.jpg") is None


@pytest.mark.parametrize("name", ["page.svg", "page.html", "notes.txt", "noext"])
def test_file_path_refuses_non_raster_files(store, name):
    folder = declare(store, "drinks", "daiquiri", image=name)
    (folder / name).write_text("<script>alert(1)</script>")
    assert store.file_path("drinks", "daiquiri", name) is None


def test_file_path_extension_is_case_insensitive(store):
    folder = declare(store, "drinks", "daiquiri", image="IMG_1.JPEG")
    (folder / "IMG_1.JPEG").write_bytes(b"jpeg")
    assert store.file_path("drinks", "daiquiri", "IMG_1.JPEG") == folder / "IMG_1.JPEG"


def test_file_path_unknown_recipe_or_side(store):
    assert store.file_path("drinks", "nope", "photo.jpg") is None
    assert store.file_path("bar", "daiquiri", "photo.jpg") is None
    assert store.file_path("drinks", "../food", "photo.jpg") is None


def test_file_path_refuses_symlink_to_data_file(store):
    folder = declare(store, "drinks", "daiquiri", image="photo.jpg")
    (folder / "photo.jpg").symlink_to(folder / "recipe.json")
    assert store.file_path("drinks", "daiquiri", "photo.jpg") is None
