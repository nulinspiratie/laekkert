# M6: Drinks views and tracking only bottles — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drinks opens on "Can make" (every tracked bottle in), with views for All drinks,
Mocktails and Syrups & prep. Only bottles are tracked, and a tag that repeats its recipe's
category is dropped.

**Architecture:** The tracked rule and the drink status live in `src/app/recipes/bar.py`
(`_Registry`, `BarView`, `_Draft`). The API and MCP pass the new shapes through. The web
client mirrors the status rule in `web/src/bar.ts`, holds the view in `BrowseState`
(`web/src/browse.ts`), and the pages render it. The tag rule is a validator on `Recipe`
(`src/app/recipes/model.py`), so it covers reads and saves alike.

**Tech Stack:** Python 3 / Starlette / pydantic / FastMCP, pytest. React 19 + TypeScript +
Vite, vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-20-m6-drinks-views-design.md` (read it with this
plan; it wins on copy and behaviour). Background: `docs/superpowers/specs/2026-10-20-m4-bar-design.md`.

## Global Constraints

- Every repo convention in `CLAUDE.md` holds. Run `just lint` and `just test` before each
  commit: `uv run ruff check .`, `uv run ruff format --check .`, `uv run pytest`,
  `cd web && npm run lint && npm test`.
- Do not push to `main`. Commit on `claude/drinks-categories-filtering-9vfofy`.
- The catalog's stored field stays `fresh`. API, MCP and UI say "tracked"/"untracked".
- Bar categories: `cocktails`, `mocktails`. Made categories: `syrups`, `prep`.
- Status values: `can_make`, `missing`, `unsorted` (no `fresh_only` anywhere).
- `untracked_because` values, in priority order: `syrups`, `recipe`, `marked`.
- Exact copy (curly quotes as written):
  - `Syrups aren't tracked. Give ‘{name}’ another kind first.`
  - `Lækkert has a recipe for ‘{name}’, so it isn't tracked.`
  - Views: `Can make`, `All drinks`, `Mocktails`, `Syrups & prep` (desktop); phone chips
    `Can make {n}`, `All {n}`, `Mocktails {n}`, `Syrups {n}`; radiogroup aria-label `Show`.
  - Card: `Can make now`; `Also needs: {nameList}`; `Missing: …`; `Not sorted: …`.
  - Recipe summary: `From your bar: {n} of {n} bottles`, `Also needs: x, y`.
  - Bar page: `Not tracked`; `Fresh things, syrups and mixers. Drinks that use them still
    show under Can make and say what else they need.`; footnote `Open an item to start or
    stop tracking it.`; not-sorted help `New from drinks you added. Until you sort them,
    drinks that use them don't show under Can make.`; row button `Don't track`; no-match
    button `Add it without tracking`.
  - Sheet: switch label `Track it`; help `Tracked items are bottles: a drink needs them
    before it shows under Can make. Turn it off for fresh things, syrups and mixers.`;
    disabled reasons `Syrups are never tracked.` / `Lækkert has a recipe for it, so it's
    never tracked.`
  - Empty, set up: `Nothing to make yet`, `Every drink is missing a bottle or uses one not
    sorted yet.`, `Open the bar`, `Show all {N} drinks`.
  - Search line: `{k} more in All drinks` / `{k} more in Syrups & prep`.
  - MCP INSTRUCTIONS bar sentence: ` The drinks side has a bar (read_bar,
    manage_inventory). Only bottles are tracked; fresh items, syrups and mixers never are,
    and ‘can make’ means every tracked bottle is in.`
- Style guide tag examples lose `mocktail`; add `Don't tag what the category already says
  (`mocktail`, `syrup`).`
- Theme tokens only in CSS, 44 px touch targets, state never by colour alone.

## Review Focus

1. **An inventory with states for syrups the M4 app wrote** (simple syrup `have`): the
   bar reads it as untracked, and the next write of anything drops those names from
   `inventory.json`. Test in Task 2.
2. **A syrup M4 marked `fresh: true`** reports `untracked_because: "syrups"`, and `track`
   on it is refused with nothing written. Test in Task 2.
3. **`have` on a new `passion fruit syrup`** (no entry) creates an entry with kind
   `syrups`, not `other`, and no state. Test in Task 2.
4. **An old bookmark `/drinks?bar=fresh`** opens Can make. `bar=can&cat=mocktails` opens
   Mocktails. Test in Task 5.
