# M5: Cook with what you have, and merging ingredients — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Food's browse page and Claude's `search_recipes` rank recipes by what you have
(fewest missing first); Claude can list ingredient identities and merge or separate names.

**Architecture:** A pure matcher module (`have.py`) next to `search.py` does matching and
ranking; the list API and `search_recipes` call it. A second module (`ingredients.py`)
builds ingredient identities over both sides and computes merges on raw catalog entries;
`Bar` runs it under its lock with its strict reads and writes. The web client keeps the
terms in the URL (`have=`), sends them to the list API and shows a chip field, a phone
header button and card badges.

**Tech Stack:** Python 3 / Starlette / pydantic / rapidfuzz / MCP SDK; React + TypeScript
+ Vitest in `web/`.

**Spec:** `docs/superpowers/specs/2026-10-20-m5-have-and-merge-design.md`

## Global Constraints

- Copy (headings, placeholders, refusals, badges, empty states) is verbatim from the spec,
  including the curly quotes `‘ ’` in refusals and `"What you have" is for food only.`
- British spelling in code comments, docs and copy.
- No hard-coded colours: theme tokens only. Touch targets at least 44 px.
- The terms are never written to `/data` or `localStorage`.
- Recipes are never rewritten by a merge. A merge never gives a catalog entry a `kind`.
- Catalog writes go through `Catalog.raw()` / `Catalog.save_raw()`; inventory writes through
  `Bar`'s strict read and `_write`, under `Bar._lock`.
- Checks before every commit: `just lint` and `just test`; for web tasks also, in `web/`,
  `npm test`, `npm run lint`, `npm run build`.
- Commits end with the session trailer lines the controller gives you. No model names in
  any file.

## Review Focus

1. A term matching nothing on the page (typo far off, "zzz"): empty state, not an error;
   the recipe list request still answers 200. (Task 2 API test, Task 6 Browse test.)
2. The same ingredient written twice in one recipe, or written as an alias and its main
   name: counted once in missing/matched. (Task 1 test.)
3. A catalog that can't be read: `have` still works by words alone (lookups mean an empty
   catalog); `merge_ingredients` refuses with the unavailable sentence and writes nothing.
   (Task 1 and Task 3 tests.)
4. Back from a recipe keeps the terms, switching side drops them, and a reload shows them
   again from the URL while `localStorage` stays untouched. (Task 5 browse test, Task 6
   Browse test.)
5. Merge into a name that is on the bar (`caster sugar` → `sugar`) leaves the bar's state
   for sugar and every drink status unchanged. (Task 3 test.)

---

### Task 1: The matcher (`have.py`)

**Files:**
- Create: `src/app/recipes/have.py`
- Test: `tests/test_have.py`

**Interfaces:**
- Consumes: `search.words(text) -> list[str]`, `catalog.name_key`, `Catalog.entry(name)`,
  `Recipe.ingredients[*].item/unit`.
- Produces:
  - `MAX_TERMS = 20`, `MAX_TERM_LENGTH = 60`
  - `clean_terms(raw: list[str]) -> list[str]` — strip, cut to 60, drop blanks, dedupe by
    `name_key` keeping the first spelling, keep at most 20.
  - `word_matches(term_word: str, name_word: str) -> bool`
  - `@dataclass HaveMatch: matched: list[str]; missing: list[str]; terms_matched: int`
    with `json() -> {"matched": [...], "missing": [...]}`.
  - `match(recipe: Recipe, terms: list[str], catalog: Catalog) -> HaveMatch`
  - `rank(recipes: list[Recipe], terms: list[str], catalog: Catalog) -> list[tuple[Recipe, HaveMatch]]`
    — kept recipes only, in the spec's order. `terms` are already cleaned.

