"""Fuzzy recipe search.

A recipe's words are its name, ingredient items, tags and category. Every query
word has to match one of them, so "chicken curry" finds "Curry with chicken".
A query word matches a recipe word when they are equal, when the recipe word
starts with it (two letters or more, for search-as-you-type), or when they are
close enough to forgive a typo.
"""

import re
import unicodedata

from rapidfuzz import fuzz

from app.recipes.model import Recipe

MIN_PREFIX = 2
MIN_RATIO = 80
# Letters NFKD leaves whole, spelled the way a keyboard without them would.
FOLD = str.maketrans({"ø": "o", "æ": "ae", "ð": "d", "þ": "th", "ł": "l"})


def words(text: str) -> list[str]:
    """Lowercase, accent-free alphanumeric words: "Crème brûlée" -> creme, brulee.

    Ø, æ and ð fold too, so "rodgrod" finds "Rødgrød".
    """
    decomposed = unicodedata.normalize("NFKD", text)
    plain = "".join(c for c in decomposed if not unicodedata.combining(c))
    return re.findall(r"[^\W_]+", plain.casefold().translate(FOLD))


def word_score(query_word: str, word: str) -> float:
    """How well a query word matches a recipe word, 0 for no match."""
    if query_word == word:
        return 100
    if len(query_word) >= MIN_PREFIX and word.startswith(query_word):
        return 100
    ratio = fuzz.ratio(query_word, word)
    return ratio if ratio >= MIN_RATIO else 0


def best_score(query_word: str, candidates: list[str]) -> float:
    return max((word_score(query_word, w) for w in candidates), default=0)


def search(recipes: list[Recipe], query: str) -> list[Recipe]:
    """Recipes matching every query word, best match first.

    Ranked by how many query words hit the name, then the mean of each query
    word's best score, then the name. A blank query returns the input as is.
    """
    query_words = words(query)
    if not query_words:
        return recipes
    ranked = []
    for recipe in recipes:
        name_words = words(recipe.name)
        recipe_words = name_words + words(" ".join(i.item for i in recipe.ingredients))
        recipe_words += words(" ".join(recipe.tags)) + words(recipe.category)
        scores = [best_score(q, recipe_words) for q in query_words]
        if not all(scores):
            continue
        name_hits = sum(1 for q in query_words if best_score(q, name_words))
        mean = sum(scores) / len(scores)
        ranked.append((-name_hits, -mean, recipe.name.casefold(), recipe))
    ranked.sort(key=lambda entry: entry[:3])
    return [entry[3] for entry in ranked]