5. **Searching "negroni" while on Can make without Campari** shows the "1 more in All
   drinks" line rather than only an empty list. Test in Task 6.

---

### Task 1: The tracked rule and drink status (`bar.py`, read side)

**Files:**
- Modify: `src/app/recipes/bar.py` (`Status`, `BarItem`, `_Registry`, `BarView`,
  module docstring)
- Test: `tests/test_bar.py`

**Interfaces:**
- Produces (module-level in `bar.py`):
  - `Status = Literal["can_make", "missing", "unsorted"]`
  - `UntrackedBecause = Literal["syrups", "recipe", "marked"]`
  - `BAR_CATEGORIES = ("cocktails", "mocktails")`, `MADE_CATEGORIES = ("syrups", "prep")`
  - `effective_kind(kind: Kind | None, name: str) -> Kind`: `kind` if set; else `"syrups"`
    when `search.words(name)` contains `syrup` or `syrups`; else `"other"`.
  - `BarItem` fields: `name, aliases, kind, tracked: bool, untracked_because:
    UntrackedBecause | None, state, used_in, recipe` (`fresh` removed). `json()` unchanged
    (asdict).
  - `_Registry.untracked_because(item: str) -> UntrackedBecause | None` and
    `_Registry.kind(item: str) -> Kind` (the effective kind). The registry gets every
    drink (all categories) and builds two indexes: `used_in` (every drink, as now) and
    `bar_used` (cocktails and mocktails only). `in_bar` uses `bar_used`. The recipe link
    looks at `syrups` and `prep` drinks.
  - `_Registry.state(...)` returns `None` when the item is untracked.
  - `BarView.status(recipe) -> dict | None`: `None` for a recipe in `MADE_CATEGORIES`;
    otherwise `{"status", "missing", "unsorted", "untracked"}`.
  - `BarView.ingredient(text) -> dict | None`: `{"item", "state", "tracked", "recipe"}`.
  - `BarView.json()["counts"] == {"can_make", "missing", "unsorted", "total"}`, over
    cocktails and mocktails; `set_up` is true once a tracked item has a state.

- [ ] **Step 1: Write the failing tests** in `tests/test_bar.py`. Use the file's `drink()`
  and `entries()` helpers. Update existing tests that assert `fresh_only`, `"fresh"` keys
  or the old counts to the new shapes; don't delete coverage.

```python
def test_untracked_items_dont_block_can_make(bar, store, catalog):
    entries(catalog, {"name": "white rum", "kind": "spirits"},
            {"name": "lime juice", "fresh": True}, {"name": "simple syrup", "kind": "syrups"})
    drink(store, "Daiquiri", "white rum", "lime juice", "simple syrup")
    bar.apply(BarChanges(have=["white rum"]))
    status = bar.view().status(store.get("drinks", "daiquiri"))
    assert status == {"status": "can_make", "missing": [], "unsorted": [],
                      "untracked": ["lime juice", "simple syrup"]}

def test_untracked_because_order(bar, store, catalog):
    entries(catalog, {"name": "simple syrup", "kind": "syrups", "fresh": True},
            {"name": "mint", "fresh": True})
    drink(store, "Simple syrup", "sugar", category="syrups")
    drink(store, "Orgeat", "almonds", category="syrups")
    drink(store, "Mai tai", "simple syrup", "mint", "orgeat")
    items = {i.name: i for i in bar.view().items}
    assert items["simple syrup"].untracked_because == "syrups"
    assert items["orgeat"].untracked_because == "recipe"
    assert items["mint"].untracked_because == "marked"
    assert all(not items[n].tracked and items[n].state is None for n in items if n != "sugar")

def test_syrup_word_rule(bar, store):
    drink(store, "Passion", "passion fruit syrup", "Syrup, honey", "syrupy thing")
    items = {i.name: i for i in bar.view().items}
    assert items["passion fruit syrup"].kind == "syrups" and not items["passion fruit syrup"].tracked
    assert items["Syrup, honey"].kind == "syrups"
    assert items["syrupy thing"].kind == "other" and items["syrupy thing"].tracked

def test_kind_on_entry_beats_word_rule(bar, store, catalog):
    entries(catalog, {"name": "syrup de liqueur", "kind": "liqueurs"})
    drink(store, "X", "syrup de liqueur")
    assert bar.view().items[0].tracked

def test_made_recipes_have_no_status_and_dont_fill_the_bar(bar, store):
    drink(store, "Ginger syrup", "ginger", "sugar", category="syrups")
    drink(store, "Oleo", "lemon peel", category="prep")
    view = bar.view()
    assert view.status(store.get("drinks", "ginger-syrup")) is None
    assert [i.name for i in view.items] == []
    assert view.json()["counts"] == {"can_make": 0, "missing": 0, "unsorted": 0, "total": 0}

def test_used_in_keeps_every_drink(bar, store, catalog):
    entries(catalog, {"name": "vodka", "kind": "spirits"})
    drink(store, "Infused vodka", "vodka", category="prep")
    drink(store, "Mule", "vodka")
    (item,) = bar.view().items
    assert [d["name"] for d in item.used_in] == ["Infused vodka", "Mule"]

def test_mocktail_without_bottles_can_make(bar, store, catalog):
    entries(catalog, {"name": "mint", "fresh": True})
    drink(store, "Virgin", "mint", category="mocktails")
    assert bar.view().status(store.get("drinks", "virgin"))["status"] == "can_make"

def test_status_order_missing_then_unsorted(bar, store, catalog):
    entries(catalog, {"name": "campari", "kind": "aperitifs"}, {"name": "gin", "kind": "spirits"})
    drink(store, "Negroni", "gin", "campari", "sweet vermouth")
    bar.apply(BarChanges(dont_have=["campari"]))
    s = bar.view().status(store.get("drinks", "negroni"))
    assert (s["status"], s["missing"], s["unsorted"]) == ("missing", ["campari"], ["gin", "sweet vermouth"])

def test_set_up_ignores_untracked_states(bar, store, tmp_path, catalog):
    entries(catalog, {"name": "simple syrup", "kind": "syrups"})
    drink(store, "X", "simple syrup")
    (tmp_path / "inventory.json").write_text('{"format_version": 1, "items": {"simple syrup": "have"}}')
    assert bar.view().set_up is False
```

