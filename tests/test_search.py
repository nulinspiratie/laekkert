import pytest

from app.recipes.model import parse_recipe
from app.recipes.search import search


def make_recipe(name, items, tags=(), category="mains", slug="recipe"):
    return parse_recipe(
        {
            "format_version": 1,
            "slug": slug,
            "side": "food",
            "name": name,
            "category": category,
            "servings": 2,
            "tags": list(tags),
            "ingredients": [{"amount": 100, "unit": "g", "item": i} for i in items],
        }
    )


def names(recipes):
    return [r.name for r in recipes]


def test_word_order_and_filler_words():
    curry = make_recipe("Curry with chicken", ["chicken thighs", "curry paste"])
    other = make_recipe("Red lentil dal", ["red lentils"])
    assert search([other, curry], "chicken curry") == [curry]


def test_typo():
    traybake = make_recipe("Chicken and leek traybake", ["chicken thighs", "leeks"])
    other = make_recipe("Red lentil dal", ["red lentils"])
    assert search([other, traybake], "chiken") == [traybake]


def test_ingredient_match():
    soup = make_recipe("Green soup", ["leeks", "stock"])
    other = make_recipe("Red lentil dal", ["red lentils"])
    assert search([other, soup], "leek") == [soup]


def test_prefix_while_typing():
    daiquiri = make_recipe("Daiquiri", ["white rum"])
    dal = make_recipe("Red lentil dal", ["red lentils"])
    assert search([dal, daiquiri], "dai") == [daiquiri]
    assert search([dal, daiquiri], "d") == []


def test_accents_and_case():
    brulee = make_recipe("Crème brûlée", ["cream", "egg yolks"])
    other = make_recipe("Red lentil dal", ["red lentils"])
    assert search([other, brulee], "CREME brulee") == [brulee]


def test_every_word_must_match():
    traybake = make_recipe("Chicken and leek traybake", ["chicken thighs", "leeks"])
    assert search([traybake], "chicken pizza") == []


def test_name_hits_rank_first():
    daiquiri = make_recipe("Daiquiri", ["white rum", "lime juice"])
    pickle = make_recipe("Lime pickle", ["limes", "chilli"])
    assert names(search([daiquiri, pickle], "lime")) == ["Lime pickle", "Daiquiri"]


def test_better_score_ranks_before_name_order():
    exact = make_recipe("Zesty chicken", ["chicken"])
    typo = make_recipe("Apple chiken", ["apples"])
    assert names(search([typo, exact], "chicken")) == ["Zesty chicken", "Apple chiken"]


def test_ties_break_on_name():
    b = make_recipe("Beta soup", ["stock"])
    a = make_recipe("alpha soup", ["stock"])
    assert names(search([b, a], "soup")) == ["alpha soup", "Beta soup"]


def test_tags_and_category_are_searched():
    dal = make_recipe("Red lentil dal", ["red lentils"], tags=["vegetarian"])
    sweet = make_recipe("Pudding", ["milk"], category="desserts")
    assert search([dal, sweet], "vegetarian") == [dal]
    assert search([dal, sweet], "desserts") == [sweet]


@pytest.mark.parametrize("query", ["", "   ", "!!"])
def test_blank_query_returns_input_unchanged(query):
    recipes = [make_recipe("B", ["x"]), make_recipe("A", ["y"])]
    assert search(recipes, query) == recipes
