"""Cook with what you have: which ingredient rows the typed terms cover.

A term is a short phrase like "chicken" or "baby potato". It covers an ingredient
row when it names the same catalog entry as the row, or when every one of its
words matches a word of the row's names (the row's item, plus its catalog entry's
name and aliases). Salt to taste and water are assumed to be in the kitchen, so
they are never missing. Recipes that use at least one term are ranked by how few
rows are missing, then by how many terms they use.
"""

from dataclasses import dataclass

from rapidfuzz import fuzz

from app.recipes.catalog import Catalog, CatalogEntry, name_key
from app.recipes.model import Ingredient, Recipe
from app.recipes.search import words

MAX_TERMS = 20
MAX_TERM_LENGTH = 60
MIN_FUZZY_LENGTH = 5
MIN_RATIO = 80


def clean_terms(raw: list[str]) -> list[str]:
    """Stripped, cut, non-blank terms; one per catalog key, first spelling kept."""
    terms: list[str] = []
    seen: set[str] = set()
    for text in raw:
        term = text.strip()[:MAX_TERM_LENGTH].strip()
        key = name_key(term)
        if not key or key in seen:
            continue
        seen.add(key)
        terms.append(term)
        if len(terms) == MAX_TERMS:
            break
    return terms


def word_matches(term_word: str, name_word: str) -> bool:
    """Whether a term word hits a name word.

    Long words forgive a typo or a plural. Short ones only differ by an `s` or
    `es`, because the fuzzy ratio is too forgiving for "pea" vs "pear" and "rice"
    vs "rise". There is no prefix rule: "pea" must not cover "peanuts".
    """
    if term_word == name_word:
        return True
    if len(term_word) >= MIN_FUZZY_LENGTH:
        return fuzz.ratio(term_word, name_word) >= MIN_RATIO
    return any(
        a == b + suffix
        for a, b in ((term_word, name_word), (name_word, term_word))
        for suffix in ("s", "es")
    )


@dataclass
class HaveMatch:
    matched: list[str]
    missing: list[str]
    terms_matched: int

    def json(self) -> dict[str, list[str]]:
        return {"matched": self.matched, "missing": self.missing}


def _names(item: str, entry: CatalogEntry | None) -> list[str]:
    if entry is None:
        return words(item)
    return words(" ".join([item, entry.name, *entry.aliases]))


def _is_assumed(row: Ingredient, entry: CatalogEntry | None) -> bool:
    return (
        row.unit == "to taste"
        or name_key(row.item) == "water"
        or (entry is not None and name_key(entry.name) == "water")
    )


def match(recipe: Recipe, terms: list[str], catalog: Catalog) -> HaveMatch:
    """Which rows the terms cover and which are missing; terms are cleaned."""
    term_entries = [(words(term), catalog.entry(term)) for term in terms]
    # One group per distinct ingredient, in recipe order, named by its first row.
    groups: dict[str, dict] = {}
    covered_terms: set[int] = set()
    for row in recipe.ingredients:
        entry = catalog.entry(row.item)
        key = name_key(entry.name) if entry else name_key(row.item)
        group = groups.setdefault(
            key, {"item": row.item, "covered": False, "assumed": False}
        )
        group["assumed"] = group["assumed"] or _is_assumed(row, entry)
        row_words = _names(row.item, entry)
        for index, (term_words, term_entry) in enumerate(term_entries):
            same_entry = entry is not None and term_entry is entry
            if same_entry or (
                term_words
                and all(any(word_matches(t, w) for w in row_words) for t in term_words)
            ):
                covered_terms.add(index)
                group["covered"] = True
    matched = [g["item"] for g in groups.values() if g["covered"]]
    missing = [
        g["item"] for g in groups.values() if not g["covered"] and not g["assumed"]
    ]
    return HaveMatch(matched, missing, len(covered_terms))


def rank(
    recipes: list[Recipe], terms: list[str], catalog: Catalog
) -> list[tuple[Recipe, HaveMatch]]:
    """Recipes that use at least one term: fewest missing, most terms, then name."""
    kept = []
    for recipe in recipes:
        result = match(recipe, terms, catalog)
        if result.matched:
            kept.append((recipe, result))
    kept.sort(
        key=lambda pair: (
            len(pair[1].missing),
            -pair[1].terms_matched,
            pair[0].name.casefold(),
        )
    )
    return kept
