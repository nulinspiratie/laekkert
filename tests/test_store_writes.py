import errno
import json
import os
from pathlib import Path

import pytest

from app.recipes.catalog import Catalog
from app.recipes.drafts import parse_draft
from app.recipes.store import RecipeStore
from app.recipes.uploads import UploadStore

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16

GOOD = {
    "name": "Daiquiri",
    "category": "cocktails",
    "servings": 1,
    "time_minutes": 5,
    "ingredients": [
        {"amount": 50, "unit": "ml", "item": "white rum"},
        {"amount": 25, "unit": "ml", "item": "lime juice"},
    ],
    "steps": ["Shake."],
    "source": None,
    "tags": [],
    "image": None,
}


@pytest.fixture
def store(tmp_path):
    catalog = Catalog(tmp_path)
    catalog.seed_if_missing()
    s = RecipeStore(tmp_path, catalog, UploadStore(tmp_path))
    assert s.seed_if_empty()
    return s


def draft(**over):
    return parse_draft({**GOOD, **over})


def draft_of(recipe, **over):
    fields = set(GOOD)
    data = {k: v for k, v in recipe.model_dump(mode="json").items() if k in fields}
    return parse_draft({**data, **over})


def folder(store, side, slug) -> Path:
    return store.recipes_dir / side / slug


def raw(store, side, slug, name="recipe.json") -> bytes:
    return (folder(store, side, slug) / name).read_bytes()


def versions(store, side, slug) -> list[str]:
    path = folder(store, side, slug) / "versions"
    return sorted(p.name for p in path.glob("*")) if path.exists() else []


def kinds(entries):
    return [e.kind for e in entries]


def upload(store, content=PNG) -> str:
    return store._uploads.save("image/png", content)


# --- create ---


def test_create_writes_recipe_version_and_created_entry(store):
    recipe = store.create("drinks", draft(), "app")
    assert (recipe.slug, recipe.side, recipe.format_version) == (
        "daiquiri-2",
        "drinks",
        2,
    )
    # An existing Daiquiri is already there, so this one is daiquiri-2.
    assert store.get("drinks", "daiquiri-2") == recipe
    assert raw(store, "drinks", "daiquiri-2", "versions/0001.json") == raw(
        store, "drinks", "daiquiri-2"
    )
    [entry] = store.timeline("drinks", "daiquiri-2")
    assert (entry.kind, entry.version, entry.via) == ("created", 1, "app")
    assert store.current_version("drinks", "daiquiri-2") == 1


def test_create_dedupes_slug(store):
    first = store.create("drinks", draft(name="Zombie"), "app")
    second = store.create("drinks", draft(name="Zombie"), "app")
    third = store.create("drinks", draft(name="Zombie"), "app")
    assert [first.slug, second.slug, third.slug] == ["zombie", "zombie-2", "zombie-3"]
    # The other side is a different namespace.
    assert (
        store.create("food", draft(name="Zombie", category="mains"), "app").slug
        == "zombie"
    )


def test_create_avoids_reserved_new(store):
    assert (
        store.create("food", draft(name="New", category="mains"), "app").slug == "new-2"
    )


def test_create_invalid_draft_writes_nothing(store):
    with pytest.raises(ValueError, match="Give the recipe a name"):
        store.create("drinks", draft(name="  "), "app")
    assert [r.slug for r in store.list("drinks")] == ["daiquiri", "virgin-mojito"]
    assert not (store.recipes_dir / "drinks" / "recipe").exists()


# --- update ---


def test_update_writes_next_version_and_diff(store):
    created = store.create("drinks", draft(name="Zombie"), "app")
    changed = draft_of(created, servings=2)
    updated = store.update("drinks", "zombie", changed, "app")
    assert updated.servings == 2
    assert versions(store, "drinks", "zombie") == ["0001.json", "0002.json"]
    assert raw(store, "drinks", "zombie", "versions/0002.json") == raw(
        store, "drinks", "zombie"
    )
    assert (
        json.loads(raw(store, "drinks", "zombie", "versions/0001.json"))["servings"]
        == 1
    )
    created_entry, edit = store.timeline("drinks", "zombie")
    assert created_entry.kind == "created"
    assert (edit.kind, edit.version, edit.restored_from) == ("edit", 2, None)
    assert [(c.section, c.text) for c in edit.changes] == [
        ("details", "servings 1 → 2")
    ]
    assert store.current_version("drinks", "zombie") == 2


