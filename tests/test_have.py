from app.recipes.catalog import Catalog
from app.recipes.have import (
    MAX_TERM_LENGTH,
    MAX_TERMS,
    clean_terms,
    match,
    rank,
    word_matches,
)
from app.recipes.model import parse_recipe


def make_recipe(name, rows, slug="recipe"):
    """Rows are an item, or an (item, unit, amount) triple."""
    ingredients = []
    for row in rows:
        item, unit, amount = (row, "g", 100) if isinstance(row, str) else row
        ingredient = {"unit": unit, "item": item}
        if amount is not None:
            ingredient["amount"] = amount
        ingredients.append(ingredient)
    return parse_recipe(
        {
            "format_version": 2,
            "slug": slug,
            "side": "food",
            "name": name,
            "category": "mains",
            "servings": 2,
            "ingredients": ingredients,
        }
    )


def make_catalog(tmp_path, entries=()):
    catalog = Catalog(tmp_path)
    catalog.save_raw(list(entries))
    return catalog


def test_clean_terms():
    assert clean_terms([" Leeks ", "", "leeks", "LEEKS", "chicken"]) == [
        "Leeks",
        "chicken",
    ]
    assert len(clean_terms(["a" * 70])[0]) == MAX_TERM_LENGTH == 60
    assert len(clean_terms([f"term{i}" for i in range(25)])) == MAX_TERMS == 20


def test_word_matches():
    for term, name in [
        ("leeks", "leek"),
        ("potato", "potatoes"),
        ("egg", "eggs"),
        ("eggs", "egg"),
        ("tomatoes", "tomato"),
        ("pea", "peas"),
    ]:
        assert word_matches(term, name), (term, name)
    for term, name in [
        ("pea", "pear"),
        ("rice", "rise"),
        ("pea", "peanuts"),
        ("chicken", "chickpeas"),
    ]:
        assert not word_matches(term, name), (term, name)


def test_covers_by_words(tmp_path):
    catalog = make_catalog(tmp_path)
    recipe = make_recipe("R", ["chicken thighs", "baby potatoes"])
    assert match(recipe, ["chicken"], catalog).matched == ["chicken thighs"]
    assert match(recipe, ["baby potato"], catalog).matched == ["baby potatoes"]
    assert match(recipe, ["chicken stock"], catalog).matched == []


def test_covers_by_catalog(tmp_path):
    catalog = make_catalog(tmp_path, [{"name": "coriander", "aliases": ["cilantro"]}])
    assert match(make_recipe("R", ["cilantro"]), ["coriander"], catalog).matched == [
        "cilantro"
    ]
    assert match(make_recipe("R", ["coriander"]), ["cilantro"], catalog).matched == [
        "coriander"
    ]
    assert (
        match(make_recipe("R", ["fresh parsley"]), ["cilantro"], catalog).matched == []
    )
    assert (
        match(make_recipe("R", ["cilantro"]), ["coriander leaves"], catalog).matched
        == []
    )


def assumed_recipe(water_item="water"):
    return make_recipe(
        "R",
        [
            ("salt", "to taste", None),
            (water_item, "ml", 600),
            "leeks",
        ],
    )


def test_assumed_rows(tmp_path):
    catalog = make_catalog(tmp_path)
    result = match(assumed_recipe(), ["leeks"], catalog)
    assert result.matched == ["leeks"]
    assert result.missing == []

    # "tap water" is only assumed when the catalog says it is water.
    assert match(assumed_recipe("tap water"), ["leeks"], catalog).missing == [
        "tap water"
    ]
    with_alias = make_catalog(
        tmp_path / "other", [{"name": "water", "aliases": ["tap water"]}]
    )
    assert match(assumed_recipe("tap water"), ["leeks"], with_alias).missing == []


def test_assumed_row_can_match(tmp_path):
    catalog = make_catalog(tmp_path)
    result = match(assumed_recipe(), ["salt"], catalog)
    assert "salt" in result.matched
    assert result.terms_matched == 1


def test_duplicates_count_once(tmp_path):
    catalog = make_catalog(tmp_path, [{"name": "ground cumin", "aliases": ["cumin"]}])
    recipe = make_recipe(
        "R",
        ["leeks", "onion", "Leeks ", "ground cumin", "cumin"],
    )
    result = match(recipe, ["onion"], catalog)
    assert result.matched == ["onion"]
    assert result.missing == ["leeks", "ground cumin"]


def test_rank_order(tmp_path):
    catalog = make_catalog(tmp_path)
    a = make_recipe("A", ["chicken", "rice"], slug="a")
    b = make_recipe("B", ["chicken", "leeks", "rice"], slug="b")
    c = make_recipe("C", ["leeks", "a", "b", "c", "d"], slug="c")
    d = make_recipe("D", ["rice", "carrots"], slug="d")
    ranked = rank([d, c, a, b], ["chicken", "leeks"], catalog)
    assert [r.slug for r, _ in ranked] == ["b", "a", "c"]
    assert ranked[0][1].terms_matched == 2
    assert ranked[0][1].json() == {"matched": ["chicken", "leeks"], "missing": ["rice"]}


def test_rank_ties_sort_by_name_case_insensitively(tmp_path):
    catalog = make_catalog(tmp_path)
    lower = make_recipe("apple pie", ["leeks", "rice"], slug="lower")
    upper = make_recipe("Banana pie", ["leeks", "rice"], slug="upper")
    ranked = rank([upper, lower], ["leeks"], catalog)
    assert [r.slug for r, _ in ranked] == ["lower", "upper"]


def test_unreadable_catalog_still_matches_words(tmp_path):
    catalog = Catalog(tmp_path)
    catalog.path.parent.mkdir(parents=True)
    catalog.path.write_text("not json")
    result = match(make_recipe("R", ["leek"]), ["leeks"], catalog)
    assert result.matched == ["leek"]