- [ ] **Step 2: Run them to see them fail**
  Run: `uv run pytest tests/test_bar.py -q`. Expected: the new tests fail (`fresh_only`,
  missing attributes).
- [ ] **Step 3: Implement** the interfaces above. `BarView.__init__` passes every drink to
  `_Registry`; items come from `bar_used` keys plus kinded entries. Keep `Bar.view()`
  reading `self._store.list("drinks")` (all categories). Update the module docstring.
- [ ] **Step 4: Run** `uv run pytest -q`. Expected: `test_bar.py` passes. API and MCP tests
  that assert old shapes may fail; leave those to Task 3, but nothing else may break.
- [ ] **Step 5: Commit** `bar: track only bottles; syrups and prep have no status`.

### Task 2: Bar changes (`untrack`/`track`, effective kind, pruning, merges)

**Files:**
- Modify: `src/app/recipes/bar.py` (`BarChanges`, `_Draft`, `_check_conflicts`, `_fold`,
  `_apply`, `Bar.apply`, `_bar_states`, `_check_bar_kept`, `Bar.merge_ingredients`)
- Test: `tests/test_bar.py`, `tests/test_mcp_ingredients.py` (merge cases)

**Interfaces:**
- Consumes: Task 1's `_Registry.untracked_because`, `_Registry.kind`, `effective_kind`.
- Produces: `BarChanges` fields `have, dont_have, unsorted, untrack, track, kinds,
  add_names, remove_names, fold, delete` (`fresh`/`not_fresh` removed; `extra="forbid"`
  stays, so old names are refused by validation).
- Behaviour:
  - `_Draft.touch` / `new_item` / `_fold` write `effective_kind(None, name)` where they
    wrote `"other"`.
  - `untrack`: as M4's `fresh` (unknown name → new entry, effective kind, `fresh: true`).
  - `track`: clears `fresh` and the state; refused (`BarError`, nothing written) if the
    item's `untracked_because` is still `syrups` or `recipe` after that.
  - `kinds` to `syrups` clears the state.
  - `have`/`dont_have` on an untracked item: skipped (no state), but an unknown name still
    gets its entry.
  - Pairs that conflict: `(have,dont)`, `(have,unsorted)`, `(dont,unsorted)`,
    `(untrack,track)`, `(have,untrack)`, `(dont,untrack)`, `(others,delete)`.
  - `Bar.apply`, after `_apply`: drop every inventory name whose item is untracked
    (`_Draft.prune_untracked()`). The inventory is written when that changes it.
  - Merges: `is_on_bar` uses the new `in_bar` (cocktails and mocktails, kinded entries,
    or a state). `_bar_states` returns `(tracked, state)`, and `_check_bar_kept` allows
    `tracked` going from True to False (a merge that untracks), as M4 allowed "made fresh".