def test_update_unknown_recipe_is_none(store):
    assert store.update("drinks", "nope", draft(), "app") is None


def test_update_without_change_writes_nothing(store):
    created = store.create("drinks", draft(name="Zombie"), "app")
    before = (
        raw(store, "drinks", "zombie"),
        raw(store, "drinks", "zombie", "timeline.jsonl"),
    )
    again = store.update("drinks", "zombie", draft_of(created), "app")
    assert again == created
    assert versions(store, "drinks", "zombie") == ["0001.json"]
    after = (
        raw(store, "drinks", "zombie"),
        raw(store, "drinks", "zombie", "timeline.jsonl"),
    )
    assert after == before


def test_update_without_change_leaves_legacy_recipe_alone(store):
    seed = store.get("drinks", "daiquiri")
    before = raw(store, "drinks", "daiquiri")
    assert store.update("drinks", "daiquiri", draft_of(seed), "app") == seed
    assert raw(store, "drinks", "daiquiri") == before
    assert versions(store, "drinks", "daiquiri") == []
    assert store.timeline("drinks", "daiquiri") == []


def test_first_edit_of_legacy_recipe_writes_baseline(store):
    seed = store.get("drinks", "daiquiri")
    old = raw(store, "drinks", "daiquiri")
    assert store.current_version("drinks", "daiquiri") is None
    store.update("drinks", "daiquiri", draft_of(seed, servings=2), "app")
    assert versions(store, "drinks", "daiquiri") == ["0001.json", "0002.json"]
    assert raw(store, "drinks", "daiquiri", "versions/0001.json") == old
    assert (
        json.loads(raw(store, "drinks", "daiquiri", "versions/0002.json"))["servings"]
        == 2
    )
    baseline, edit = store.timeline("drinks", "daiquiri")
    assert (baseline.kind, baseline.version) == ("baseline", 1)
    assert (edit.kind, edit.version) == ("edit", 2)
    # The second edit goes straight to 3, with no new baseline.
    store.update("drinks", "daiquiri", draft_of(seed, servings=3), "app")
    assert kinds(store.timeline("drinks", "daiquiri")) == ["baseline", "edit", "edit"]
    assert store.current_version("drinks", "daiquiri") == 3


def test_update_keeps_marks_and_slug_on_rename(store):
    seed = store.get("drinks", "daiquiri")
    assert seed.marks == ["tried", "favourite"]
    updated = store.update(
        "drinks", "daiquiri", draft_of(seed, name="Classic Daiquiri"), "app"
    )
    assert (updated.slug, updated.name) == ("daiquiri", "Classic Daiquiri")
    assert set(updated.marks) == {"tried", "favourite"}
    assert store.get("drinks", "classic-daiquiri") is None
    assert store.get("drinks", "daiquiri").name == "Classic Daiquiri"


def test_update_writes_format_2_with_marks_in_order(store):
    seed = store.get("drinks", "daiquiri")
    store.update("drinks", "daiquiri", draft_of(seed, servings=2), "app")
    data = json.loads(raw(store, "drinks", "daiquiri"))
    assert data["format_version"] == 2
    assert data["marks"] == ["favourite", "tried"]


# --- restore ---