- [ ] **Step 1: Write the failing tests** in `tests/test_have.py`, using a `Catalog` on
  `tmp_path` written with `save_raw` and `Recipe` objects built in the test:
  - `test_clean_terms`: `clean_terms([" Leeks ", "", "leeks", "LEEKS", "chicken"]) == ["Leeks", "chicken"]`;
    a 70-char term comes back 60 chars; 25 distinct terms give 20.
  - `test_word_matches`: True for `("leeks","leek")`, `("potato","potatoes")`,
    `("egg","eggs")`, `("eggs","egg")`, `("tomatoes","tomato")`, `("pea","peas")`;
    False for `("pea","pear")`, `("rice","rise")`, `("pea","peanuts")`,
    `("chicken","chickpeas")`.
  - `test_covers_by_words`: "chicken" covers `chicken thighs`; "baby potato" covers
    `baby potatoes`; "chicken stock" does not cover `chicken thighs`.
  - `test_covers_by_catalog`: entry `{"name": "coriander", "aliases": ["cilantro"]}`;
    term "coriander" covers item `cilantro`; term "cilantro" covers item `coriander`;
    term "cilantro" does not cover item `fresh parsley`; term "coriander leaves" does
    not cover `cilantro`.
  - `test_assumed_rows`: a recipe with `salt` (`unit "to taste"`), `water` (600 ml) and
    `leeks`; terms `["leeks"]` → `missing == []`, `matched == ["leeks"]`. With a catalog
    entry `{"name": "water", "aliases": ["tap water"]}`, item `tap water` is assumed too;
    without it, `tap water` is missing.
  - `test_assumed_row_can_match`: term "salt" on the same recipe → `matched` includes
    `salt`.
  - `test_duplicates_count_once`: items `leeks`, `leek` (no catalog) and `ground cumin`,
    `cumin` with entry `{"name": "ground cumin", "aliases": ["cumin"]}`; terms `["onion"]`
    and an `onion` row → `missing` holds `leeks` and `ground cumin` once each, in recipe
    order, written as the first row.
  - `test_rank_order`: three recipes — A uses chicken + 1 other, B uses chicken and leeks
    + 1 other, C uses leeks + 4 others, D uses neither → `rank(..., ["chicken","leeks"])`
    gives `[B, A, C]` (B and A both miss 1; B matches 2 terms); D is absent. Ties on both
    counts sort by name case-insensitively.
  - `test_unreadable_catalog_still_matches_words`: catalog file with `not json` → term
    "leeks" still covers `leek`.

- [ ] **Step 2: Run** `uv run pytest tests/test_have.py -q` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement `have.py`.** A row's names are its `item` plus, when
  `catalog.entry(item)` exists, the entry's name and aliases. A term covers a row when
  `catalog.entry(term)` and `catalog.entry(item)` are the same entry object (both not
  None), or every word of `words(term)` has a `word_matches` hit among the words of the
  row's names. `word_matches`: term words of 5+ letters — equal or `fuzz.ratio >= 80`;
  shorter — equal, or one is the other plus `s` or `es`. Assumed: `unit == "to taste"`,
  or `name_key(item) == "water"`, or the item's entry has `name_key(entry.name) == "water"`.
  Identity for "counts once": the entry's `name_key(entry.name)` when there is an entry,
  else `name_key(item)`. A term counts as matched for `terms_matched` when it covers any
  row. Module docstring in the style of `search.py`'s.

- [ ] **Step 4: Run** `uv run pytest tests/test_have.py -q` — Expected: all pass. Then
  `just lint && just test`.

- [ ] **Step 5: Commit** `feat(have): match and rank recipes by what you have`.

### Task 2: `have` in the list API and `search_recipes`

**Files:**
- Modify: `src/app/api.py` (`summaries`, `list_recipes`), `src/app/mcp_server.py` (`search_recipes`)
- Test: `tests/test_api.py`, `tests/test_mcp.py`

**Interfaces:**
- Consumes: Task 1's `clean_terms`, `rank`, `HaveMatch.json()`.
- Produces: `GET /api/recipes?side=food&have=…` (repeatable) → summaries with
  `"have": {"matched": [...], "missing": [...]}`, kept and ranked; MCP
  `search_recipes(..., have: list[str] = [])` with the same block per entry.
  Constant `HAVE_FOOD_ONLY = '"What you have" is for food only.'` in `have.py` (add it
  there in this task), used by both.