- [ ] **Step 1: Write the failing tests** (rename `fresh=`/`not_fresh=` in existing tests
  to `untrack=`/`track=`):

```python
def test_old_states_of_untracked_items_are_dropped_on_next_write(bar, store, catalog, tmp_path):
    entries(catalog, {"name": "simple syrup", "kind": "syrups"}, {"name": "gin", "kind": "spirits"})
    drink(store, "X", "simple syrup", "gin")
    path = tmp_path / "inventory.json"
    path.write_text('{"format_version": 1, "items": {"simple syrup": "have"}}')
    bar.apply(BarChanges(have=["gin"]))
    assert json.loads(path.read_text())["items"] == {"gin": "have"}

def test_track_refused_for_a_syrup_marked_fresh(bar, store, catalog):
    entries(catalog, {"name": "simple syrup", "kind": "syrups", "fresh": True})
    drink(store, "X", "simple syrup")
    before = catalog.raw()
    with pytest.raises(BarError, match="Syrups aren't tracked. Give ‘simple syrup’ another kind first."):
        bar.apply(BarChanges(track=["simple syrup"]))
    assert catalog.raw() == before

def test_track_refused_for_an_item_with_a_recipe(bar, store):
    drink(store, "Orgeat", "almonds", category="syrups")
    drink(store, "Mai tai", "orgeat")
    with pytest.raises(BarError, match="Lækkert has a recipe for ‘orgeat’, so it isn't tracked."):
        bar.apply(BarChanges(track=["orgeat"]))

def test_have_on_new_syrup_word_item_makes_a_syrup(bar, catalog):
    view = bar.apply(BarChanges(have=["passion fruit syrup"]))
    assert catalog.raw()[-1] == {"name": "passion fruit syrup", "kind": "syrups"}
    (item,) = view.items
    assert item.state is None and not item.tracked

def test_have_skips_untracked_but_sets_the_rest(bar, store, catalog):
    entries(catalog, {"name": "lime juice", "fresh": True}, {"name": "rum", "kind": "spirits"})
    drink(store, "X", "lime juice", "rum")
    view = bar.apply(BarChanges(have=["lime juice", "rum"]))
    assert {i.name: i.state for i in view.items} == {"lime juice": None, "rum": "have"}

def test_kind_syrups_clears_state(bar, store, catalog):
    entries(catalog, {"name": "grenadine", "kind": "other"})
    drink(store, "X", "grenadine")
    bar.apply(BarChanges(have=["grenadine"]))
    (item,) = bar.apply(BarChanges(kinds={"grenadine": "syrups"})).items
    assert item.state is None and item.untracked_because == "syrups"

def test_untrack_then_track(bar, store, catalog):
    entries(catalog, {"name": "tonic", "kind": "other"})
    drink(store, "G&T", "tonic")
    bar.apply(BarChanges(have=["tonic"]))
    assert bar.apply(BarChanges(untrack=["tonic"])).items[0].untracked_because == "marked"
    item = bar.apply(BarChanges(track=["tonic"])).items[0]
    assert item.tracked and item.state is None

def test_untrack_and_track_conflict(bar):
    with pytest.raises(BarError, match="can't be changed two ways"):
        bar.apply(BarChanges(untrack=["x"], track=["x"]))

def test_old_field_names_are_refused():
    with pytest.raises(ValidationError):
        BarChanges.model_validate({"fresh": ["lime"]})
```

  In `tests/test_mcp_ingredients.py`, add: a food-only name that a *syrups* recipe uses
  (`sugar` in "Simple syrup") can be merged (`caster sugar` into `sugar` succeeds, and
  merging `sugar` away is no longer refused as "on the bar"), and an ingredient a
  cocktail uses is still refused.
- [ ] **Step 2: Run** `uv run pytest tests/test_bar.py tests/test_mcp_ingredients.py -q`.
  Expected: new tests fail.
- [ ] **Step 3: Implement** the behaviour above.
- [ ] **Step 4: Run** `uv run pytest tests/test_bar.py tests/test_mcp_ingredients.py tests/test_ingredients.py -q`.
  Expected: PASS.
- [ ] **Step 5: Commit** `bar: untrack/track changes, syrups by name, drop stale states`.

### Task 3: API and MCP