def test_restore_writes_new_version_with_restored_from(store):
    created = store.create("drinks", draft(name="Zombie"), "app")
    store.update("drinks", "zombie", draft_of(created, servings=4), "app")
    store.set_marks("drinks", "zombie", ["favourite"], [], "app")
    restored = store.restore("drinks", "zombie", 1, "app")
    assert restored.servings == 1
    assert set(restored.marks) == {"favourite", "tried"}
    assert versions(store, "drinks", "zombie") == [
        "0001.json",
        "0002.json",
        "0003.json",
    ]
    v1 = json.loads(raw(store, "drinks", "zombie", "versions/0001.json"))
    v3 = json.loads(raw(store, "drinks", "zombie", "versions/0003.json"))
    assert {**v3, "marks": []} == {**v1, "marks": []}
    assert v3 == json.loads(raw(store, "drinks", "zombie"))
    edit = store.timeline("drinks", "zombie")[-1]
    assert (edit.kind, edit.version, edit.restored_from) == ("edit", 3, 1)
    assert [c.text for c in edit.changes] == ["servings 4 → 1"]
    # Nothing is erased.
    assert (
        json.loads(raw(store, "drinks", "zombie", "versions/0002.json"))["servings"]
        == 4
    )


@pytest.mark.parametrize("version", [0, -1, 2, 99])
def test_restore_missing_version_is_none(store, version):
    store.create("drinks", draft(name="Zombie"), "app")
    before = raw(store, "drinks", "zombie")
    assert store.restore("drinks", "zombie", version, "app") is None
    assert raw(store, "drinks", "zombie") == before
    assert versions(store, "drinks", "zombie") == ["0001.json"]


def test_restore_unknown_recipe_and_unreadable_version(store):
    assert store.restore("drinks", "nope", 1, "app") is None
    # A legacy recipe has no versions at all.
    assert store.restore("drinks", "daiquiri", 1, "app") is None
    store.create("drinks", draft(name="Zombie"), "app")
    (folder(store, "drinks", "zombie") / "versions" / "0001.json").write_text("{nope")
    assert store.restore("drinks", "zombie", 1, "app") is None


# --- delete ---


def test_delete_moves_to_trash(store, tmp_path):
    assert store.delete("drinks", "daiquiri") is True
    assert [r.slug for r in store.list("drinks")] == ["virgin-mojito"]
    [trashed] = (tmp_path / "trash" / "drinks").iterdir()
    assert trashed.name.startswith("daiquiri-")
    assert len(trashed.name) == len("daiquiri-20261020T120000Z")
    assert trashed.name.endswith("Z")
    assert (trashed / "recipe.json").is_file()
    assert store.delete("drinks", "daiquiri") is False
    assert store.timeline("drinks", "daiquiri") is None


def test_delete_twice_in_one_second_keeps_both(store, tmp_path):
    store.create("drinks", draft(name="Zombie"), "app")
    store.delete("drinks", "zombie")
    store.create("drinks", draft(name="Zombie"), "app")
    assert store.delete("drinks", "zombie") is True
    assert len(list((tmp_path / "trash" / "drinks").iterdir())) == 2


@pytest.mark.parametrize(("side", "slug"), [("bar", "daiquiri"), ("drinks", "../food")])
def test_delete_refuses_bad_names(store, side, slug):
    assert store.delete(side, slug) is False


def test_seed_skips_when_trash_not_empty(tmp_path):
    catalog = Catalog(tmp_path)
    s = RecipeStore(tmp_path, catalog, UploadStore(tmp_path))
    assert s.seed_if_empty()
    for side, slug in [("drinks", "daiquiri"), ("drinks", "virgin-mojito")]:
        assert s.delete(side, slug)
    for slug in ("chicken-leek-traybake", "red-lentil-dal"):
        assert s.delete("food", slug)
    assert s.list("food") == [] and s.list("drinks") == []
    assert s.seed_if_empty() is False
    assert s.list("food") == []


# --- marks ---


def test_favourite_implies_tried(store):
    store.create("drinks", draft(name="Zombie"), "app")
    recipe = store.set_marks("drinks", "zombie", ["favourite"], [], "app")
    assert recipe.marks == ["favourite", "tried"]
    entry = store.timeline("drinks", "zombie")[-1]
    assert (entry.kind, entry.added, entry.removed) == (
        "marks",
        ["favourite", "tried"],
        [],
    )


