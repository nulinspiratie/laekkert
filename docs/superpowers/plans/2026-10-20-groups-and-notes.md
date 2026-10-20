# Ingredient groups, step groups and recipe notes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recipes can group their ingredients and, separately, their steps under short
headings, and carry notes (line breaks, bold, italics, bullets) shown under the method;
the editor, Claude's tools and history all handle them.

**Architecture:** Recipe format 3 adds a `group` string to each ingredient row and to each
step (steps become `{text, group}` objects) plus a `notes` string, with a 2 → 3 migration.
The web client turns a flat list into consecutive runs with one shared helper, renders notes
through a pure parser (no HTML), and edits groups as heading rows inside the editor's lists.

**Tech Stack:** Python 3 / Starlette / pydantic / MCP SDK; React + TypeScript + Vitest in
`web/`.

**Spec:** `docs/superpowers/specs/2026-10-20-groups-and-notes-design.md`

## Global Constraints

- `FORMAT_VERSION = 3`. Group names at most 60 characters (`GROUP_MAX`), notes at most
  5000 (`NOTES_MAX`). `""` is no group.
- Refusals verbatim: `A group name can be at most 60 characters`,
  `The notes can be at most 5000 characters`.
- History lines verbatim, curly quotes included: `notes added`, `notes removed`,
  `notes changed`, `<item> moved to “B”`, `<item> moved out of “A”`,
  `<item> moved from “A” to “B”`, `step N moved to “B”` (and the other two forms),
  `group “A” → “B”`.
- A recipe with no groups and no notes renders exactly as before, on every screen.
- Notes are never rendered as HTML: no `dangerouslySetInnerHTML`, no Markdown library.
- British spelling in comments, docs and copy. Theme tokens only, no hard-coded colours.
  Touch targets at least 44 px.
- Checks before every commit: `just lint` and `just test`; for web tasks also, in `web/`,
  `npm run build`.
- Commits end with the session trailer lines the controller gives you. No model names in
  any file.
- Never push to `main`; the branch is `ccr-ec7f95e1-7y3w3n`.

## Review Focus

1. A recipe whose `versions/0001.json` is format 2 with string steps is restored from
   History: the restore works and the recipe is saved as format 3. (Task 1 test.)
2. A grouped recipe is opened in the editor and saved without changes: ingredients, steps,
   groups and notes come back identical and no edit entry is written. (Task 7 test.)
3. A drink with grouped ingredients: tapping the bar button on a row in the second group
   flips that row's item, and its undo bar shows under that row. (Task 6 test.)
4. Notes containing `<b>hi</b>` or `<img src=x onerror=alert(1)>` show as literal text.
   (Task 5 test.)
5. Claude edits only `notes` (or only `name`) on a grouped recipe: groups survive the
   `merged` draft path untouched. (Task 4 test.)

---

### Task 1: Recipe format 3

**Files:**
- Modify: `src/app/recipes/model.py`
- Modify: `src/app/seed/recipes/*/*/recipe.json` (four files)
- Test: `tests/test_recipe_model.py`, `tests/test_store_writes.py`
- Update existing tests that build `Recipe(...)` / `Recipe.model_validate` with string
  steps or `format_version` 2 (`tests/test_diff.py` `make()`, `tests/test_bar.py`,
  `tests/test_have.py`, anything `just test` shows failing for this reason).

**Interfaces:**
- Produces: `GROUP_MAX = 60`, `NOTES_MAX = 5000`, `FORMAT_VERSION = 3`;
  `Ingredient.group: str = Field("", max_length=GROUP_MAX)`;
  `class Step(BaseModel)` (`extra="forbid"`, `text: str = Field(min_length=1)`,
  `group: str = Field("", max_length=GROUP_MAX)`); `Recipe.steps: list[Step] = []`;
  `Recipe.notes: str = Field("", max_length=NOTES_MAX)` (declared right after `steps`);
  `MIGRATIONS[2] = _migrate_2_to_3`.