**Files:**
- Modify: `src/app/api.py` (`bar_changes`, `with_bar`), `src/app/mcp_server.py`
  (`INSTRUCTIONS`, `BarStatus`, `list_recipes`/`search_recipes`/`read_bar`/
  `manage_inventory` docstrings and params)
- Test: `tests/test_api_bar.py`, `tests/test_mcp_bar.py`, `tests/test_mcp.py`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces (HTTP): `with_bar(body, recipe, view)` sets `body["bar"] = view.status(recipe)`
  and each ingredient's `bar` to `view.ingredient(...)`, or `None` for both when the
  status is `None`. `POST /api/bar` accepts `untrack`/`track`; `fresh` is a 400 with
  the validation sentence.
- Produces (MCP): `manage_inventory(have, dont_have, untrack, track, kinds, add_names,
  remove_names, fold)`; `BarStatus = Literal["can_make"]`; `search_recipes(bar="can_make")`
  keeps cocktails and mocktails with that status only. Its docstring says mocktails are a
  category (`category="mocktails"`), not a tag. `read_bar` docstring lists the new item
  fields and counts.

- [ ] **Step 1: Write the failing tests:**
  - `test_api_bar.py`: `GET /api/recipes?side=drinks` gives `bar: null` for a syrups
    recipe and `{"status","missing","unsorted","untracked"}` for a cocktail;
    `GET /api/recipes/drinks/<syrup slug>` has `bar: null` and every ingredient's `bar`
    null; a cocktail's ingredient `bar` has keys `{"item","state","tracked","recipe"}`;
    `POST /api/bar {"untrack": ["lime"]}` → 200 and the item `tracked: false`;
    `POST /api/bar {"fresh": ["lime"]}` → 400.
  - `test_mcp_bar.py`: `manage_inventory(untrack=[...])` works;
    `search_recipes(side="drinks", bar="can_make")` excludes a syrups recipe and includes
    a daiquiri needing only lime; `bar="fresh_only"` is refused by the schema;
    `INSTRUCTIONS` contains the exact bar sentence from Global Constraints.
- [ ] **Step 2: Run** `uv run pytest -q`. Expected: these fail.
- [ ] **Step 3: Implement.** Replace every `fresh_only`/`fresh` mention in docstrings.
- [ ] **Step 4: Run** `uv run pytest -q && uv run ruff check . && uv run ruff format --check .`.
  Expected: all pass.
- [ ] **Step 5: Commit** `api, mcp: new bar shapes; untrack and track`.

### Task 4: Tags that repeat the category

**Files:**
- Modify: `src/app/recipes/model.py` (`Recipe._check`), `src/app/style_guide.md`
- Test: `tests/test_recipe_model.py`, `tests/test_store_writes.py`