def test_removing_tried_removes_favourite(store):
    seed = store.get("drinks", "daiquiri")
    assert {"tried", "favourite"} <= set(seed.marks)
    recipe = store.set_marks("drinks", "daiquiri", [], ["tried"], "app")
    assert recipe.marks == []
    entry = store.timeline("drinks", "daiquiri")[-1]
    assert (entry.added, entry.removed) == ([], ["favourite", "tried"])


def test_marks_follow_mark_order_and_try_next_is_independent(store):
    store.create("drinks", draft(name="Zombie"), "app")
    recipe = store.set_marks("drinks", "zombie", ["try_next", "favourite"], [], "app")
    assert recipe.marks == ["favourite", "try_next", "tried"]
    assert json.loads(raw(store, "drinks", "zombie"))["marks"] == [
        "favourite",
        "try_next",
        "tried",
    ]
    entry = store.timeline("drinks", "zombie")[-1]
    assert entry.added == ["favourite", "try_next", "tried"]


def test_marks_entry_only_on_change(store):
    store.create("drinks", draft(name="Zombie"), "app")
    store.set_marks("drinks", "zombie", ["try_next"], [], "app")
    assert kinds(store.timeline("drinks", "zombie")) == ["created", "marks"]
    before = raw(store, "drinks", "zombie", "timeline.jsonl")
    recipe = store.set_marks("drinks", "zombie", ["try_next"], ["favourite"], "app")
    assert recipe.marks == ["try_next"]
    assert raw(store, "drinks", "zombie", "timeline.jsonl") == before
    store.set_marks("drinks", "zombie", [], ["try_next"], "app")
    assert store.timeline("drinks", "zombie")[-1].removed == ["try_next"]


def test_marks_make_no_version_and_rewrite_legacy_as_format_2(store):
    path = folder(store, "drinks", "daiquiri") / "recipe.json"
    data = json.loads(path.read_text())
    path.write_text(json.dumps({**data, "format_version": 1, "marks": ["tried"]}))
    store.set_marks("drinks", "daiquiri", ["favourite"], [], "app")
    assert versions(store, "drinks", "daiquiri") == []
    assert json.loads(path.read_text())["format_version"] == 2


def test_set_marks_same_mark_added_and_removed_is_an_error(store):
    with pytest.raises(ValueError):
        store.set_marks("drinks", "daiquiri", ["try_next"], ["try_next"], "app")
    with pytest.raises(ValueError):
        store.set_marks("drinks", "daiquiri", ["favourite"], ["tried"], "app")
    assert store.set_marks("drinks", "nope", ["favourite"], [], "app") is None


def test_rating_and_made_are_tastings(store):
    store.create("drinks", draft(name="Zombie"), "app")
    store.create("drinks", draft(name="Mai Tai"), "app")
    store.set_marks("drinks", "zombie", ["try_next"], [], "app")
    store.set_marks("drinks", "mai-tai", ["try_next"], [], "app")
    marks_entries = kinds(store.timeline("drinks", "zombie"))

    rating = store.add_rating("drinks", "zombie", 4.5, "app")
    assert (rating.kind, rating.rating, rating.previous) == ("rating", 4.5, None)
    assert store.get("drinks", "zombie").marks == ["tried"]

    made = store.add_made("drinks", "mai-tai", None, "  lovely  ", "app")
    assert (made.kind, made.rating, made.note) == ("made", None, "lovely")
    assert store.get("drinks", "mai-tai").marks == ["tried"]

    # Only the tasting entry was added: no separate marks entry, no version.
    assert kinds(store.timeline("drinks", "zombie")) == [*marks_entries, "rating"]
    assert kinds(store.timeline("drinks", "mai-tai")) == ["created", "marks", "made"]
    assert versions(store, "drinks", "zombie") == ["0001.json"]


def test_tasting_keeps_favourite_and_other_marks(store):
    recipe = store.get("drinks", "daiquiri")
    assert "favourite" in recipe.marks
    store.add_made("drinks", "daiquiri", 4, "", "app")
    assert store.get("drinks", "daiquiri").marks == ["favourite", "tried"]