- [ ] **Step 1: Write the failing tests.**
  - `tests/test_api.py::test_list_have_ranks_and_annotates`: with the seed data,
    `GET /api/recipes?side=food&have=chicken&have=leeks` → slugs
    `["chicken-leek-traybake"]`, and its `have == {"matched": ["chicken thighs", "leeks"],
    "missing": ["baby potatoes", "olive oil", "smoked paprika", "lemon"]}`.
  - `test_list_have_with_q`: `q=dal&have=onion` → only `red-lentil-dal`; `q=traybake&have=onion` → `[]`, status 200.
  - `test_list_have_nothing_matches`: `have=zzzz` → 200, `[]`.
  - `test_list_blank_have_is_ignored`: `have=` and `have=%20` → same body as no `have`,
    and no summary has a `have` key.
  - `test_list_have_on_drinks_is_refused`: `side=drinks&have=lime` → 400, `{"error": '"What you have" is for food only.'}`.
  - `tests/test_mcp.py::test_search_have`: `search_recipes(side="food", have=["chicken","leeks"], sort="name")`
    → first entry `chicken-leek-traybake` with the same `have` block; on drinks →
    `isError` true with the sentence.

- [ ] **Step 2: Run** `uv run pytest tests/test_api.py tests/test_mcp.py -q -k have` — Expected: FAIL.

- [ ] **Step 3: Implement.** In `summaries(side, query, have)`: search first, then, when
  cleaned terms exist, `rank` the searched list and add `have` to each summary. Read
  `request.query_params.getlist("have")`. In `search_recipes`: refuse on drinks with a
  `ToolError(HAVE_FOOD_ONLY)` when cleaned terms exist; apply tags/marks/category filters
  as now, then rank instead of `order(found, sort)`, then `[:limit]`. Docstring: one or
  two sentences per the spec's MCP section.

- [ ] **Step 4: Run** the same tests — Expected: PASS; then `just lint && just test`.

- [ ] **Step 5: Commit** `feat(api,mcp): what-you-have filter for food`.

### Task 3: Ingredient identities and merges (`ingredients.py`, `Bar.merge_ingredients`)

**Files:**
- Create: `src/app/recipes/ingredients.py`
- Modify: `src/app/recipes/bar.py` (add `Bar.merge_ingredients`, `Bar.ingredients`)
- Test: `tests/test_ingredients.py`

**Interfaces:**
- Consumes: `CatalogEntry`, `name_key`, `Catalog.raw()/save_raw()/entries()`,
  `RecipeStore.list(side)`, `Bar._lock`, `Bar._read_strict()`, the bar's `EMPTY_NAME`,
  `Catalog`'s `UNAVAILABLE` / `CatalogUnavailable`, `InventoryUnavailable`.