**Interfaces:**
- Produces: `Recipe` validation drops any tag whose `name_key` equals
  `name_key(category)` or `name_key(category[:-1])` (when the category ends in `s`).
  Import `name_key` from `app.recipes.catalog` (no cycle: catalog doesn't import model).

- [ ] **Step 1: Write the failing tests:**
  - `parse_recipe` of a mocktail with tags `["Mocktail", "mocktails", "summer"]` →
    `["summer"]`; a dessert tagged `dessert` → `[]`; a cocktail tagged `mocktail` keeps it.
  - Through the store: `create` a mocktail with tags `["mocktail"]` → stored file has
    `"tags": []`; then `update` with the same draft plus `["mocktail"]` is no change (the
    history/version count is unchanged; use whatever the existing "no change" tests use).
- [ ] **Step 2: Run** `uv run pytest tests/test_recipe_model.py tests/test_store_writes.py -q`. Expected: fail.
- [ ] **Step 3: Implement**, and edit `style_guide.md` (tag examples without `mocktail`,
  plus the line from Global Constraints). If `tests/test_mcp.py` asserts the style
  guide's text, update it.
- [ ] **Step 4: Run** `uv run pytest -q`. Expected: PASS.
- [ ] **Step 5: Commit** `recipes: drop tags that repeat the category`.

### Task 5: Web data layer (`types.ts`, `bar.ts`, `browse.ts`)

**Files:**
- Modify: `web/src/types.ts`, `web/src/bar.ts`, `web/src/browse.ts`
- Test: `web/src/bar.test.ts`, `web/src/browse.test.ts`

**Interfaces:**
- Consumes: Task 3's JSON shapes.
- Produces:
  - `types.ts`: `DrinkStatus = 'can_make' | 'missing' | 'unsorted'`;
    `UntrackedBecause = 'syrups' | 'recipe' | 'marked'`; `BarItem` gets
    `tracked: boolean`, `untracked_because: UntrackedBecause | null`, loses `fresh`;
    `DrinkBar = {status, missing, unsorted, untracked}`; `IngredientBar = {item, state,
    tracked, recipe}`; `RecipeSummary.bar?: DrinkBar | null`, `Recipe.bar?: DrinkBar |
    null`; `Bar.counts: Record<DrinkStatus | 'total', number>`; `BarChanges` has
    `untrack?`, `track?` instead of `fresh?`, `not_fresh?`.
  - `bar.ts`: `KINDS` stays (sheet radio list); `TRACKED_KINDS = KINDS without 'syrups'`
    used by `groupByKind`; `shelf(items)` = tracked items; `untracked(items)`;
    `unsorted(items)` = tracked with null state; `badge(bar, phone)` returns kind
    `'can_make' | 'also' | 'missing' | 'unsorted'` with texts `Can make now`,
    `Also needs: {nameList(untracked)}`, `Missing: …`, `Not sorted: …`; `topFresh` is
    deleted; `withBar(recipe, bar)` leaves `recipe.bar` null for syrups/prep (category)
    and recomputes with the new rule otherwise.
  - `browse.ts`: `export type DrinksView = 'can' | 'all' | 'mocktails' | 'syrups'`;
    `DRINKS_VIEWS: readonly DrinksView[]` in that order; `VIEW_LABELS` (desktop labels)
    and `VIEW_CHIP_LABELS` (`Can make`, `All`, `Mocktails`, `Syrups`).
    `BrowseState.bar` is replaced by `show: DrinksView | null` (null on food).
    `BarFilter` is deleted. On drinks `category` is always null.
    `parseBrowse('drinks', params)`: `show=` if valid; else `cat=` (`cocktails`→`all`,
    `mocktails`→`mocktails`, `syrups`/`prep`→`syrups`); else `bar=can|fresh`→`can`; else
    `'can'`. `browseQuery` writes `show=` unless it is `can`, never `bar=` or `cat=` on
    drinks. `applyBrowse(recipes, state)` filters by view (`can`: cocktails/mocktails
    with `bar.status === 'can_make'`; `all`: cocktails/mocktails; `mocktails`; `syrups`:
    syrups and prep). `facetCounts` returns `views: Record<DrinksView, number>` (following
    the other filters) in place of `bar`. New
    `hiddenMatches(recipes: RecipeSummary[], state: BrowseState): { view: 'all' | 'syrups'; count: number } | null`:
    null unless drinks and `state.q !== ''`; the matches (other filters applied) that the
    current view hides and All drinks would show give `{view: 'all'}`; otherwise hidden
    syrups/prep give `{view: 'syrups'}`; otherwise null. `defaultQuery('drinks')` stays `''`.

- [ ] **Step 1: Write the failing tests** (update existing ones that use `bar:`/`fresh`):

```ts
it.each([
  ['', 'can'], ['show=all', 'all'], ['show=nope', 'can'], ['bar=fresh', 'can'], ['bar=can', 'can'],
  ['cat=cocktails', 'all'], ['cat=mocktails', 'mocktails'], ['cat=prep', 'syrups'],
  ['bar=can&cat=mocktails', 'mocktails'], ['show=all&cat=syrups', 'all'],
])('parses %s as view %s', (query, view) => {
  expect(parseBrowse('drinks', new URLSearchParams(query)).show).toBe(view)
})
it('writes old params back as show', () => {
  const state = parseBrowse('drinks', new URLSearchParams('bar=can&cat=mocktails'))
  expect(browseQuery(state)).toBe('show=mocktails')
  expect(browseQuery({ ...state, show: 'can' })).toBe('')
})
it('food has no view', () => expect(parseBrowse('food', new URLSearchParams('show=all')).show).toBeNull())
it('views filter by category and status', () => { /* daiquiri can_make, negroni missing,
  virgin mojito mocktail can_make, simple syrup syrups, oleo prep:
  can → [Daiquiri, Virgin mojito]; all → +Negroni; mocktails → [Virgin mojito];
  syrups → [Oleo, Simple syrup]; facetCounts views → {can: 2, all: 3, mocktails: 1, syrups: 2} */ })
it('hiddenMatches points at All drinks, then Syrups & prep', () => { /* q='negroni' on can → {view:'all',count:1};
  q='syrup' on can with only a syrup matching → {view:'syrups',count:1}; q='' → null; food → null */ })
it('badge says Also needs', () => {
  expect(badge({ status: 'can_make', missing: [], unsorted: [], untracked: ['lime juice', 'mint', 'soda'] }, false))
    .toEqual({ kind: 'also', text: 'Also needs: lime juice, mint +1' })
  expect(badge({ status: 'can_make', missing: [], unsorted: [], untracked: [] }, true).text).toBe('Can make now')
})
it('withBar leaves syrups without a bar', () => { /* recipe.category 'syrups' → bar null */ })
```

- [ ] **Step 2: Run** `cd web && npx vitest run src/bar.test.ts src/browse.test.ts`. Expected: fail.
- [ ] **Step 3: Implement.** `tsc` will now flag every consumer (Browse, FilterPanel,
  BarPage, BarItemSheet, Ingredients, RecipeView, RecipeCard). Make the minimum change to
  compile in each (Tasks 6–8 do the real UI): map old usages to the new names and remove
  the fresh-only branches.
- [ ] **Step 4: Run** `cd web && npm run lint && npm test`. Expected: the data-layer tests
  pass; page tests that assert old copy may fail and are fixed in Tasks 6–8. Record which
  in the commit message.
- [ ] **Step 5: Commit** `web: views, tracked items and the new drink bar shape`.

### Task 6: Drinks browse page

**Files:**
- Modify: `web/src/Browse.tsx`, `web/src/FilterPanel.tsx`, `web/src/RecipeCard.tsx`,
  `web/src/styles/browse.css`
- Test: `web/src/Browse.test.tsx`

**Interfaces:**
- Consumes: Task 5 (`DrinksView`, `DRINKS_VIEWS`, labels, `facetCounts().views`,
  `hiddenMatches`, `badge`).
- Produces: phone `ViewChips` (replaces `BarChips`; radiogroup `Show`, chips with counts,
  the unsorted banner under it, row may scroll sideways); desktop aside `ViewSection`
  (replaces `BarSection`; heading `Show`, four radios with counts, then the Edit/Set up
  link and unsorted note). The Style section and its removable chip are gone on drinks
  only (food unchanged). Filter sheet Reset keeps `show`. "Clear filters" keeps `show`.

- [ ] **Step 1: Write the failing tests** in `Browse.test.tsx` (update M4 tests that use
  "From your bar", "Fresh only", `bar=`):
  - `/drinks` with a set-up bar lists only can-make cocktails/mocktails; the `Can make`
    radio is checked; syrups are not listed.
  - Clicking `Mocktails 1` (phone) navigates to `?show=mocktails` and lists the mocktail.
  - Desktop: the `Show` radiogroup has `Can make`, `All drinks`, `Mocktails`,
    `Syrups & prep` with counts; there is no `Style` heading on drinks; food still has
    `Category`.
  - Desktop result line: `Can make · 2 drinks`; All drinks `3 drinks · 2 you can make`;
    Mocktails `Mocktails · 1 drink`; Syrups & prep `Syrups & prep · 2 recipes`.
  - Bar not set up: the `Set up your bar first` box shows above the list on Can make, and
    not on All drinks.
  - Set up, nothing makeable: `Nothing to make yet` with `Show all 3 drinks`.
  - Bar fails to load: no `Can make` option; the list is All drinks.
  - Search `negroni` on Can make (Negroni missing campari) shows the link
    `1 more in All drinks` → `?q=negroni&show=all`.
  - A can-make card with lime shows `Also needs: lime juice`; a syrup card has no badge.
- [ ] **Step 2: Run** `cd web && npx vitest run src/Browse.test.tsx`. Expected: fail.
- [ ] **Step 3: Implement.** Delete `BarEmpty`'s fresh branches and `topFresh` use. Badge
  icon for `also`: the existing `Basket`; CSS modifier `bar-badge--also` with theme tokens.
- [ ] **Step 4: Run** `cd web && npm run lint && npm test -- src/Browse.test.tsx src/App.test.tsx src/Shell.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit** `web: drinks views replace the bar filter and Style`.

### Task 7: The bar page and item sheet

**Files:**
- Modify: `web/src/BarPage.tsx`, `web/src/BarItemSheet.tsx`, `web/src/styles/bar.css`
- Test: `web/src/BarPage.test.tsx`

**Interfaces:**
- Consumes: Task 5 (`shelf`, `untracked`, `unsorted`, `groupByKind` over tracked kinds,
  `BarChanges.untrack/track`, `BarItem.untracked_because`).
- Produces: `NotTrackedSection` (replaces `FreshSection`); not-sorted rows gain a
  `Don't track` button sending `{untrack: [name]}` (optimistic, rolled back on error like
  the other toggles); no-match `Add it without tracking` sends `{untrack: [q]}`; the
  sheet's `Track it` switch (`role="switch"`, `aria-checked={item.tracked}`) sends
  `track`/`untrack`, and is disabled with the reason text when `untracked_because` is
  `syrups` or `recipe`. Can-make card and desktop "See them" link to `/drinks`. Counts
  ("{have} of {total} bottles in", progress) use tracked items.