def test_rating_records_previous_and_made_rating_counts(store):
    store.add_rating("drinks", "daiquiri", 4, "app")
    second = store.add_rating("drinks", "daiquiri", 4.5, "app")
    assert second.previous == 4
    store.add_made("drinks", "daiquiri", 3, "", "app")
    third = store.add_rating("drinks", "daiquiri", 5, "app")
    assert third.previous == 3
    # A made entry without a rating doesn't reset it.
    store.add_made("drinks", "daiquiri", None, "", "app")
    assert store.add_rating("drinks", "daiquiri", 2, "app").previous == 5


@pytest.mark.parametrize("rating", [0, 0.25, 5.5, 6, -1, float("nan")])
def test_bad_rating_is_one_sentence(store, rating):
    with pytest.raises(ValueError) as err:
        store.add_rating("drinks", "daiquiri", rating, "app")
    assert str(err.value) == "Ratings go from 0.5 to 5 in half stars"
    with pytest.raises(ValueError, match="half stars"):
        store.add_made("drinks", "daiquiri", rating, "", "app")
    assert store.timeline("drinks", "daiquiri") == []
    assert store.get("drinks", "daiquiri").marks == ["tried", "favourite"]


def test_note_is_not_a_tasting(store):
    store.create("drinks", draft(name="Zombie"), "app")
    store.set_marks("drinks", "zombie", ["try_next"], [], "app")
    before = store.get("drinks", "zombie")
    entry = store.add_note("drinks", "zombie", "  Needs more lime  ", "claude")
    assert (entry.kind, entry.text, entry.via) == ("note", "Needs more lime", "claude")
    assert store.get("drinks", "zombie") == before
    assert store.get("drinks", "zombie").marks == ["try_next"]


@pytest.mark.parametrize("text", ["", "   ", "\n\t"])
def test_blank_note_is_refused(store, text):
    with pytest.raises(ValueError, match="^Write something in the note$"):
        store.add_note("drinks", "daiquiri", text, "app")
    assert store.timeline("drinks", "daiquiri") == []


def test_overlong_note_is_one_sentence(store):
    with pytest.raises(ValueError, match="2000"):
        store.add_note("drinks", "daiquiri", "x" * 2001, "app")
    with pytest.raises(ValueError, match="2000"):
        store.add_made("drinks", "daiquiri", None, "x" * 2001, "app")


def test_entry_methods_on_unknown_recipe_are_none(store):
    assert store.add_note("drinks", "nope", "hi", "app") is None
    assert store.add_rating("drinks", "nope", 4, "app") is None
    assert store.add_made("drinks", "nope", 4, "", "app") is None
    assert store.timeline("drinks", "nope") is None
    assert store.current_version("drinks", "nope") is None


# --- images ---


def test_draft_image_must_be_upload_or_own_file(store):
    seed = store.get("food", "red-lentil-dal")
    dal = folder(store, "food", "red-lentil-dal")
    for bad in [
        "../../food/red-lentil-dal/recipe.json",
        "../red-lentil-dal/recipe.json",
        "recipe.json",
        "timeline.jsonl",
        "missing.jpg",
        "img-0123456789abcdef.png",
    ]:
        with pytest.raises(ValueError, match="no longer available; pick it again"):
            store.update("food", "red-lentil-dal", draft_of(seed, image=bad), "app")
    with pytest.raises(ValueError, match="no longer available"):
        store.update(
            "food",
            "red-lentil-dal",
            draft_of(seed, source={"url": None, "photo": "recipe.json"}),
            "app",
        )
    assert versions(store, "food", "red-lentil-dal") == []

    name = upload(store)
    updated = store.update("food", "red-lentil-dal", draft_of(seed, image=name), "app")
    assert updated.image == name
    assert (dal / name).read_bytes() == PNG
    assert store._uploads.path(name) is None

    # The recipe's own image is kept as it is on the next save; a new upload
    # replaces it and the old file stays in the folder for older versions.
    current = store.get("food", "red-lentil-dal")
    kept = store.update("food", "red-lentil-dal", draft_of(current, servings=9), "app")
    assert kept.image == name
    second = upload(store, PNG + b"2")
    swapped = store.update(
        "food", "red-lentil-dal", draft_of(kept, image=second), "app"
    )
    assert swapped.image == second
    assert (dal / name).is_file() and (dal / second).is_file()


