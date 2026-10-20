import json

import pytest

from app.recipes.catalog import Catalog
from app.recipes.drafts import RecipeDraft, parse_draft, slugify, to_recipe
from app.recipes.model import FORMAT_VERSION


@pytest.fixture
def catalog(tmp_path):
    catalog = Catalog(tmp_path)
    catalog.path.parent.mkdir(parents=True)
    catalog.path.write_text(
        json.dumps(
            {
                "format_version": 1,
                "ingredients": [
                    {"name": "smoked paprika", "g_per_tsp": 2.3},
                    {"name": "honey", "g_per_tsp": 7},
                ],
            }
        )
    )
    return catalog


GOOD = {
    "name": "Dal",
    "category": "mains",
    "servings": 4,
    "time_minutes": None,
    "ingredients": [{"amount": 200, "unit": "g", "item": "red lentils"}],
    "steps": ["Simmer"],
    "source": None,
    "tags": [],
    "image": None,
}


def draft(**overrides) -> RecipeDraft:
    data = {
        "name": "Dal",
        "category": "mains",
        "servings": 4,
        "time_minutes": None,
        "ingredients": [{"amount": 200, "unit": "g", "item": "red lentils"}],
        "steps": ["Simmer"],
        "source": None,
        "tags": [],
        "image": None,
    }
    return RecipeDraft.model_validate({**data, **overrides})


def convert(draft, catalog, *, side="food", slug="dal", marks=()):
    return to_recipe(draft, side=side, slug=slug, marks=list(marks), catalog=catalog)


def row(item, amount=None, unit="g", **extra):
    return {"item": item, "amount": amount, "unit": unit, **extra}


def test_to_recipe_fills_in_what_the_caller_gives(catalog):
    recipe = convert(draft(), catalog, marks=["tried"])
    assert recipe.format_version == FORMAT_VERSION
    assert (recipe.side, recipe.slug, recipe.marks) == ("food", "dal", ["tried"])
    assert recipe.source is None


def test_tsp_with_catalog_density_becomes_grams(catalog):
    recipe = convert(draft(ingredients=[row("smoked paprika", 2, "tsp")]), catalog)
    [paprika] = recipe.ingredients
    assert (paprika.amount, paprika.unit) == (4.6, "g")


def test_tsp_without_density_becomes_ml(catalog):
    recipe = convert(draft(ingredients=[row("chili flakes", 0.5, "tsp")]), catalog)
    [chili] = recipe.ingredients
    assert (chili.amount, chili.unit) == (2.5, "ml")


def test_tbsp_is_three_tsp(catalog):
    recipe = convert(draft(ingredients=[row("honey", 1, "tbsp")]), catalog)
    [honey] = recipe.ingredients
    assert (honey.amount, honey.unit) == (21, "g")
    recipe = convert(draft(ingredients=[row("olive oil", 1, "tbsp")]), catalog)
    assert (recipe.ingredients[0].amount, recipe.ingredients[0].unit) == (15, "ml")


def test_converted_grams_round_to_whole_numbers_from_ten(catalog):
    recipe = convert(draft(ingredients=[row("honey", 2.5, "tsp")]), catalog)
    assert recipe.ingredients[0].amount == 18  # 17.5 g


@pytest.mark.parametrize(
    ("amount", "unit", "expected"),
    [(0.1, "tbsp", 1.5), (0.7, "tbsp", 10.5), (0.3, "tsp", 1.5)],
)
def test_ml_conversion_is_exact(catalog, amount, unit, expected):
    recipe = convert(draft(ingredients=[row("olive oil", amount, unit)]), catalog)
    assert (recipe.ingredients[0].amount, recipe.ingredients[0].unit) == (
        expected,
        "ml",
    )


def test_whole_grams_round_half_up(tmp_path):
    catalog = Catalog(tmp_path)
    catalog.path.parent.mkdir(parents=True)
    catalog.path.write_text(
        json.dumps(
            {"format_version": 1, "ingredients": [{"name": "flour", "g_per_tsp": 5}]}
        )
    )
    recipe = convert(draft(ingredients=[row("flour", 2.5, "tsp")]), catalog)
    assert recipe.ingredients[0].amount == 13  # 12.5 g, not banker's 12


def test_blank_rows_and_steps_are_dropped(catalog):
    recipe = convert(
        draft(
            ingredients=[
                row("  red lentils ", 200),
                row("", None, "g", note="  "),
                row(" ", None, "ml"),
            ],
            steps=["  Simmer ", "", "   "],
            name="  Dal ",
        ),
        catalog,
    )
    assert [i.item for i in recipe.ingredients] == ["red lentils"]
    assert [s.text for s in recipe.steps] == ["Simmer"]
    assert recipe.name == "Dal"


def test_text_fields_are_stripped(catalog):
    recipe = convert(
        draft(
            ingredients=[
                {"item": " lemon ", "amount": 1, "unit": "piece", "note": " zest "},
                {"item": "x", "unit": "ml", "amount": None, "original": " 1 cup "},
            ]
        ),
        catalog,
    )
    assert recipe.ingredients[0].note == "zest"
    assert recipe.ingredients[1].original == "1 cup"


def test_tags_are_normalised(catalog):
    recipe = convert(draft(tags=[" Batch  Cook", "batch cook", ""]), catalog)
    assert recipe.tags == ["batch cook"]