- [ ] **Step 1: Write the failing tests** in `tests/test_recipe_model.py`:
  - `test_v2_string_steps_migrate`: `parse_recipe(valid(steps=["Shake.", "Strain."]))`
    (helper still writes `format_version: 2`) → `r.format_version == 3`,
    `[s.text for s in r.steps] == ["Shake.", "Strain."]`, every `s.group == ""`,
    `r.notes == ""`, `r.ingredients[0].group == ""`.
  - `test_v1_file_migrates_to_3`: a format 1 dict with `marks: ["kid_approved"]` and string
    steps → format 3, tag `kid approved` added, steps are `Step`s.
  - `test_v3_groups_and_notes_parse`: format 3 with `ingredients[0].group == "Sauce"`,
    `steps == [{"text": "Stir.", "group": "Day before"}]`, `notes == "Keeps 3 days."`.
  - `test_bad_steps_shape_is_refused`: format 2 with `steps: [1]` → `ValidationError`.
  - `test_group_and_notes_limits`: group of 61 characters, or notes of 5001 →
    `ValidationError`; 60 / 5000 parse.
  - `test_seed_recipes_are_format_3`: every seed `recipe.json` loads as `json` with
    `format_version == 3` and steps as objects, and parses.
  - In `tests/test_store_writes.py`, `test_restore_of_v2_snapshot`: write a recipe folder
    whose `recipe.json` and `versions/0001.json` are format 2 with string steps, restore
    version 1 through the store, then read `recipe.json` from disk: `format_version == 3`,
    steps are objects. (Use the restore entry point the file's other restore tests use.)

- [ ] **Step 2: Run them:** `uv run pytest tests/test_recipe_model.py tests/test_store_writes.py -q` → the new tests FAIL.

- [ ] **Step 3: Implement** the Interfaces above in `model.py`. `_migrate_2_to_3(data)`:
  when `steps` is a list, each `str` item becomes `{"text": item}`, other items are left
  for validation; returns `{**data, "steps": ..., "format_version": 3}`. Update the
  `SUMMARY_FIELDS` comment to name notes. Convert the four seed files: `"format_version": 3`
  and each step `{"text": "..."}`, keeping their one-row-per-line layout; no groups or
  notes added.

- [ ] **Step 4: Update the existing tests** that fail only because steps are strings in a
  directly validated `Recipe` (e.g. `make()` in `tests/test_diff.py` →
  `"steps": [{"text": "Shake"}, …]`, and its call sites `make(steps=[...])` via a small
  `steps(*texts)` helper) or because a hand-built dict says format 2 where it bypasses
  `parse_recipe`. Do not change what any test asserts beyond the steps' shape.

- [ ] **Step 5: Run** `just test` (Python part may be run alone with `uv run pytest -q`).
  Anything still failing belongs to Task 2 or 3 only if it compares API/draft output steps
  with strings; leave those for Task 2 and note them. Then `just lint`.

- [ ] **Step 6: Commit** `feat(format): recipe format 3 with groups and notes`.

### Task 2: Drafts and the HTTP API

**Files:**
- Modify: `src/app/recipes/drafts.py`
- Test: `tests/test_drafts.py`, `tests/test_api_writes.py` (update string-step
  expectations there and in `tests/test_api_bar.py`, `tests/test_store_writes.py`)

**Interfaces:**
- Consumes: Task 1's `Step`, `GROUP_MAX`, `NOTES_MAX`.
- Produces: `DraftIngredient.group: str = ""` (with a `description` saying what a group
  is, pointing to the style guide); `class DraftStep(BaseModel)` (`extra="forbid"`,
  `text: str`, `group: str = ""`, same description); `RecipeDraft.steps:
  list[str | DraftStep]`; `RecipeDraft.notes: str = ""`.

- [ ] **Step 1: Write the failing tests** in `tests/test_drafts.py` (use its `GOOD` /
  `to_recipe` helpers):
  - `test_groups_are_kept_and_tidied`: ingredient `group="  Garlic   sauce "` →
    `"Garlic sauce"`; step `{"text": " Stir ", "group": " Day before"}` →
    `Step(text="Stir", group="Day before")`.
  - `test_string_and_object_steps_mix`: `steps=["Boil", {"text": "Serve", "group": "To
    serve"}]` → `[("Boil", ""), ("Serve", "To serve")]`.
  - `test_blank_step_is_dropped_with_its_group`: `{"text": "  ", "group": "Sauce"}` gone.
  - `test_notes_are_tidied`: `"  **Keeps** well.  \r\n\r\n- a  \r\n"` →
    `"**Keeps** well.\n\n- a"`; blank lines inside kept.
  - `test_notes_default_to_empty`: a draft without `notes` → `recipe.notes == ""`.
  - `test_group_name_too_long`: 61-character group on an ingredient, and on a step →
    `ValueError("A group name can be at most 60 characters")`; 60 is fine.
  - `test_notes_too_long`: 5001 characters after tidying →
    `ValueError("The notes can be at most 5000 characters")`.
  - Keep `({**GOOD, "steps": [1, 2]}, "The recipe isn't valid")` passing.
  - In `tests/test_api_writes.py`, `test_put_keeps_groups_and_notes`: PUT a draft with a
    grouped ingredient, grouped step and notes; the response and a following GET have
    `ingredients[0]["group"]`, `steps == [{"text": ..., "group": ...}]` and `notes`.

- [ ] **Step 2: Run** `uv run pytest tests/test_drafts.py tests/test_api_writes.py -q` →
  new tests FAIL.

- [ ] **Step 3: Implement** in `drafts.py`: `_group(name: str) -> str` (collapse
  whitespace with `" ".join(name.split())`, raise the group refusal over `GROUP_MAX`),
  `_steps(steps: list[str | DraftStep]) -> list[Step]` (a `str` is `DraftStep(text=s)`;
  strip text; drop blank), `_notes(notes: str) -> str` (`splitlines()`, `rstrip()` each,
  join with `\n`, `strip()`, raise the notes refusal over `NOTES_MAX`). `_row` passes
  `group=_group(row.group)`; `to_recipe` passes `steps=_steps(...)`, `notes=_notes(...)`.
  The refusals are plain `ValueError`s raised outside any `except ValidationError`.

- [ ] **Step 4: Update** the existing API/store/bar tests that compare returned `steps`
  with strings to compare with `{"text": ..., "group": ""}` objects (requests may keep
  sending strings: that is supported).

- [ ] **Step 5: Run** `just test` and `just lint` → PASS.

- [ ] **Step 6: Commit** `feat(drafts): groups and notes in drafts and the API`.

### Task 3: History diff

**Files:**
- Modify: `src/app/recipes/diff.py`, `src/app/recipes/timeline.py` (`Change.section`
  gains `"notes"`)
- Test: `tests/test_diff.py`

**Interfaces:**
- Consumes: Task 1's `Step`.
- Produces: `describe_changes` emits sections in this order: details, ingredients,
  method, notes, source, tags, photo. Lines as in Global Constraints.

- [ ] **Step 1: Write the failing tests** in `tests/test_diff.py` (with `ing(...,
  group=...)` and a step helper):
  - `test_notes_added_removed_changed`: `""→"x"` → `[("notes", "added", "notes added")]`;
    `"x"→""` → removed; `"x"→"y"` → `("notes", "changed", "notes changed")`.
  - `test_ingredient_moved_between_groups`: lime juice `"" → "Sour mix"` while gin stays
    `""` → `("ingredients", "changed", "lime juice moved to “Sour mix”")`; the reverse →
    `"lime juice moved out of “Sour mix”"`; `"A" → "B"` with another row staying in `"A"`
    → `"lime juice moved from “A” to “B”"`.
  - `test_group_rename_is_one_line`: both rows `"Sauce"` → both `"Garlic sauce"` →
    exactly `[("ingredients", "changed", "group “Sauce” → “Garlic sauce”")]`.
  - `test_step_group_move_is_not_an_edit`: same texts, step 2's group `"" → "To serve"` →
    exactly `[("method", "changed", "step 2 moved to “To serve”")]`.
  - `test_step_group_rename`: all steps `"Day before"` → `"The day before"` → one line
    `group “Day before” → “The day before”` in `method`.
  - `test_step_text_change_still_reported`: as the existing step tests, with objects.
  - In `tests/test_timeline.py` (or wherever `Change` is validated):
    `Change(section="notes", kind="changed", text="notes changed")` is valid.

- [ ] **Step 2: Run** `uv run pytest tests/test_diff.py -q` → new tests FAIL.

- [ ] **Step 3: Implement** in `diff.py`:
  - `_renames(moves: list[tuple[str, str]], old: set[str], new: set[str]) -> dict[str, str]`:
    for each group in `old - new - {""}`, the set of new groups its matched rows went to;
    when that is exactly one group that is not in `old` and not `""`, it is a rename.
  - `_moved(what: str, a: str, b: str) -> str` for the three move wordings.
  - `_ingredients`: rename lines first, then per matched pair the existing row changes plus
    a move line when the group changed and the change isn't explained by a rename.
  - `_method`: `SequenceMatcher` over step **texts**; the `equal` opcodes give the kept
    pairs; rename lines and move lines (`step <new number>`) first, then the existing
    changed/added/removed lines, which now take a `Step` (`_step(number, step)` uses
    `step.text`).
  - `_notes(old, new)` via the existing `_swap` with the three notes wordings, section
    `notes`.

- [ ] **Step 4: Run** `just test` and `just lint` → PASS.

- [ ] **Step 5: Commit** `feat(history): group moves, renames and notes in the diff`.

### Task 4: Claude's tools and the style guide

**Files:**
- Modify: `src/app/mcp_server.py`, `src/app/style_guide.md`
- Test: `tests/test_mcp_writes.py`, `tests/test_mcp.py`

**Interfaces:**
- Consumes: Task 2's `DraftStep`, `DraftIngredient.group`, `RecipeDraft.notes`.
- Produces: `NewRecipe.steps: list[str | DraftStep]`, `NewRecipe.notes: str = ""`;
  `RecipeChanges.steps: list[str | DraftStep]` (default `None` like its siblings),
  `RecipeChanges.notes: str` (default `None`; `""` clears).

- [ ] **Step 1: Write the failing tests** in `tests/test_mcp_writes.py` (follow its
  add/edit helpers):
  - `test_add_with_groups_and_notes`: `add_recipe` with a grouped ingredient, steps
    `["Boil.", {"text": "Serve.", "group": "To serve"}]`, `notes="**Keeps** 3 days."` →
    `read_recipe` returns them as stored.
  - `test_edit_notes_keeps_groups` (Review Focus 5): recipe added with groups; `edit_recipe`
    with only `{"notes": "x"}` → groups on ingredients and steps unchanged; then with only
    `{"name": "New"}` → groups and notes unchanged.
  - `test_edit_notes_empty_clears`: `{"notes": ""}` → `notes == ""`.
  - In `tests/test_mcp.py`: the `add_recipe` / `edit_recipe` input schemas mention `group`
    and `notes`; `get_style_guide` text contains the headings `## Groups` and `## Notes`.

- [ ] **Step 2: Run** `uv run pytest tests/test_mcp.py tests/test_mcp_writes.py -q` → FAIL.

- [ ] **Step 3: Implement**:
  - `NewRecipe` / `RecipeChanges` fields as in Interfaces; descriptions: steps are "a
    string, or text and group for a recipe in parts"; notes are "shown under the method:
    tips, variations, storage; new lines are kept, **bold**, *italic* and '- ' bullets"
    (`RecipeChanges.notes`: "replacing the old ones; an empty string clears them").
    `RecipeChanges` docstring: lists replace the whole list, "groups included".
  - `read_recipe` docstring: ingredients and steps each have a group (`""` for none), the
    part of the recipe they belong to; notes are tips shown under the method.
  - `style_guide.md`: a `## Groups` section after Ingredients and a `## Notes` section after
    Method, with the content of the spec's "Claude (MCP) and the style guide" (independent
    ingredient and step groups, by what or by when, short sentence-case names without "For
    the", rows without a group first, a group's rows together, a row per part for a shared
    ingredient; notes for what isn't a step, `**bold**`, `*italic*`, "- " bullets, nothing
    else, empty when there's nothing to say).

- [ ] **Step 4: Run** `just test` and `just lint` → PASS.

- [ ] **Step 5: Commit** `feat(mcp): groups and notes for Claude, and the style guide`.

### Task 5: Web model, runs and the notes parser

**Files:**
- Modify: `web/src/types.ts`, `web/src/timeline.ts`
- Create: `web/src/groups.ts`, `web/src/groups.test.ts`, `web/src/notes.ts`,
  `web/src/notes.test.ts`, `web/src/Notes.tsx`
- Test: `web/src/timeline.test.ts`; fixtures in existing web tests get `group: ''`,
  `{text, group}` steps and `notes: ''` where TypeScript requires them.

**Interfaces:**
- Produces (types.ts): `Ingredient.group: string`; `export interface Step { text: string;
  group: string }`; `Recipe.steps: Step[]`; `Recipe.notes: string`; `Change['section']`
  adds `'notes'`; `RecipeDraft.steps: Step[]`; `RecipeDraft.notes: string`
  (`DraftIngredient` inherits `group`).
- Produces (groups.ts): `export interface Run<T> { group: string; start: number; items: T[] }`
  and `export function runs<T extends { group: string }>(items: T[]): Run<T>[]`:
  consecutive items with equal `group`; `start` is the index of the run's first item in
  `items`.
- Produces (notes.ts): `export interface Span { text: string; bold: boolean; italic: boolean }`,
  `export type Block = { kind: 'paragraph'; lines: Span[][] } | { kind: 'list'; items: Span[][] }`,
  `export function parseInline(line: string): Span[]`,
  `export function parseNotes(text: string): Block[]`.
- Produces (Notes.tsx): `export function Notes({ text }: { text: string })`: `null` for
  blank text, else `<section className="notes" aria-labelledby=…>` with `<h2>Notes</h2>`,
  a `<p>` per paragraph (lines joined by `<br />`), a `<ul>` per list, `<strong>`/`<em>`
  for spans.

- [ ] **Step 1: Write the failing tests:**
  - `groups.test.ts`: `runs([])` → `[]`; all `''` → one run `{group: '', start: 0}`;
    `['', 'A', 'A', 'B']` → starts `0, 1, 3`; `['A', 'B', 'A']` → three runs.
  - `notes.test.ts` (`parseInline`): `'**Keep** it'` → `[{text:'Keep',bold:true,italic:false},
    {text:' it',…false,false}]`; `'*soft*'` → italic; `'***both***'` → bold and italic;
    `'2 * 3 * 4'`, `'5*'`, `'** a**'`, `'**open'` → one plain span equal to the input;
    `'a **b** c *d*'` → four spans in order.
  - `notes.test.ts` (`parseNotes`): `'a\nb\n\nc'` → two paragraphs, first with two lines;
    `'- x\n* y\n• z'` → one list of three items with markers dropped; `'  - x'` → a list
    item; `'- x\n\n- y'` → two lists; `'intro\n- x\nafter'` → paragraph, list, paragraph;
    blank or whitespace text → `[]`.
  - `Notes` render test (in `notes.test.ts` with Testing Library, or a `Notes.test.tsx`):
    bold and italic become `strong`/`em`; `'<b>hi</b>'` and `'<img src=x onerror=alert(1)>'`
    appear as literal text and the DOM has no `b`/`img` element (Review Focus 4); `''`
    renders nothing.
  - `timeline.test.ts`: an edit with sections `method` and `notes` reads
    `Edited method and notes`.

- [ ] **Step 2: Run** `cd web && npx vitest run src/groups.test.ts src/notes.test.ts src/timeline.test.ts` → FAIL.

- [ ] **Step 3: Implement.** `parseInline` scans with this regex and emits the text between
  matches as plain spans:

  ```ts
  // Bold first (longest marker first), then italics; content may not start or end with a
  // space or a star, so "2 * 3 * 4" and a lone "*" stay as written.
  const INLINE = /(\*\*\*|\*\*|\*)(?![\s*])(.+?)(?<![\s*])\1/g
  ```

  `***` → bold + italic, `**` → bold, `*` → italic. `parseNotes` splits on `\n`; a line
  matching `/^\s*[-*•]\s+(.*)$/` is a bullet (but a line starting `**` or `*word*` is
  text: require whitespace after the marker, which the regex does); blank lines end the
  current block. `timeline.ts`: `SECTIONS` gets `'notes'` after `'method'`.

- [ ] **Step 4: Fix fixtures** in existing web tests for the new required fields; run
  `cd web && npm test && npm run lint && npm run build` → PASS.

- [ ] **Step 5: Commit** `feat(web): recipe groups model, runs helper and notes parser`.

### Task 6: The recipe page

**Files:**
- Modify: `web/src/Ingredients.tsx`, `web/src/RecipeView.tsx`, `web/src/styles/recipe.css`
- Test: `web/src/Ingredients.test.tsx`, `web/src/RecipeView.test.tsx`

**Interfaces:**
- Consumes: `runs`, `Run` (Task 5), `Notes` (Task 5), `Step`.
- Produces: `Method({ steps }: { steps: Step[] })`; group headings are
  `<h3 className="group-heading">`; a no-group run after a group gets
  `<hr className="group-rule" />` instead.

- [ ] **Step 1: Write the failing tests:**
  - `Ingredients.test.tsx`: ungrouped rows → no `h3`, one list (unchanged DOM: the
    existing tests still pass). Grouped `['', 'Marinade', 'Marinade', 'Sauce']` → headings
    `['Marinade', 'Sauce']` (role heading level 3), the first row has no heading above it,
    each run is its own list; scaling to 8 servings changes rows in every group.
  - `Ingredients.test.tsx` drink (Review Focus 3): rows `[gin ('' group), lime juice
    ('Sour mix'), sugar syrup ('Sour mix')]` with `onBar`; click the state button of
    sugar syrup → `onBar` called with sugar syrup's item, and the Undo status appears in
    sugar syrup's list item.
  - `Ingredients.test.tsx`: rows `Marinade, Marinade, ''` → one heading and one
    `separator` (the `hr`).
  - `RecipeView.test.tsx`: steps in groups `['', 'Day before', 'Day before', 'To serve']`
    → numbers read `1, 2, 3, 4` across the lists, headings `Day before`, `To serve`;
    the existing ungrouped method test passes unchanged.
  - `RecipeView.test.tsx`: `notes: '**Make ahead:** 3 days'` → a "Notes" region after
    the method, before the source, with a `strong`; `notes: ''` → no "Notes" heading.

- [ ] **Step 2: Run** `cd web && npx vitest run src/Ingredients.test.tsx src/RecipeView.test.tsx` → FAIL.

- [ ] **Step 3: Implement.** `Ingredients` maps `runs(ingredients)`; inside each run the
  row index is `run.start + k`, used everywhere the current `i` is (keys, `asked`,
  `pending`, `flip`, `buttons`). Heading when `run.group !== ''`; `hr` when the group is
  `''` and `run.start > 0`. `Method` maps `runs(steps)` with one `ol` per run and the badge
  number `run.start + k + 1` (set `start` on the `ol` too). `RecipeView` renders
  `<Notes text={recipe.notes} />` between `Method` and `Source`. CSS in `recipe.css`:
  `.group-heading` (13 px, weight 700, letter-spacing 0.08em, uppercase,
  `color: var(--accent-ink)`, `border-bottom: 1px solid var(--border)`, `padding-bottom:
  6px`, margin 20 px above, 4 px for the first), `.group-rule` (same rule, no text),
  `.notes` (section like `.method`; `h2` shares the `.method h2` rule; body 17 px, line
  height 1.55; `ul` with normal bullets and 20 px indent; a top rule
  `1px solid var(--border)` and 20 px padding above). Check the drinks theme by eye in the
  screenshot task.

- [ ] **Step 4: Run** `cd web && npm test && npm run lint && npm run build` → PASS.

- [ ] **Step 5: Commit** `feat(web): group headings and notes on the recipe page`.

### Task 7: Editor state

**Files:**
- Modify: `web/src/editor.ts`
- Create: `web/src/noteTools.ts`, `web/src/noteTools.test.ts`
- Test: `web/src/editor.test.ts`

**Interfaces:**
- Consumes: `Step`, `RecipeDraft`, `runs` (Task 5).
- Produces (editor.ts):
  - `export interface EditorHeading { key: string; kind: 'group'; name: string }`
  - `export type IngredientEntry = EditorRow | EditorHeading`,
    `export type StepEntry = EditorStep | EditorHeading`
  - `EditorState.rows: IngredientEntry[]`, `EditorState.steps: StepEntry[]`,
    `EditorState.notes: string`
  - `export function isHeading(entry: IngredientEntry | StepEntry): entry is EditorHeading`
  - `export function blankHeading(): EditorHeading`
  - `export function grouped<T>(entries: (T | EditorHeading)[]): { entry: T; group: string }[]`:
    each non-heading entry with the whitespace-collapsed name of the nearest heading above
    it, `''` when there is none or it is blank.
- Produces (noteTools.ts), all pure, `start`/`end` are the textarea selection:
  - `export interface Edit { text: string; start: number; end: number }`
  - `export function wrap(text: string, start: number, end: number, marker: '**' | '*'): Edit`
  - `export function toggleBullets(text: string, start: number, end: number): Edit`

- [ ] **Step 1: Write the failing tests:**
  - `editor.test.ts` `stateFromRecipe`: ingredients `['', 'A', 'A', '']` → entries
    `row, heading 'A', row, row, heading '' , row`; ungrouped recipe → no headings (as
    today); steps likewise; `notes` copied.
  - `editor.test.ts` round trip (Review Focus 2): for a recipe with ingredient groups
    `['', 'Marinade', 'Marinade', 'Sauce', '']`, step groups `['Day before', 'To serve']`
    and notes, `toDraft(stateFromRecipe(r))` has the same items, groups, step texts and
    notes as `r`; `isDirty(stateFromRecipe(r), stateFromRecipe(r))` is false.
  - `toDraft`: a heading `'  Sauce  x '` gives its rows `group: 'Sauce x'`; a blank
    heading ends the group; rows above the first heading get `''`; headings with no rows
    under them vanish; steps are sent as `{text, group}`; `notes` sent as typed.
  - `validate`: ingredient numbering skips headings (`[heading, blank-named row]` →
    `Ingredient 1 needs a name`); a heading name of 61 characters →
    `A group name can be at most 60 characters`; notes over 5000 →
    `The notes can be at most 5000 characters`.
  - `emptyState` has `notes: ''` and no headings.
  - `noteTools.test.ts`: `wrap('a soft b', 2, 6, '*')` → `{text: 'a *soft* b', start: 3,
    end: 7}`; `wrap('ab', 1, 1, '**')` → `{text: 'a****b', start: 3, end: 3}`;
    `toggleBullets('x\ny', 0, 3)` → `'- x\n- y'` with the selection covering both lines;
    applied again → back to `'x\ny'`; a selection inside one line of three bullets only
    that line; mixed lines (one has `- `) → all get it.

- [ ] **Step 2: Run** `cd web && npx vitest run src/editor.test.ts src/noteTools.test.ts` → FAIL.

- [ ] **Step 3: Implement** the Interfaces. `stateFromRecipe` inserts a heading before the
  first item of each run from `runs(...)` (Task 5) whose group is non-empty, and a blank
  heading before a `''` run that isn't first. `toDraft` uses `grouped` and drops blank
  rows/steps as today. `validate` counts only rows for numbers and checks headings and
  notes length with the server's sentences. `content()` (for `isDirty`) strips keys from
  headings too.

- [ ] **Step 4: Run** `cd web && npm test && npm run lint && npm run build` → PASS.

- [ ] **Step 5: Commit** `feat(web): editor state for groups and notes`.

### Task 8: Editor screen

**Files:**
- Modify: `web/src/Editor.tsx`, `web/src/styles/editor.css`
- Test: `web/src/Editor.test.tsx`

**Interfaces:**
- Consumes: Task 7's `EditorHeading`, `isHeading`, `blankHeading`, `blankRow`, `blankStep`,
  `wrap`, `toggleBullets`.
- Produces: `MoveButtons` takes `first: boolean` and `what: 'ingredient' | 'step' |
  'group'`; labels for a heading `Move group up`, `Move group down`, `Remove group`
  (suffix with the group's name when it has one: `Move group Sauce up`).

- [ ] **Step 1: Write the failing tests** in `web/src/Editor.test.tsx` (its fetch helpers):
  - Ingredients "Add group" → a text box labelled `Group name` gets focus and one blank
    ingredient row follows it; typing `Sauce` and filling the row then Save → the PUT has
    that row with `group: 'Sauce'`.
  - Steps "Add group" does the same for steps; the PUT's `steps` are `{text, group}`.
  - Moving a heading down past a row moves that row out of the group (PUT groups
    reflect it); removing a heading merges its rows into the group above.
  - Row labels count rows only: with a heading first, the first row's input is
    `Ingredient 1`.
  - Loading a grouped recipe shows headings with their names; Save without changes sends
    a PUT (as the editor does today) whose ingredients, steps and notes equal the
    recipe's, groups included.
  - Notes: a `Notes` textarea; select `soft` in `a soft b` and click `Italic` → value
    `a *soft* b`; `Bold` likewise with `**`; `List` on two lines adds `- `; the PUT
    contains `notes`.

- [ ] **Step 2: Run** `cd web && npx vitest run src/Editor.test.tsx` → FAIL.

- [ ] **Step 3: Implement.**
  - `Ingredients` and `Steps` render a heading entry as `<li className="ed-group">` with a
    text input (`aria-label="Group name"`, placeholder `Group name (none)`) and
    `MoveButtons`; row/step numbers count non-heading entries.
  - Under each list, next to "Add ingredient" / "Add step", an "Add group" button
    (`ed-add`, Plus icon) appends `blankHeading()` + a blank row/step and focuses the
    heading's input (a ref keyed by the new heading's key).
  - `MoveButtons` disables up on `first` instead of `number === 1`.
  - A `NotesSection` card after Steps in both layouts (`<h2>Notes</h2>`): a toolbar
    (`role="toolbar"`, `aria-label="Notes formatting"`) with buttons `Bold`, `Italic`,
    `List` (44 px targets, text labels or icon + `aria-label`), a `textarea` labelled
    `Notes` with `rows={6}`, and the hint
    `New lines are kept. **bold**, *italic*, and - at the start of a line for a bullet.`
    Each button reads `selectionStart`/`selectionEnd`, applies `wrap`/`toggleBullets`,
    sets `notes`, then restores focus and the selection after the update (an effect or
    `requestAnimationFrame`). Buttons use `onMouseDown={e => e.preventDefault()}` so the
    textarea keeps its selection on desktop.
  - CSS in `editor.css`: `.ed-group` row (input full width, accent-ink bold text,
    border-bottom like the recipe page's heading), `.ed-notes-tools`, `.ed-notes textarea`
    sized like the step textareas.

- [ ] **Step 4: Run** `cd web && npm test && npm run lint && npm run build`, then
  `just lint && just test` → PASS.

- [ ] **Step 5: Commit** `feat(web): edit groups and notes`.

### Task 9: Docs, screenshots, final review, PR (controller)

- [ ] `docs/plan.md`: a short "Groups and notes" entry (format 3, what was built).
- [ ] `docs/design/README.md`: a `screenshots/groups/` paragraph like M5's.
- [ ] Screenshots in `docs/design/screenshots/groups/` with Playwright against `just run`
  (Chromium at `/opt/pw-browsers/chromium`) from a scratch data directory with the seed
  recipes plus one grouped food recipe with notes (the mockup's shawarma) and one grouped
  drink: `recipe-groups-phone` (390 wide, full page), `recipe-groups-desktop` (1440),
  `editor-groups-phone`, `editor-groups-desktop`, `drink-groups-phone`.
- [ ] Final whole-branch review, fixes.
- [ ] Ask Serwan before opening the PR. PR to `main` with the rollback caveat from the
  spec ("Deploying and rollback": format 3 recipes refused and notes-edit History entries
  hidden under an older image) and the screenshots.
