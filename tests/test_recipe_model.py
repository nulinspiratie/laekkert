import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.recipes import model
from app.recipes.model import NewerFormatError, parse_recipe


def valid(**overrides) -> dict:
    data = {
        "format_version": 2,
        "slug": "daiquiri",
        "side": "drinks",
        "name": "Daiquiri",
        "category": "cocktails",
        "servings": 1,
        "ingredients": [{"amount": 50, "unit": "ml", "item": "white rum"}],
    }
    data.update(overrides)
    return data


def test_valid_recipe_parses():
    r = parse_recipe(valid())
    assert r.side == "drinks" and r.ingredients[0].unit == "ml"


def test_category_must_belong_to_side():
    with pytest.raises(ValidationError):
        parse_recipe(valid(category="mains"))


def test_cups_are_rejected():
    with pytest.raises(ValidationError):
        parse_recipe(valid(ingredients=[{"amount": 1, "unit": "cup", "item": "rum"}]))


@pytest.mark.parametrize("unit", ["g", "ml", "piece", "dash"])
def test_measured_units_need_amount_or_original(unit):
    with pytest.raises(ValidationError):
        parse_recipe(valid(ingredients=[{"unit": unit, "item": "x"}]))
    r = parse_recipe(
        valid(ingredients=[{"unit": unit, "item": "x", "original": "1 tsp"}])
    )
    assert r.ingredients[0].amount is None


@pytest.mark.parametrize("unit", ["pinch", "to taste"])
def test_unmeasured_units_need_no_amount(unit):
    assert parse_recipe(valid(ingredients=[{"unit": unit, "item": "salt"}]))


def test_amount_must_be_positive():
    with pytest.raises(ValidationError):
        parse_recipe(valid(ingredients=[{"amount": 0, "unit": "ml", "item": "rum"}]))


@pytest.mark.parametrize("slug", ["../x", "Daiquiri", "a--b", ""])
def test_bad_slug_rejected(slug):
    with pytest.raises(ValidationError):
        parse_recipe(valid(slug=slug))


def test_unknown_key_rejected():
    with pytest.raises(ValidationError):
        parse_recipe(valid(colour="red"))


def test_current_format_is_3():
    assert model.FORMAT_VERSION == 3


def test_newer_format_raises():
    with pytest.raises(NewerFormatError):
        parse_recipe(valid(format_version=4))


def test_missing_format_version_raises():
    data = valid()
    del data["format_version"]
    with pytest.raises(ValueError):
        parse_recipe(data)


def test_migrations_run_in_order(monkeypatch):
    calls = []

    def step(version):
        def migrate(data):
            calls.append(version)
            return {**data, "format_version": version + 1}

        return migrate

    monkeypatch.setattr(model, "FORMAT_VERSION", 4)
    monkeypatch.setattr(model, "MIGRATIONS", {2: step(2), 3: step(3)})
    assert parse_recipe(valid()).format_version == 4
    assert calls == [2, 3]


def test_v1_kid_marks_become_tags():
    r = parse_recipe(
        valid(
            format_version=1,
            marks=["tried", "kid_approved", "kid_rejected"],
            tags=["quick"],
        )
    )
    assert r.format_version == 3
    assert r.marks == ["tried"]
    assert r.tags == ["quick", "kid approved", "kids rejected"]


def test_v1_without_kid_marks_keeps_everything_else():
    r = parse_recipe(
        valid(format_version=1, marks=["tried", "favourite"], tags=["quick"])
    )
    assert r.format_version == 3
    assert r.marks == ["tried", "favourite"]
    assert r.tags == ["quick"]
    assert r.name == "Daiquiri"


def test_v1_kid_tag_not_duplicated():
    r = parse_recipe(
        valid(format_version=1, marks=["kid_approved"], tags=["kid approved"])
    )
    assert r.marks == []
    assert r.tags == ["kid approved"]


def test_v1_migration_does_not_mutate_its_input():
    data = valid(format_version=1, marks=["kid_approved"], tags=[])
    parse_recipe(data)
    assert data["format_version"] == 1
    assert data["marks"] == ["kid_approved"] and data["tags"] == []


@pytest.mark.parametrize("mark", ["kid_approved", "kid_rejected"])
def test_v2_rejects_kid_marks(mark):
    with pytest.raises(ValidationError):
        parse_recipe(valid(marks=[mark]))


def test_summary_keys():
    assert set(parse_recipe(valid()).summary()) == {
        "slug",
        "name",
        "side",
        "category",
        "time_minutes",
        "tags",
        "marks",
        "image",
    }


def test_v2_string_steps_migrate():
    r = parse_recipe(valid(steps=["Shake.", "Strain."]))
    assert r.format_version == 3
    assert [s.text for s in r.steps] == ["Shake.", "Strain."]
    assert all(s.group == "" for s in r.steps)
    assert r.notes == ""
    assert r.ingredients[0].group == ""


def test_v1_file_migrates_to_3():
    r = parse_recipe(
        valid(
            format_version=1,
            marks=["kid_approved"],
            steps=["Shake.", "Strain."],
        )
    )
    assert r.format_version == 3
    assert r.marks == []
    assert r.tags == ["kid approved"]
    assert [(s.text, s.group) for s in r.steps] == [("Shake.", ""), ("Strain.", "")]


def test_v3_groups_and_notes_parse():
    r = parse_recipe(
        valid(
            format_version=3,
            ingredients=[
                {"amount": 50, "unit": "ml", "item": "white rum", "group": "Sauce"}
            ],
            steps=[{"text": "Stir.", "group": "Day before"}],
            notes="Keeps 3 days.",
        )
    )
    assert r.ingredients[0].group == "Sauce"
    assert (r.steps[0].text, r.steps[0].group) == ("Stir.", "Day before")
    assert r.notes == "Keeps 3 days."


def test_bad_steps_shape_is_refused():
    with pytest.raises(ValidationError):
        parse_recipe(valid(steps=[1]))


def test_group_and_notes_limits():
    ingredient = {"unit": "pinch", "item": "salt"}
    with pytest.raises(ValidationError):
        parse_recipe(
            valid(format_version=3, ingredients=[{**ingredient, "group": "x" * 61}])
        )
    with pytest.raises(ValidationError):
        parse_recipe(
            valid(format_version=3, steps=[{"text": "Stir.", "group": "x" * 61}])
        )
    with pytest.raises(ValidationError):
        parse_recipe(valid(format_version=3, notes="x" * 5001))
    r = parse_recipe(
        valid(
            format_version=3,
            ingredients=[{**ingredient, "group": "x" * 60}],
            steps=[{"text": "Stir.", "group": "x" * 60}],
            notes="x" * 5000,
        )
    )
    assert len(r.notes) == 5000


def test_seed_recipes_are_format_3():
    seed = Path(model.__file__).parent.parent / "seed" / "recipes"
    files = sorted(seed.glob("*/*/recipe.json"))
    assert len(files) == 4
    for path in files:
        data = json.loads(path.read_text())
        assert data["format_version"] == 3
        assert all(isinstance(s, dict) for s in data["steps"])
        assert parse_recipe(data).slug == data["slug"]
