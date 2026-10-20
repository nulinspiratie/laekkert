import json

import pytest

from app.recipes.catalog import Catalog
from app.recipes.drafts import RecipeDraft, slugify, to_recipe
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
    assert recipe.steps == ["Simmer"]
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
        ({"servings": 0}, "food", "Servings must be at least 1"),
        ({"time_minutes": -5}, "food", "Cooking time can't be negative"),
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
