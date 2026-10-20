from app.recipes.diff import describe_changes
from app.recipes.model import FORMAT_VERSION, Recipe
from app.recipes.timeline import Change


def make(**overrides) -> Recipe:
    data = {
        "format_version": FORMAT_VERSION,
        "slug": "sour",
        "side": "drinks",
        "name": "Sour",
        "category": "cocktails",
        "servings": 1,
        "time_minutes": 5,
        "ingredients": [
            {"amount": 25, "unit": "ml", "item": "lime juice"},
            {"amount": 60, "unit": "ml", "item": "gin"},
        ],
        "steps": ["Shake", "Strain", "Garnish"],
        "tags": [],
        "marks": [],
    }
    return Recipe.model_validate({**data, **overrides})


def ing(item, amount=25, unit="ml", **extra):
    return {"amount": amount, "unit": unit, "item": item, **extra}


def changes(old: Recipe, new: Recipe) -> list[tuple[str, str, str]]:
    return [(c.section, c.kind, c.text) for c in describe_changes(old, new)]


def test_no_change_is_empty():
    assert describe_changes(make(), make()) == []


def test_marks_are_ignored():
    new = make(marks=["tried", "favourite"], slug="other")
    assert describe_changes(make(), new) == []


def test_name_change():
    assert changes(make(name="Dal"), make(name="Red lentil dal")) == [
        ("details", "changed", "name “Dal” → “Red lentil dal”")
    ]


def test_category_change():
    old = make(side="food", category="mains")
    new = make(side="food", category="sides")
    assert changes(old, new) == [("details", "changed", "category mains → sides")]


def test_servings_change():
    assert changes(make(servings=4), make(servings=6)) == [
        ("details", "changed", "servings 4 → 6")
    ]


def test_time_change():
    assert changes(make(time_minutes=20), make(time_minutes=25)) == [
        ("details", "changed", "time 20 → 25 min")
    ]


def test_time_removed_and_added():
    assert changes(make(time_minutes=20), make(time_minutes=None)) == [
        ("details", "changed", "time 20 min → no time")
    ]
    assert changes(make(time_minutes=None), make(time_minutes=20)) == [
        ("details", "changed", "time no time → 20 min")
    ]


def test_amount_change_same_unit():
    new = make(ingredients=[ing("lime juice", 20), ing("gin", 60)])
    assert describe_changes(make(), new) == [
        Change(section="ingredients", kind="changed", text="lime juice 25 → 20 ml")
    ]


def test_amount_change_matches_item_case_insensitively():
    old = make(ingredients=[ing(" lime juice", 25)])
    new = make(ingredients=[ing("lime juice ", 20)])
    assert changes(old, new) == [("ingredients", "changed", "lime juice 25 → 20 ml")]


def test_renaming_only_the_case_of_an_item_is_still_a_change():
    old = make(ingredients=[ing("Lime juice")])
    new = make(ingredients=[ing("lime juice")])
    assert changes(old, new) == [
        ("ingredients", "changed", "ingredient “Lime juice” → “lime juice”")
    ]


def test_unit_change_shows_both_units():
    old = make(
        ingredients=[
            {"unit": "ml", "item": "chili flakes", "amount": None, "original": "1 tsp"}
        ]
    )
    new = make(ingredients=[ing("chili flakes", 2.5)])
    assert changes(old, new) == [
        ("ingredients", "changed", "chili flakes 1 tsp → 2.5 ml")
    ]
    grams = make(ingredients=[ing("chili flakes", 3, "g")])
    assert changes(new, grams) == [
        ("ingredients", "changed", "chili flakes 2.5 ml → 3 g")
    ]


def test_note_change():
    old = make(ingredients=[ing("lime juice")])
    new = make(ingredients=[ing("lime juice", note="fresh")])
    assert changes(old, new) == [
        ("ingredients", "changed", "lime juice: note “” → “fresh”")
    ]


def test_no_scale_change():
    old = make(ingredients=[ing("lemon", 1, "piece")])
    new = make(ingredients=[ing("lemon", 1, "piece", no_scale=True)])
    assert changes(old, new) == [("ingredients", "changed", "lemon: don't scale on")]
    assert changes(new, old) == [("ingredients", "changed", "lemon: don't scale off")]


def test_ingredient_added_and_removed():
    base = [ing("gin", 60)]
    with_lime = [ing("lime juice", 20, note="fresh"), *base]
    added = changes(make(ingredients=base), make(ingredients=with_lime))
    assert added == [("ingredients", "added", "20 ml lime juice (fresh)")]
    removed = changes(make(ingredients=with_lime), make(ingredients=base))
    assert removed == [("ingredients", "removed", "20 ml lime juice (fresh)")]