- Produces:
  - `class IngredientError(ValueError)` — its message is the spec's sentence.
  - `class Identities` built from `(entries: list[CatalogEntry | None], recipes: dict[str, list[Recipe]])`
    (`recipes` keyed `"food"`, `"drinks"`; food first). Methods:
    `key(name) -> str | None` (identity key: the entry's own `name_key`, or a recipe
    item's `name_key`; None for unknown), `entry_position(key) -> int | None`,
    `json(key) -> dict` (the spec's `list_ingredients` entry), `all(side: str | None) -> list[dict]`.
    First entry wins on a taken name, as in `_Registry`.
  - `merge(raw: list[dict], recipes: dict[str, list[Recipe]], on_bar: Callable[[str], bool], merges: dict[str, str], separate: list[str]) -> tuple[list[dict], list[str]]`
    — returns the new raw entries and the touched identity keys in call order; raises
    `IngredientError`. Pure: never writes.
  - `Bar.ingredients(side: str | None) -> list[dict]` and
    `Bar.merge_ingredients(merges: dict[str, str], separate: list[str]) -> list[dict]`
    (returns the touched identities' JSON after the write).
  - Refusal constants in `ingredients.py`: `NOTHING = "Nothing to change."` plus functions
    for the spec's `‘A’` sentences: `no_ingredient(a)`, `same(a, b)`, `on_bar(a)`,
    `chain(b)`, `twice(a)`, `merged_and_separated(a)`, `not_alias(n)`, `main_name(n)`.

- [ ] **Step 1: Write the failing tests** in `tests/test_ingredients.py` against
  `Bar(tmp_path, catalog, store)` with recipes saved through the store (or the seed set,
  where it fits). Each asserts the exact sentence:
  - `test_list_ingredients_food`: seed data, `bar.ingredients("food")` contains
    `{"name": "salt", "other_names": ["fine salt", "sea salt"], "recipes": {"food": 2, "drinks": 0}, "in_catalog": True, "g_per_tsp": 6, "fresh": False, "kind": None}`;
    no drinks-only entries; no unused catalog entries (`honey` absent).
  - `test_list_ingredients_all_includes_unused_catalog`: `bar.ingredients(None)` includes
    `honey` with zero counts; sorted by name case-insensitively.
  - `test_other_names_include_recipe_spellings`: recipes using `Leeks` and `leek` with
    entry `{"name": "leek", "aliases": ["leeks"]}` → `other_names == ["leeks"]`; a recipe
    item `Ground Cumin` for entry `ground cumin` adds nothing.
  - `test_merge_food_names`: recipes use `leeks` and `leek`, no entries → merge
    `{"leeks": "leek"}` writes `{"name": "leek", "aliases": ["leeks"]}`, returns its JSON,
    recipe files unchanged byte for byte, no `kind` anywhere, inventory file not created.
  - `test_merge_copies_missing_fields_and_keeps_targets`: A `{"name": "caster sugar",
    "g_per_tsp": 4.2, "note": "x"}` into B `{"name": "sugar", "g_per_tsp": 4}` → B keeps
    4, gains `note`, aliases gain `caster sugar`; A's entry is gone.
  - `test_merge_into_bar_item_keeps_bar`: drinks use `sugar`, inventory
    `{"sugar": "have"}`; merge `{"caster sugar": "sugar"}` (food only) → inventory file
    unchanged, `bar.view().json()` equal before and after apart from sugar's aliases.
  - `test_merge_refusals`: unknown name → `There is no ingredient ‘nope’.`; same identity
    (`{"cumin": "ground cumin"}` with the alias) → `‘cumin’ and ‘ground cumin’ are already the same ingredient.`;
    A used by a drink or with a `kind` → `‘white rum’ is on the bar. Fold it there instead (manage_inventory).`;
    `{"a": "b", "b": "c"}` → `Chains aren't allowed in one call: ‘b’ is merged and merged into.`;
    `{"Leeks": "leek", "leeks": "onion"}` → `‘leeks’ is merged twice.` (second spelling; names are stripped first);
    merge and separate of one name → `‘leeks’ can't be merged and separated in one call.`;
    `{"": "x"}` → `A name can't be empty.`; empty call → `Nothing to change.`.
    After each refusal the catalog file is unchanged.
  - `test_separate`: after the merge above, `separate=["leeks"]` → entry back to
    `{"name": "leek", "aliases": []}` (or no `aliases` key — assert the alias is gone),
    `leeks` is its own identity in `bar.ingredients("food")`. Main name →
    `‘leek’ is the main name of its ingredient. Merge it into another name instead.`;
    unknown alias → `‘onion’ isn't another name of anything.`
  - `test_merge_moves_whole_identity`: merging alias `cumin` of `ground cumin` into
    `jeera` moves `ground cumin` and `cumin` both into `jeera`'s aliases.
  - `test_merge_refuses_unreadable_catalog`: catalog file `not json` → raises
    `CatalogUnavailable`; file unchanged.

- [ ] **Step 2: Run** `uv run pytest tests/test_ingredients.py -q` — Expected: FAIL.

- [ ] **Step 3: Implement `ingredients.py`** and the two `Bar` methods. `Bar.merge_ingredients`
  under `self._lock`: `raw = catalog.raw()`, `self._read_strict()` (only to refuse an
  unreadable inventory), recipes = `{"food": store.list("food"), "drinks": store.list("drinks")}`,
  `on_bar` = the item is in a fresh `_Registry` built from the parsed raw and the drinks
  and is used by a drink or has a kind or a state in the inventory; call `merge`; if the
  result differs, `catalog.save_raw(...)`; return the touched identities' JSON from fresh
  `Identities`. Conflicts are checked before any change (spec's "Conflicts in one call"),
  then merges in dict order, then separates. Merge field rule:
  `{**a_raw_without_name_and_aliases, **b_raw}` with B's name and the unioned aliases.

- [ ] **Step 4: Run** the tests — Expected: PASS; `just lint && just test`.

- [ ] **Step 5: Commit** `feat(ingredients): list ingredient identities and merge names`.

### Task 4: MCP `list_ingredients` and `merge_ingredients`, instructions, style guide

**Files:**
- Modify: `src/app/mcp_server.py`, `src/app/style_guide.md`
- Test: `tests/test_mcp_ingredients.py` (new)

**Interfaces:**
- Consumes: Task 3's `Bar.ingredients`, `Bar.merge_ingredients`, `IngredientError`.
- Produces: tools `list_ingredients(side: Literal["food","drinks"] | None = None) -> list[dict]`
  and `merge_ingredients(merges: dict[str, str] = {}, separate: list[str] = []) -> dict`
  returning `{"ingredients": [...]}`.

- [ ] **Step 1: Write the failing tests:** tools/list contains both; `list_ingredients`
  with `side="food"` equals `bar.ingredients("food")` (compare against the REST-free
  expectation for `salt` from Task 3); a merge round trip `{"leeks": "leek"}` then
  `separate=["leeks"]` over MCP; a refusal comes back `isError: true` with the exact
  sentence; an unreadable catalog comes back `isError: true` with the catalog's
  `UNAVAILABLE` sentence; `INSTRUCTIONS` mentions `merge_ingredients` and that recipes
  keep their wording; `get_style_guide` text mentions `list_ingredients`.

- [ ] **Step 2: Run** `uv run pytest tests/test_mcp_ingredients.py -q` — Expected: FAIL.

- [ ] **Step 3: Implement.** Map `IngredientError`, `CatalogUnavailable`,
  `InventoryUnavailable` to `ToolError(str(exc))` the way `manage_inventory` does.
  Docstrings per the spec. Add one sentence to `INSTRUCTIONS` and one line to the style
  guide's ingredients section (spec's "Instructions and style guide").

- [ ] **Step 4: Run** the tests — Expected: PASS; `just lint && just test`.

- [ ] **Step 5: Commit** `feat(mcp): list_ingredients and merge_ingredients`.

### Task 5: Web data layer for `have`

**Files:**
- Modify: `web/src/types.ts`, `web/src/browse.ts`, `web/src/api.ts`
- Test: `web/src/browse.test.ts`, `web/src/api.test.ts`

**Interfaces:**
- Produces:
  - `types.ts`: `interface HaveMatch { matched: string[]; missing: string[] }`;
    `RecipeSummary.have?: HaveMatch`.
  - `browse.ts`: `BrowseState.have: string[]` (food only; `[]` on drinks); `parseBrowse`
    reads repeatable `have` (trimmed, blanks dropped, deduped by `haveKey`, at most 20);
    `browseQuery` writes them in order; `haveKey(term: string): string` (NFKD, strip
    combining marks, lower case, collapse spaces — the client's `name_key`);
    `applyBrowse` keeps the API's order when `state.have.length > 0` (as for `q`);
    `describe` uses `fewest missing first` in place of the sort/search part when there are
    terms; `addTerm(state, text) -> BrowseState` and `removeTerm(state, term) -> BrowseState`
    helpers (no-op on blank or duplicate).
  - `api.ts`: `listRecipes(side, q?, have?: string[])` appending each as `have`.

- [ ] **Step 1: Write the failing tests:** parse/query round trip with `have=chicken&have=leeks`;
  drinks ignores `have`; `have=` blank dropped; duplicates `Leeks`/`leeks` keep the first;
  `applyBrowse` with terms keeps input order even with `sort: 'name'`; `describe` →
  `fewest missing first`; `addTerm` dedupes by `haveKey` and trims; `removeTerm`;
  `listRecipes('food', undefined, ['chicken', 'leeks'])` fetches
  `/api/recipes?side=food&have=chicken&have=leeks`.

- [ ] **Step 2: Run** `cd web && npx vitest run src/browse.test.ts src/api.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement** the interfaces above. Existing callers of `BrowseState` get
  `have: []` where they build one.

- [ ] **Step 4: Run** the same — Expected: PASS; then `npm test && npm run lint && npm run build`.

- [ ] **Step 5: Commit** `feat(web): what-you-have state and API`.

### Task 6: Web screens — chip field, phone button, badges, empty state

**Files:**
- Create: `web/src/HaveField.tsx`, `web/src/HaveField.test.tsx`
- Modify: `web/src/Browse.tsx`, `web/src/FilterPanel.tsx`, `web/src/RecipeCard.tsx`,
  the stylesheet the badges and filter sections live in (find it with
  `grep -rn "bar-badge" web/src --include=*.css`)
- Test: `web/src/Browse.test.tsx`, `web/src/HaveField.test.tsx`

**Interfaces:**
- Consumes: Task 5's `BrowseState.have`, `addTerm`, `removeTerm`, `listRecipes(side, q, have)`,
  `HaveMatch`.
- Produces: `HaveField({ terms, onAdd, onRemove, onClear, inputRef? })`; `haveBadge(have: HaveMatch): { text: string; label: string; complete: boolean }`
  (in `RecipeCard.tsx` or a small module) — `text` per the spec (`Have everything`,
  `Missing: a, b +N`), `label` the full sentence `Missing: a, b, c, d`.

- [ ] **Step 1: Write the failing tests.**
  - `HaveField.test.tsx`: placeholder `Add an ingredient`; typing `chicken` + Enter calls
    `onAdd('chicken')`; typing `leeks,` calls `onAdd('leeks')` and clears the field;
    Backspace in an empty field calls `onRemove` with the last term; each chip's button is
    named `Remove chicken`; `Clear` shows only with terms; the hint
    `See what you can cook with what's in the fridge.` shows only without terms.
  - `haveBadge`: `{missing: []}` → `Have everything`; two missing → `Missing: a, b`;
    four → `Missing: a, b +2` with label `Missing: a, b, c, d`.
  - `Browse.test.tsx` (food, desktop): the aside has a `What you have` section; adding a
    term navigates to `?sort=time&have=chicken` (keeping existing params) and refetches
    with `have`; cards show the badge; subtitle contains `fewest missing first`; empty
    result with terms shows `Nothing uses chicken or leeks`, body
    `Try another ingredient, or clear the list.` and a `Clear` button that removes every
    `have` param; with four terms the title is `Nothing uses those`.
  - `Browse.test.tsx` (food, phone): a header button named `What you have` with
    `aria-pressed` false; it opens the panel; after adding a term it has `aria-pressed`
    true and the panel stays open after a re-render; drinks has no such button and
    ignores `have=` in the URL; `localStorage.setItem` is never called with a key or
    value containing a term.

- [ ] **Step 2: Run** `cd web && npx vitest run src/HaveField.test.tsx src/Browse.test.tsx` — Expected: FAIL.

- [ ] **Step 3: Implement.** The list fetch keys on `side`, the debounced `q` and the
  joined `have` terms (no debounce for terms). Desktop: `FilterPanel` gets an optional
  `have` prop (food only) rendering the section between search and marks. Phone: the
  header button (existing `Basket` icon) left of search, panel inside `browse-body` above
  the search field; open state `useState(state.have.length > 0)`. Badge in the drinks
  badge position and style with food theme tokens. Empty state per the spec, inside the
  existing `Results`/empty machinery: with terms and no other filters, the new copy; with
  other filters too, the existing generic state.

- [ ] **Step 4: Run** the same — Expected: PASS; then `npm test && npm run lint && npm run build`,
  `just lint && just test`.

- [ ] **Step 5: Commit** `feat(web): cook with what you have`.

### Task 7: Docs, screenshots, final review, PR (controller)

- [ ] `docs/plan.md`: M5 section (built, rulings), "After the PoC" updated per the spec.
- [ ] `docs/design/README.md`: "Cook with what you have" built in M5, no artboard.
- [ ] Screenshots in `docs/design/screenshots/m5/` with Playwright against `just run`
  plus the built web: food desktop with `have=chicken&have=leeks` (light, dark), phone with
  the panel open (light, dark), the empty state (phone).
- [ ] Final whole-branch review, fixes, PR.
