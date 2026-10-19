import pytest
from pydantic import ValidationError

from app.recipes import model
from app.recipes.model import NewerFormatError, parse_recipe


def valid(**overrides) -> dict:
    data = {
        "format_version": 1,
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


def test_newer_format_raises():
    with pytest.raises(NewerFormatError):
        parse_recipe(valid(format_version=2))


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

    monkeypatch.setattr(model, "FORMAT_VERSION", 3)
    monkeypatch.setattr(model, "MIGRATIONS", {1: step(1), 2: step(2)})
    assert parse_recipe(valid()).format_version == 3
    assert calls == [1, 2]


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