- [ ] **Step 1: Write the failing tests** (update M4 tests for fresh copy):
  - The `Not tracked` heading and its sentence; simple syrup (kind syrups) is listed there,
    not under a Syrups group; there is no `Syrups` group heading.
  - A not-sorted row's `Don't track` posts `{"untrack":["tonic"]}` and the item moves to
    Not tracked.
  - Sheet for `mint` (marked): `Track it` is enabled and off; clicking posts
    `{"track":["mint"]}`. Sheet for `simple syrup`: switch disabled, text
    `Syrups are never tracked.`. Sheet for an item with a recipe: `Lækkert has a recipe for
    it, so it's never tracked.`. The In-the-bar radiogroup is absent for untracked items.
  - No match for `yuzu`: `Add it without tracking` posts `{"untrack":["yuzu"]}`.
  - The can-make card links to `/drinks`.
- [ ] **Step 2: Run** `cd web && npx vitest run src/BarPage.test.tsx`. Expected: fail.
- [ ] **Step 3: Implement.** Layout of `Don't track` is the builder's call (a text button
  under Have/Don't have on phone is fine; 44 px target).
- [ ] **Step 4: Run** `cd web && npm run lint && npm test -- src/BarPage.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit** `web: bar page tracks only bottles`.

### Task 8: A drink's recipe page

**Files:**
- Modify: `web/src/Ingredients.tsx`, `web/src/RecipeView.tsx`, `web/src/styles/recipe.css`
- Test: `web/src/RecipeView.test.tsx`, `web/src/Ingredients.test.tsx`

**Interfaces:**
- Consumes: Task 5 (`IngredientBar.tracked`, `DrinkBar.untracked`, `withBar`,
  `BrowseState.show`).
- Produces: summary line `Missing: a, b` or `From your bar: {n} of {n} bottles`, plus
  `Also needs: x, y` (basket) when `untracked` is non-empty; untracked rows have no state
  button and no state text, but keep `Recipe: {Name}` when `bar.recipe` is set; `Out?
  Make it` is gone; syrups/prep pages (`recipe.bar == null`) show no summary and no state
  buttons. Tag links: on drinks, `browseQuery({..., show: 'all', tags: [tag]})`; on food
  unchanged (`show: null`).

- [ ] **Step 1: Write the failing tests:**
  - Daiquiri (rum have, lime fresh, simple syrup syrups with a recipe):
    `From your bar: 1 of 1 bottles` and `Also needs: lime juice, simple syrup`; the lime
    row has no button; the syrup row links `Recipe: Simple syrup`.
  - A syrup recipe page has no `From your bar` text and no `In the bar` buttons.
  - A drink's tag link href is `/drinks?show=all&tag=classic`; a food tag link has no `show`.
  - Flipping rum to don't have still shows the undo row (unchanged behaviour).
- [ ] **Step 2: Run** `cd web && npx vitest run src/RecipeView.test.tsx src/Ingredients.test.tsx`. Expected: fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `cd web && npm run lint && npm test`. Expected: the whole web suite passes.
- [ ] **Step 5: Commit** `web: recipe page shows bottles and what else a drink needs`.

### Task 9: Docs, screenshots, final review (controller)

- [ ] `docs/plan.md`: an M6 section (what was built, rulings, the spec's "Calls I made").
- [ ] `docs/ideas.md`: under smart tags, note that mocktail is a category view, not a tag.
- [ ] `docs/design/README.md`: M6, no artboard, `screenshots/m6/`.
- [ ] Screenshots in `docs/design/screenshots/m6/` with Playwright against `just run`
  (seed data plus a few drinks and bar states made through the API): the list in the
  spec's "Docs" section.
- [ ] `just lint` and `just test` green; whole-branch review; open the PR to `main`.