def test_to_taste_ingredient_added():
    salt = {"unit": "to taste", "item": "salt"}
    new = make(ingredients=[ing("gin", 60), salt])
    assert changes(make(ingredients=[ing("gin", 60)]), new) == [
        ("ingredients", "added", "salt, to taste")
    ]


def test_ingredients_reordered():
    old = make(ingredients=[ing("lime juice"), ing("gin", 60)])
    new = make(ingredients=[ing("gin", 60), ing("lime juice")])
    assert changes(old, new) == [("ingredients", "changed", "ingredients reordered")]


def test_reorder_can_come_with_other_changes():
    old = make(ingredients=[ing("lime juice"), ing("gin", 60)])
    new = make(ingredients=[ing("gin", 50), ing("lime juice")])
    assert changes(old, new) == [
        ("ingredients", "changed", "gin 60 → 50 ml"),
        ("ingredients", "changed", "ingredients reordered"),
    ]


def test_adding_an_ingredient_in_the_middle_is_not_a_reorder():
    old = make(ingredients=[ing("lime juice"), ing("gin", 60)])
    new = make(ingredients=[ing("lime juice"), ing("syrup", 10), ing("gin", 60)])
    assert changes(old, new) == [("ingredients", "added", "10 ml syrup")]


def test_repeated_items_pair_in_order():
    old = make(ingredients=[ing("sugar", 5, "g"), ing("sugar", 10, "g")])
    new = make(ingredients=[ing("sugar", 5, "g"), ing("sugar", 12, "g")])
    assert changes(old, new) == [("ingredients", "changed", "sugar 10 → 12 g")]


def test_step_added_changed_removed():
    old = make(steps=["Shake", "Strain", "Garnish"])
    added = make(steps=["Shake", "Strain", "Garnish", "Serve"])
    assert changes(old, added) == [("method", "added", "step 4: Serve")]
    changed = make(steps=["Shake", "Double strain", "Garnish"])
    assert changes(old, changed) == [("method", "changed", "step 2: Double strain")]
    removed = make(steps=["Shake", "Garnish"])
    assert changes(old, removed) == [("method", "removed", "step 2: Strain")]


def test_removed_step_uses_the_old_number():
    old = make(steps=["a", "b", "c"])
    assert changes(old, make(steps=["a", "b"])) == [("method", "removed", "step 3: c")]


def test_long_step_is_cut():
    new = make(steps=["Shake", "Strain", "x" * 200])
    [(_, kind, text)] = changes(make(steps=["Shake", "Strain"]), new)
    assert kind == "added"
    assert text == "step 3: " + "x" * 80 + "…"


def test_source_link_changes():
    with_link = make(source={"url": "https://a.example"})
    other = make(source={"url": "https://b.example"})
    assert changes(make(), with_link) == [("source", "added", "link added")]
    assert changes(with_link, make()) == [("source", "removed", "link removed")]
    assert changes(with_link, other) == [("source", "changed", "link changed")]


def test_source_photo_changes():
    with_photo = make(source={"photo": "source/a.jpg"})
    other = make(source={"photo": "source/b.jpg"})
    assert changes(make(), with_photo) == [("source", "added", "source photo added")]
    assert changes(with_photo, make()) == [
        ("source", "removed", "source photo removed")
    ]
    assert changes(with_photo, other) == [
        ("source", "changed", "source photo replaced")
    ]


def test_tags_added_and_removed():
    old = make(tags=["quick", "batch cook"])
    new = make(tags=["quick", "party"])
    assert changes(old, new) == [
        ("tags", "added", "“party”"),
        ("tags", "removed", "“batch cook”"),
    ]


def test_photo_changes():
    with_photo = make(image="photo/a.jpg")
    other = make(image="photo/b.jpg")
    assert changes(make(), with_photo) == [("photo", "changed", "photo added")]
    assert changes(with_photo, other) == [("photo", "changed", "photo replaced")]
    assert changes(with_photo, make()) == [("photo", "changed", "photo removed")]


def test_changes_come_in_section_order():
    old = make()
    new = make(
        name="Gin sour",
        ingredients=[ing("lime juice", 20), ing("gin", 60)],
        steps=["Shake"],
        source={"url": "https://a.example"},
        tags=["quick"],
        image="photo/a.jpg",
    )
    sections = [c.section for c in describe_changes(old, new)]
    assert sections == [
        "details",
        "ingredients",
        "method",
        "method",
        "source",
        "tags",
        "photo",
    ]