@pytest.mark.parametrize(
    ("overrides", "side", "message"),
    [
        ({"name": "  "}, "food", "Give the recipe a name"),
        ({"ingredients": []}, "food", "Add at least one ingredient"),
        ({"ingredients": [row("")]}, "food", "Add at least one ingredient"),
        (
            {"ingredients": [row("salt", 1), row("", 5)]},
            "food",
            "Ingredient 2 needs a name",
        ),
        (
            {"ingredients": [row("salt", 1), row("flour", None, "g")]},
            "food",
            "Ingredient 2 needs an amount in g",
        ),
        (
            {"ingredients": [row("salt", 1), row("flour", -3)]},
            "food",
            "Ingredient 2 needs an amount above 0",
        ),
        (
            {"ingredients": [row("a", 1), row("b", 1), row("honey", None, "tsp")]},
            "food",
            "Ingredient 3 needs an amount in tsp",
        ),
        (
            {"ingredients": [row("honey", None, "tbsp")]},
            "food",
            "Ingredient 1 needs an amount in tbsp",
        ),
        (
            {"category": "mains"},
            "drinks",
            "Category for drinks must be one of cocktails, mocktails, syrups, prep",
        ),
    ],
)
def test_error_sentences(catalog, overrides, side, message):
    with pytest.raises(ValueError) as caught:
        convert(draft(**overrides), catalog, side=side)
    assert str(caught.value) == message


def test_ingredient_numbers_count_blank_rows(catalog):
    rows = [row("salt", 1), row(""), row("flour", None, "g")]
    with pytest.raises(ValueError, match="^Ingredient 3 needs an amount in g$"):
        convert(draft(ingredients=rows), catalog)


def test_source_url_must_be_http(catalog):
    with pytest.raises(ValueError) as caught:
        convert(draft(source={"url": "ftp://example.com"}), catalog)
    assert str(caught.value) == "The source link must start with http:// or https://"
    recipe = convert(draft(source={"url": " https://example.com/dal "}), catalog)
    assert recipe.source is not None
    assert recipe.source.url == "https://example.com/dal"


def test_empty_source_becomes_none(catalog):
    assert convert(draft(source={"url": " ", "photo": None}), catalog).source is None
    recipe = convert(draft(source={"photo": "source/a.jpg"}), catalog)
    assert recipe.source is not None
    assert recipe.source.photo == "source/a.jpg"


def test_slugify():
    assert slugify("Crème brûlée") == "creme-brulee"
    assert slugify("Rødgrød med fløde") == "rodgrod-med-flode"
    assert slugify("🍸") == "recipe"
    assert slugify("Straße Łódź Đ Œuf Æble") == "strasse-lodz-d-oeuf-aeble"
    assert slugify("  Dal -- tadka! ") == "dal-tadka"
    long = slugify("word " * 30)
    assert len(long) <= 60
    assert not long.endswith("-")
    assert slugify("a" * 100) == "a" * 60


def test_parse_draft_accepts_the_largest_allowed_values():
    parsed = parse_draft(
        {
            **GOOD,
            "servings": 1000,
            "time_minutes": 10080,
            "ingredients": [row("a", 100000)],
        }
    )
    assert parsed.servings == 1000 and parsed.time_minutes == 10080


def test_parse_draft_accepts_a_good_body(catalog):
    parsed = parse_draft(GOOD)
    assert convert(parsed, catalog).name == "Dal"


@pytest.mark.parametrize(
    ("body", "message"),
    [
        ({**GOOD, "servings": None}, "Servings must be at least 1"),
        ({**GOOD, "servings": 0}, "Servings must be at least 1"),
        ({**GOOD, "servings": "lots"}, "Servings must be at least 1"),
        (
            {**GOOD, "time_minutes": "soon"},
            "Cooking time must be a whole number of minutes",
        ),
        ({**GOOD, "time_minutes": -1}, "Cooking time can't be negative"),
        ({**GOOD, "time_minutes": 10081}, "Cooking time can be at most a week"),
        ({**GOOD, "time_minutes": 10**400}, "Cooking time can be at most a week"),
        ({**GOOD, "servings": 1001}, "Servings can be at most 1000"),
        ({**GOOD, "servings": 10**400}, "Servings can be at most 1000"),
        (
            {**GOOD, "ingredients": [row("a", 1), row("b", 100000.5)]},
            "Ingredient 2's amount is too large",
        ),
        (
            {**GOOD, "ingredients": [row("a", 1e308, "tbsp")]},
            "Ingredient 1's amount is too large",
        ),
        (
            {**GOOD, "ingredients": [row("a", 1), row("b", 1, "cup")]},
            "Ingredient 2 has an unknown unit",
        ),
        (
            {**GOOD, "ingredients": [row("a", 1), row("b", "lots")]},
            "Ingredient 2 needs a number for the amount",
        ),
        (
            {**GOOD, "ingredients": [row("a", float("inf"))]},
            "Ingredient 1 needs a number for the amount",
        ),
        (
            {**GOOD, "ingredients": [row("a", float("nan"))]},
            "Ingredient 1 needs a number for the amount",
        ),
        (
            {**GOOD, "ingredients": [row("a", 1, colour="red")]},
            "Ingredient 1 has an unknown field: colour",
        ),
        ({**GOOD, "colour": "red"}, "The recipe has an unknown field: colour"),
        ({**GOOD, "name": None}, "Give the recipe a name"),
        ({**GOOD, "ingredients": "salt"}, "The recipe isn't valid"),
        ({**GOOD, "steps": [1, 2]}, "The recipe isn't valid"),
        ({"name": "Dal"}, "The recipe isn't valid"),
        (["not", "an", "object"], "The recipe isn't valid"),
        (None, "The recipe isn't valid"),
    ],
)
def test_parse_draft_error_sentences(body, message):
    with pytest.raises(ValueError) as caught:
        parse_draft(body)
    assert type(caught.value) is ValueError
    assert str(caught.value) == message
    assert caught.value.__cause__ is None