def test_upload_on_create_and_source_photo(store):
    image, photo = upload(store), upload(store, PNG + b"x")
    recipe = store.create(
        "drinks",
        draft(name="Zombie", image=image, source={"url": None, "photo": photo}),
        "app",
    )
    zombie = folder(store, "drinks", "zombie")
    assert (zombie / image).is_file() and (zombie / photo).is_file()
    assert recipe.image == image and recipe.source.photo == photo
    assert store.file_path("drinks", "zombie", image) is not None
    assert store._uploads.path(image) is None and store._uploads.path(photo) is None


def test_create_refuses_an_unknown_image_name(store):
    with pytest.raises(ValueError, match="no longer available"):
        store.create("drinks", draft(name="Zombie", image="daiquiri.jpg"), "app")
    assert not folder(store, "drinks", "zombie").exists()


def test_same_upload_as_image_and_photo_moves_once(store):
    name = upload(store)
    recipe = store.create(
        "drinks",
        draft(name="Zombie", image=name, source={"url": None, "photo": name}),
        "app",
    )
    assert recipe.image == name == recipe.source.photo
    assert (folder(store, "drinks", "zombie") / name).is_file()


# --- failures ---


def fail_timeline_write(monkeypatch):
    def boom(path, data):
        raise OSError("disk full")

    monkeypatch.setattr("app.recipes.timeline.atomic_write", boom)


def snapshot(root: Path) -> dict[str, bytes]:
    return {
        str(p.relative_to(root)): p.read_bytes() for p in root.rglob("*") if p.is_file()
    }


def test_failed_write_changes_nothing(store, tmp_path, monkeypatch):
    # A legacy recipe: the failed first edit must not leave the baseline behind.
    seed = store.get("drinks", "daiquiri")
    name = upload(store)
    before = snapshot(tmp_path)
    fail_timeline_write(monkeypatch)
    with pytest.raises(OSError):
        store.update(
            "drinks", "daiquiri", draft_of(seed, servings=2, image=name), "app"
        )
    assert snapshot(tmp_path) == before
    assert not (folder(store, "drinks", "daiquiri") / "versions").exists()
    assert (tmp_path / "uploads" / name).is_file()
    assert not list(tmp_path.rglob(".tmp-*"))


def test_failed_edit_restores_existing_timeline_and_versions(
    store, tmp_path, monkeypatch
):
    created = store.create("drinks", draft(name="Zombie"), "app")
    store.update("drinks", "zombie", draft_of(created, servings=2), "app")
    before = snapshot(tmp_path)
    fail_timeline_write(monkeypatch)
    for call in (
        lambda: store.update("drinks", "zombie", draft_of(created, servings=3), "app"),
        lambda: store.restore("drinks", "zombie", 1, "app"),
        lambda: store.set_marks("drinks", "zombie", ["favourite"], [], "app"),
        lambda: store.add_rating("drinks", "zombie", 4, "app"),
        lambda: store.add_made("drinks", "zombie", 4, "x", "app"),
        lambda: store.add_note("drinks", "zombie", "x", "app"),
    ):
        with pytest.raises(OSError):
            call()
        assert snapshot(tmp_path) == before
    assert not list(tmp_path.rglob(".tmp-*"))


def test_failed_create_removes_the_new_folder(store, tmp_path, monkeypatch):
    name = upload(store)
    before = snapshot(tmp_path)
    fail_timeline_write(monkeypatch)
    with pytest.raises(OSError):
        store.create("drinks", draft(name="Zombie", image=name), "app")
    assert not folder(store, "drinks", "zombie").exists()
    assert snapshot(tmp_path) == before


