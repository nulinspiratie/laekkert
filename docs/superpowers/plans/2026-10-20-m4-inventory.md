# M4: the bar (drinks inventory) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The household keeps one bar of have / don't-have bottles. Drinks show whether
they can be made now, need only fresh items, or miss something. Claude can read and
change the bar over MCP.

**Architecture:** The ingredient catalog becomes the identity registry (names, aliases,
kind, fresh) and gets a careful writer. A new `inventory.json` holds have / don't-have per
item. A new module `recipes/bar.py` builds a read-only `BarView` (items, states, each
drink's status) from the catalog, the inventory and the drink recipes, and applies one
change model (`BarChanges`) all-or-nothing. REST (`/api/bar`) and MCP (`read_bar`,
`manage_inventory`) are thin wrappers. The web app adds the `/bar` page and item sheet,
the browse filter and badges, and bar states on a drink's recipe page.

**Tech Stack:** as M3 (Starlette, pydantic 2, `mcp` MCPServer; React 19, Vite, TypeScript,
react-router, Vitest + Testing Library). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-20-m4-bar-design.md`, with the artboards in
`docs/design/artboards/` (`Bar*`, `Drinks*`, `DrinkRecipe*`) for copy and layout.

## Rulings (for Serwan to confirm at review)

1. **Kinds are added.** The design groups the bar by kind, so catalog entries gain an
   optional `kind`. Items without one show under Other.
2. **The catalog is the registry, the inventory is separate.** Names, aliases, kind and
   fresh are properties of an ingredient (the catalog); have / don't have is household
   state (`inventory.json`). Food never reads the inventory.
3. **Unsorted counts as missing on the recipe page's summary**, but is its own status
   (`unsorted`) on cards and in counts, so the browse page can say "Not sorted: x".
4. **Accent-insensitive names everywhere** (`Crème` = `creme`), including g-per-tsp
   lookups.
5. **Claude cannot delete bar items**; the app can, only for items no drink uses.
6. **Existing installs keep their catalog.** New kinds in the seed reach only new
   installs; on the NAS, white rum and simple syrup show as Other until someone sets a
   kind.
7. **The desktop item sheet is a centred dialog** with the phone sheet's content; there
   is no desktop artboard.
8. **`/bar` is a static route**, so it never clashes with `/:side`.

## Global Constraints

- Writes only under `/data` (`catalog/ingredients.json`, `inventory.json`), always with
  `app.recipes.files.atomic_write`. No new settings, no secrets; `nas-app.toml` and
  `config.example.toml` unchanged.
- Every refusal is one plain sentence: `{"error": sentence}` with 400 in REST (503 when a
  file cannot be read), a `ToolError` in MCP, the same sentence in both.
- Copy is the artboards' and the spec's, verbatim. British spelling, sentence case. No
  model names in repo files.
- Item names display capitalised (`capitalise` from `web/src/format.ts`); stored as given.
- Touch targets at least 44 px. Bar state is never colour alone: icon plus text.
- Full check before each commit:
  `just lint && just test && (cd web && npm test && npm run lint && npm run build)`.

## Review Focus

1. **A hand-edited catalog with an entry the app can't parse, or unknown fields.** A bar
   write must keep it exactly as it was (Task 1 `test_save_keeps_untouched_entries_verbatim`).
2. **`inventory.json` is corrupt.** The bar reads as all unsorted and writes are refused
   with a sentence, never overwriting the file (Task 2 `test_unreadable_inventory_refuses_writes`).
3. **The same bottle written two ways across drinks** (`White Rum`, `white rum`,
   `Crème de violette` / `creme de violette`) must be one item (Task 2
   `test_ingredients_resolve_case_and_accent_insensitively`).
4. **A toggle fails on the server** (network, 503). The page rolls the row back and shows
   the sentence (Task 6 `rolls back a toggle the server refuses`).
5. **A drink slugged `bar`** still opens at `/drinks/bar`, and `/bar` opens the bar
   (Task 6 `routes /bar to the bar and /drinks/bar to the recipe`).

---

### Task 1: Catalog kinds, accent-insensitive key, writer

**Files:**
- Modify: `src/app/recipes/catalog.py`, `src/app/seed/catalog/ingredients.json`
- Test: `tests/test_catalog.py`

**Interfaces:**
- Produces:
  - `Kind = Literal["spirits", "liqueurs", "aperitifs", "bitters", "syrups", "other"]` and
    `KINDS: tuple[Kind, ...]` in that order.
  - `CatalogEntry.kind: Kind | None = None` (still `extra="ignore"`).
  - `name_key(name: str) -> str`: NFKD, drop combining marks
    (`unicodedata.combining`), casefold, collapse whitespace runs to one space, strip.
    `_key` is replaced by it everywhere.
  - `class CatalogUnavailable(OSError)` with the sentence
    `"The ingredient catalog can't be read, so the bar can't be changed. Fix catalog/ingredients.json on the NAS."`
  - `Catalog.entries() -> list[CatalogEntry]`: valid entries in file order (cached by mtime
    like today).
  - `Catalog.entry(name: str) -> CatalogEntry | None`: by name or alias, first wins.
  - `Catalog.raw() -> list[dict]`: the file's `ingredients` list as parsed JSON; `[]` if
    the file is missing; raises `CatalogUnavailable` if it exists but is not readable JSON,
    has no list, or `format_version` is not an int ≤ 1.
  - `Catalog.save_raw(entries: list[dict]) -> None`: writes
    `{"format_version": 1, "ingredients": entries}` with `atomic_write`
    (`json.dumps(..., ensure_ascii=False, indent=2)` + newline), keeping any other
    top-level keys the file had; resets the mtime cache.

- [ ] **Step 1: Write the failing tests** in `tests/test_catalog.py`:
  - `test_key_ignores_accents_case_and_spacing`: an entry `Crème de violette` is found by
    `catalog.entry("creme  DE violette ")`; `name_key("Crème de violette") == "creme de violette"`.
  - `test_entry_kind_parses_and_rejects_unknown`: `kind: "spirits"` → `.kind == "spirits"`;
    an entry with `kind: "wine"` is skipped (absent from `entries()`), others still load.
  - `test_raw_missing_file_is_empty` and `test_raw_unreadable_or_newer_raises`
    (`{not json`, `format_version: 2`, `ingredients: {}` each raise `CatalogUnavailable`).
  - `test_save_keeps_untouched_entries_verbatim`: a file with `{"name": "salt",
    "g_per_tsp": 6.0, "note": "hand"}` and an invalid `{"name": ""}`; `save_raw(raw() +
    [{"name": "gin", "kind": "spirits"}])`; re-reading the JSON shows the first two dicts
    unchanged and the new one appended; `catalog.entry("gin").kind == "spirits"` right
    after (cache reset).
  - `test_save_keeps_other_top_level_keys`: a `"comment"` top-level key survives.
- [ ] **Step 2: Run** `uv run pytest tests/test_catalog.py -q`. Expected: the new tests
  FAIL (no `name_key`, `entry`, `raw`).
- [ ] **Step 3: Implement** the interfaces above. Seed: add
  `{"name": "soda water", "fresh": true}`, `"kind": "spirits"` on a new `white rum` entry,
  `"kind": "syrups"` on a new `simple syrup` entry (check the seed has neither already).
- [ ] **Step 4: Run** the full check. Expected: all green.
- [ ] **Step 5: Commit** `feat: catalog kinds, accent-insensitive names and a careful writer`.

### Task 2: The bar module

**Files:**
- Create: `src/app/recipes/bar.py`
- Test: `tests/test_bar.py`

**Interfaces:**
- Consumes: Task 1 (`Kind`, `KINDS`, `name_key`, `Catalog.entries/entry/raw/save_raw`,
  `CatalogUnavailable`); `RecipeStore.list("drinks")`; `atomic_write`.
- Produces:
  - `State = Literal["have", "dont"]`; `Status = Literal["can_make", "fresh_only",
    "missing", "unsorted"]`.
  - `class BarError(ValueError)`: a refusal; `str(exc)` is the sentence.
  - `class InventoryUnavailable(OSError)`: sentence
    `"The bar's inventory can't be read, so it can't be changed. Fix inventory.json on the NAS."`
  - `class BarChanges(BaseModel)` (`extra="forbid"`): `have, dont_have, unsorted, fresh,
    not_fresh, delete: list[str] = []`; `kinds: dict[str, Kind] = {}`;
    `add_names, remove_names: dict[str, list[str]] = {}`; `fold: dict[str, str] = {}`.
    A validator refuses more than 200 names in total: `"That's too many changes at once."`
  - `@dataclass BarItem`: `name: str, aliases: list[str], kind: Kind, fresh: bool,
    state: State | None, used_in: list[dict], recipe: dict | None`; `.json() -> dict`.
  - `class BarView`: `items: list[BarItem]` (sorted by `name_key`), `set_up: bool`,
    `item_for(text: str) -> BarItem | None`, `status(recipe: Recipe) -> dict`
    (`{"status", "missing", "unsorted", "fresh"}`), `ingredient(text: str) -> dict | None`
    (`{"item", "state", "fresh", "recipe"}`), `json() -> dict`
    (`{"items", "set_up", "counts": {"can_make", "fresh_only", "missing", "unsorted",
    "total"}}`, total = number of drinks).
  - `class Bar(data_dir: Path, catalog: Catalog, store: RecipeStore)`: `view() -> BarView`;
    `apply(changes: BarChanges, *, allow_delete: bool = True) -> BarView` (under a
    `threading.Lock`); `inventory_path = data_dir / "inventory.json"`.

Rules: spec "Data" in full (items, virtual items, status order, change order, conflicts,
names, fold, delete). Refusal sentences (use exactly):
- unknown name in `unsorted`, `not_fresh`, `kinds`, names, fold source or delete:
  `"There is no ‘{name}’ in the bar."`
- unknown fold target: `"There is no ‘{into}’ in the bar to fold into."`
- fold into itself: `"An item can't be folded into itself."`
- name taken: `"‘{name}’ is already an item. Fold one into the other instead."`
- removing a name the item lacks: `"‘{item}’ has no other name ‘{name}’."`;
  removing its own name: `"An item's own name can't be removed."`
- contradicting lists: `"‘{name}’ can't be changed two ways at once."`
- delete of a used item: `"Only items no drink uses can be deleted."`
- delete when `allow_delete=False`: `"Deleting isn't possible here."`
Names in sentences are as the caller wrote them.

- [ ] **Step 1: Write the failing tests** in `tests/test_bar.py`, with a helper that
  writes drink recipes through the store (see `tests/test_store_writes.py`) and a catalog
  through `Catalog.save_raw`:
  - `test_items_come_from_drinks_and_kinds`: drinks using `white rum`, `lime juice`
    (fresh in catalog), `falernum` (no entry); a catalog entry `gin` with kind and `salt`
    without → items `falernum, gin, lime juice, white rum`; falernum kind `other`;
    gin `used_in == []`; salt absent.
  - `test_ingredients_resolve_case_and_accent_insensitively`: `White Rum` in one drink,
    `white rum` in another, `Crème de violette` / `creme de violette` → two items, each
    `used_in` both drinks, names as in the first drink by name.
  - `test_alias_resolves_to_entry`: entry `white rum` aliases `["light rum"]`; a drink
    with `light rum` is in white rum's `used_in`.
  - `test_status_order`: one test per status with expected lists, including a drink with
    no ingredients → `can_make`, and `fresh` listing fresh items even when `missing`.
  - `test_syrup_recipe_link`: a `syrups`-category drink `Simple syrup` → item
    `simple syrup` has `recipe == {"slug": ..., "name": "Simple syrup"}`; others `None`.
  - `test_set_up_and_counts`.
  - `test_have_unknown_name_adds_item` (kind `other`, in the catalog file) and
    `test_fresh_unknown_name_adds_fresh_item` (no inventory key).
  - `test_fresh_clears_state_and_not_fresh_is_unsorted`.
  - `test_changes_to_virtual_item_create_catalog_entry` (kinds on `falernum`).
  - `test_add_name_taken_is_refused` (both a catalog alias and a virtual item's name) and
    `test_remove_names` (missing name, own name refused; real alias removed).
  - `test_fold_moves_names_state_and_drinks`: A `have` with g_per_tsp, B unsorted → B
    `have`, B aliases include A's name and aliases, B gets A's g_per_tsp, A gone from
    catalog and inventory, A's drinks in B's `used_in`. Plus fold into self and into
    unknown refused.
  - `test_delete_rules`: used item refused; unused hand-added item gone; an unused entry
    with g_per_tsp keeps its entry without kind; `allow_delete=False` refused.
  - `test_conflicting_lists_refused` and `test_refused_change_writes_nothing` (file
    bytes of both files unchanged after a `BarError` raised by the last change in order).
  - `test_unreadable_inventory_refuses_writes`: `{bad` in `inventory.json` → `view()` all
    unsorted; `apply(...)` raises `InventoryUnavailable`; file bytes unchanged.
  - `test_unreadable_catalog_refuses_writes` (raises `CatalogUnavailable`).
  - `test_too_many_names_refused`.
- [ ] **Step 2: Run** `uv run pytest tests/test_bar.py -q`. Expected: FAIL (no module).
- [ ] **Step 3: Implement** `src/app/recipes/bar.py`. `apply` reads `catalog.raw()` and
  the inventory strictly, mutates copies in the spec's order, raises on the first refusal,
  then writes the catalog (if changed) and the inventory (if changed). Inventory JSON:
  `{"format_version": 1, "items": {...}}` with keys sorted.
- [ ] **Step 4: Run** the full check. Expected: green.
- [ ] **Step 5: Commit** `feat: the bar: inventory, drink status and changes`.

### Task 3: REST API

**Files:**
- Modify: `src/app/api.py`, `src/app/main.py`
- Test: `tests/test_api_bar.py`

**Interfaces:**
- Consumes: Task 2 (`Bar`, `BarChanges`, `BarError`, `InventoryUnavailable`,
  `CatalogUnavailable`, `BarView.status/ingredient/json`).
- Produces: `api_routes(store, catalog, uploads, bar)` (new last parameter); `create_app`
  builds `Bar(data_dir, catalog, store)` and passes it on (Task 4 uses the same instance).
  Routes `GET /api/bar`, `POST /api/bar` (behind `write_route` like other writes; body
  through `json_object`, validation errors as 400 with the first error in a sentence, as
  other routes do). Drinks list entries and drink detail gain `bar` per the spec; food
  responses unchanged.

- [ ] **Step 1: Write the failing tests**: `test_get_bar_shape`, `test_post_bar_applies`
  (`{"have": ["gin"]}` → gin `have`, response is the bar), `test_post_bar_refusal_is_400`
  (sentence in `error`), `test_post_bar_unknown_field_is_400`,
  `test_post_bar_unreadable_inventory_is_503`, `test_drinks_list_has_bar` /
  `test_food_list_has_no_bar`, `test_drink_detail_has_ingredient_bar`.
- [ ] **Step 2: Run** `uv run pytest tests/test_api_bar.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.** One `bar.view()` per request, not per recipe.
- [ ] **Step 4: Run** the full check. Expected: green.
- [ ] **Step 5: Commit** `feat: bar API and bar status on drinks`.

### Task 4: MCP tools

**Files:**
- Modify: `src/app/mcp_server.py`, `src/app/main.py`
- Test: `tests/test_mcp_bar.py`

**Interfaces:**
- Consumes: Task 2; Task 3's `Bar` instance from `create_app`.
- Produces: `build_mcp(store, uploads, fetcher, bar)`. Tools `read_bar()` and
  `manage_inventory(have, dont_have, fresh, not_fresh, kinds, add_names, remove_names,
  fold)` (each optional, `Field(default_factory=...)` like `search_recipes`; docstring says
  what each does, that fresh items are never tracked, and that unknown names in have /
  dont_have / fresh are added). It calls `bar.apply(BarChanges(...), allow_delete=False)`
  and returns `view.json()`. Drinks entries in `list_recipes` / `search_recipes` gain
  `bar`; `search_recipes` gains `bar: Literal["can_make", "fresh_only"] | None = None`
  (food + bar → `ToolError("The bar filter is for drinks only.")`). `INSTRUCTIONS` gain:
  `" Drinks have a bar of bottles the household has or doesn't have (read_bar, manage_inventory); fresh items such as limes are never tracked."`

- [ ] **Step 1: Write the failing tests** (pattern: `tests/test_mcp_writes.py`):
  `test_read_bar`, `test_manage_inventory_sets_state`, `test_manage_inventory_refusal_is_tool_error`,
  `test_manage_inventory_has_no_delete` (the tool's input schema has no `delete`),
  `test_search_recipes_bar_filter`, `test_search_recipes_bar_filter_food_refused`,
  `test_list_recipes_drinks_have_bar`, `test_instructions_mention_bar`.
- [ ] **Step 2: Run** `uv run pytest tests/test_mcp_bar.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the full check. Expected: green.
- [ ] **Step 5: Commit** `feat: read_bar and manage_inventory for Claude`.

### Task 5: Web data layer

**Files:**
- Modify: `web/src/types.ts`, `web/src/api.ts`, `web/src/browse.ts`
- Create: `web/src/bar.ts`
- Test: `web/src/bar.test.ts`, `web/src/api.test.ts`, `web/src/browse.test.ts`

**Interfaces:**
- Consumes: Task 3's JSON.
- Produces:
  - types: `Kind`, `BarState = 'have' | 'dont'`, `DrinkStatus`, `BarItem`
    (`name, aliases, kind, fresh, state: BarState | null, used_in: {slug, name}[],
    recipe: {slug, name} | null`), `Bar` (`items, set_up, counts`), `DrinkBar`
    (`status, missing, unsorted, fresh`), `IngredientBar` (`item, state, fresh, recipe`),
    `BarChanges` (all optional; same fields as the server). `RecipeSummary.bar?: DrinkBar`,
    `Recipe.bar?`, `RecipeIngredient.bar?: IngredientBar | null`.
  - api: `getBar(): Promise<Bar>`, `changeBar(changes: BarChanges): Promise<Bar>` (via `send`).
  - bar.ts: `KINDS` (order) and `KIND_LABELS` (spec labels); `normalise(text)`;
    `matchItem(item, q): { ok: boolean; alias: string | null }`; `usedText(n)`;
    `groupByKind(items): { kind, items, have }[]` (fixed order, empty dropped);
    `shelf(items)`, `fresh(items)`, `unsorted(items)`; `nameList(names, max = 2)`
    (`"a, b"` / `"a, b +1"`); `badge(bar: DrinkBar, phone: boolean): { kind: DrinkStatus;
    text: string }` ("Can make now", "Buy fresh: x" / phone "Buy: x", "Missing: x",
    "Not sorted: x"); `topFresh(recipes): { item: string; count: number } | null`.
  - browse.ts: `BrowseState.bar: 'can' | 'fresh' | null` (URL `bar`, only on drinks;
    `browseQuery` writes it; `applyBrowse` filters `can` → `can_make`, `fresh` →
    `fresh_only`); `facetCounts` adds `bar: { all, can, fresh }` computed with every other
    filter applied but not the bar filter.

- [ ] **Step 1: Write the failing tests** for each function above (values from the spec),
  `api.test.ts` for `getBar` / `changeBar` (URL, method, body, `ApiError` sentence), and
  `browse.test.ts` for `bar` round-trip, food ignoring `bar`, filtering and counts.
- [ ] **Step 2: Run** `cd web && npm test -- --run bar api browse`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the full check. Expected: green.
- [ ] **Step 5: Commit** `feat(web): bar types, client and helpers`.

### Task 6: The bar page and the item sheet

**Files:**
- Create: `web/src/BarPage.tsx`, `web/src/BarItemSheet.tsx`, `web/src/styles/bar.css`
- Modify: `web/src/App.tsx`, `web/src/icons.tsx` (add `MinusCircle`, `Basket`, `More`),
  `web/src/main.tsx` or the stylesheet index (import `bar.css` the way others are)
- Test: `web/src/BarPage.test.tsx`, `web/src/App.test.tsx`

**Interfaces:**
- Consumes: Task 5 (`getBar`, `changeBar`, bar.ts helpers, types); `Shell`, `SearchField`
  (if it fits), `useIsDesktop`, `capitalise`.
- Produces: `BarPage` (route `/bar`, before `/:side`); `BarItemSheet({ item, bar, open,
  onClose, onChange: (changes: BarChanges) => Promise<boolean> })`.

Build to the spec's "The bar page" and "The item sheet", artboards `BarPhone`,
`BarDesktop`, `BarFirstVisitPhone`, `BarSearchEmptyPhone`, `BarItemSheetPhone`.

- [ ] **Step 1: Write the failing tests** (mock `fetch` as existing page tests do):
  - `routes /bar to the bar and /drinks/bar to the recipe` (App.test).
  - `shows the everyday subtitle and can-make card`; `shows the first-visit subtitle and progress`.
  - `toggles an item in one tap` (POST body `{"dont_have": ["campari"]}`, aria-label
    switches); `rolls back a toggle the server refuses` (alert with the sentence).
  - `sorts an unsorted item` and `marks the rest as don't have` (bulk body lists them).
  - `filters by name and alias` ("Also called light rum").
  - `offers to add a bottle with no match` (body `{"have": ["Falernum"]}`, search cleared)
    and `adds a fresh item` (`{"fresh": [...]}`).
  - `opens the item sheet` from a row; sheet tests: `adds and removes another name`,
    `changes kind`, `moves an item to fresh` (radiogroup hidden), `folds into another
    item`, `deletes an unused item`, `explains why a used item can't be deleted`.
- [ ] **Step 2: Run** `cd web && npm test -- --run BarPage App`. Expected: FAIL.
- [ ] **Step 3: Implement.** Toggle writes are optimistic; one write at a time per item.
- [ ] **Step 4: Run** the full check. Expected: green.
- [ ] **Step 5: Commit** `feat(web): the bar page and item sheet`.

### Task 7: Drinks browse with the bar

**Files:**
- Modify: `web/src/Browse.tsx`, `web/src/FilterPanel.tsx`, `web/src/RecipeCard.tsx`,
  `web/src/Shell.tsx`, `web/src/styles/browse.css`
- Test: `web/src/Browse.test.tsx`, `web/src/Shell.test.tsx`

**Interfaces:**
- Consumes: Task 5 (`BrowseState.bar`, `facetCounts().bar`, `badge`, `topFresh`,
  `getBar`); Task 6's route `/bar`.
- Produces: nothing new for later tasks.

Build to the spec's "Drinks browse" and the `Drinks*` artboards. Browse fetches
`getBar()` alongside the list on the drinks side only (for `set_up` and the unsorted
count); a failed bar fetch hides the bar UI and leaves browsing working.

- [ ] **Step 1: Write the failing tests**: `filters drinks by what the bar can make`
  (desktop radiogroup and phone chips, URL `bar=can`, counts); `food has no bar filter`;
  `shows the unsorted banner`; `shows card badges` (each of the four);
  `shows the set-up empty state`; `shows the fresh-only empty state` (copy with the top
  fresh item and its count); `shows the generic empty state`; `links to the bar` (Shell,
  drinks side only); `browsing works when the bar fails to load`.
- [ ] **Step 2: Run** `cd web && npm test -- --run Browse Shell`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the full check. Expected: green.
- [ ] **Step 5: Commit** `feat(web): drinks browse knows the bar`.

### Task 8: A drink's recipe page

**Files:**
- Modify: `web/src/RecipeView.tsx`, `web/src/Ingredients.tsx`, `web/src/styles/recipe.css`
- Test: `web/src/RecipeView.test.tsx`, `web/src/Ingredients.test.tsx`

**Interfaces:**
- Consumes: Task 5 (`changeBar`, `RecipeIngredient.bar`, `Recipe.bar`); `getRecipe` to
  reload after a bar change.
- Produces: `Ingredients` gains optional `side`, and for drinks `onBar?: (item: string,
  next: BarState | null) => Promise<boolean>`; food rendering unchanged.

Build to the spec's "A drink's recipe page", artboards `DrinkRecipePhone` and
`DrinkRecipeDesktop`. After a bar write the page re-fetches the recipe so `bar` fields
are fresh.

- [ ] **Step 1: Write the failing tests**: `shows the summary line` (missing case and
  from-your-bar case, plus buy fresh); `unsorted counts as missing in the summary`;
  `flips a bottle and undoes it` (bodies `{"dont_have": ["simple syrup"]}` then
  `{"have": [...]}`; undo of an unsorted flip sends `{"unsorted": [...]}`);
  `fresh rows have no button`; `links a syrup to its recipe` (both texts);
  `drinks stepper says drinks and stops at 12`; `food page has no bar` (Ingredients).
- [ ] **Step 2: Run** `cd web && npm test -- --run RecipeView Ingredients`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the full check. Expected: green.
- [ ] **Step 5: Commit** `feat(web): bar states on a drink's recipe page`.

### Task 9: Docs and visual check

**Files:**
- Modify: `docs/design/README.md` (artboard → component table rows for the new
  artboards; a "Built in M4" section; drop the bar from "Still not built", keeping
  Food's "Cook with what you have"; the artboard count), `docs/plan.md` (M4 done, what it
  built, the rulings), `src/app/style_guide.md` only if it lists tools (add the two).
- No test file; the check is visual.

- [ ] **Step 1:** Build and run the app (`just run` with a temp data dir and seeds), add a
  few drinks and bar states through the API, and screenshot `/bar`, `/drinks`,
  `/drinks?bar=can`, a drink page, and the item sheet at 390×844 and 1440×900 with
  Playwright (Chromium at `/opt/pw-browsers/chromium`). Compare against the artboards and
  fix any visible mismatch in the relevant component.
- [ ] **Step 2:** Update the docs.
- [ ] **Step 3: Run** the full check. Expected: green.
- [ ] **Step 4: Commit** `docs: M4 built`.