def test_failed_recipe_write_removes_the_version_file(store, tmp_path, monkeypatch):
    seed = store.get("drinks", "daiquiri")
    before = snapshot(tmp_path)
    real = store_module_write()

    def boom(path, data):
        if Path(path).name == "recipe.json":
            raise OSError("disk full")
        real(path, data)

    monkeypatch.setattr("app.recipes.store.atomic_write", boom)
    with pytest.raises(OSError):
        store.update("drinks", "daiquiri", draft_of(seed, servings=2), "app")
    assert snapshot(tmp_path) == before
    assert not (folder(store, "drinks", "daiquiri") / "versions").exists()


def store_module_write():
    from app.recipes import store as store_module

    return store_module.atomic_write


def test_failed_upload_move_puts_everything_back(store, tmp_path, monkeypatch):
    seed = store.get("drinks", "daiquiri")
    image, photo = upload(store), upload(store, PNG + b"x")
    before = snapshot(tmp_path)
    real = os.replace
    moves = []

    def flaky(src, dst):
        if Path(src).parent.name == "uploads":
            moves.append(src)
            if len(moves) == 2:
                raise OSError("cross-device")
        return real(src, dst)

    monkeypatch.setattr(os, "replace", flaky)
    new = draft_of(seed, image=image, source={"url": None, "photo": photo})
    with pytest.raises(OSError):
        store.update("drinks", "daiquiri", new, "app")
    monkeypatch.undo()
    assert len(moves) == 2
    assert snapshot(tmp_path) == before


def fill_disk_at_timeline(monkeypatch):
    """The timeline write fails, then every write that syncs to disk does too."""
    full = []

    def boom(path, data):
        full.append(True)
        raise OSError(errno.ENOSPC, "No space left on device")

    real_fsync = os.fsync

    def fsync(fd):
        if full:
            raise OSError(errno.ENOSPC, "No space left on device")
        return real_fsync(fd)

    monkeypatch.setattr("app.recipes.timeline.atomic_write", boom)
    monkeypatch.setattr(os, "fsync", fsync)


def test_double_failure_keeps_old_recipe_recoverable(store, tmp_path, monkeypatch):
    # The first edit of a legacy recipe on a full disk: rolling back must not
    # need a single free byte, or the baseline is the only copy left of the old.
    seed = store.get("drinks", "daiquiri")
    old = raw(store, "drinks", "daiquiri")
    before = snapshot(tmp_path)
    fill_disk_at_timeline(monkeypatch)
    with pytest.raises(OSError):
        store.update("drinks", "daiquiri", draft_of(seed, servings=2), "app")
    monkeypatch.undo()
    assert raw(store, "drinks", "daiquiri") == old
    assert not (folder(store, "drinks", "daiquiri") / "versions").exists()
    assert not list(tmp_path.rglob(".tmp-*"))
    assert snapshot(tmp_path) == before


def test_rollback_failure_keeps_baseline_and_raises_incomplete(
    store, tmp_path, monkeypatch
):
    from app.recipes.store import SaveIncomplete

    seed = store.get("drinks", "daiquiri")
    old = raw(store, "drinks", "daiquiri")
    fill_disk_at_timeline(monkeypatch)
    real = os.replace

    def replace(src, dst):
        if str(src).endswith(".bak"):
            raise OSError(errno.EIO, "I/O error")
        return real(src, dst)

    monkeypatch.setattr(os, "replace", replace)
    with pytest.raises(SaveIncomplete) as caught:
        store.update("drinks", "daiquiri", draft_of(seed, servings=2), "app")
    monkeypatch.undo()
    assert isinstance(caught.value, OSError)
    assert caught.value.__cause__.errno == errno.ENOSPC
    where = folder(store, "drinks", "daiquiri")
    assert raw(store, "drinks", "daiquiri", "versions/0001.json") == old
    assert raw(store, "drinks", "daiquiri") != old
    backups = list(where.glob(".tmp-*.bak"))
    assert len(backups) == 1 and backups[0].read_bytes() == old
    assert set(tmp_path.rglob(".tmp-*")) == set(backups)
