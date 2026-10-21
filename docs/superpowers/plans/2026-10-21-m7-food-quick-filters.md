# M7: Food quick filters — Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Food page shows category tabs (All, Mains, Sides, …) and quick tag chips
(Breakfast, Dinner, Kid approved, Quick, Vegetarian) at the top, on phone and desktop, each
with the count it would leave, so any category or quick tag is one tap away.

**Architecture:** The quick tag list is a setting (`food_quick_tags`) served by a new
`GET /api/settings`. The client works out the rows in one pure function, `quickFilters` in
`web/src/browse.ts`, from the recipes the page already loaded, the browse state and the
setting. A new `QuickFilters.tsx` draws them. `Browse.tsx` places them, `FilterPanel.tsx`
drops Category and turns Tags into More tags on food. The URL stays the single source of
truth (`cat=`, `tag=`), so no new query parameters.

**Tech Stack:** Python 3 / Starlette, pytest. React 19 + TypeScript + Vite, vitest +
Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-21-food-quick-filters-design.md` (it wins on copy
and behaviour). Mockup: https://claude.ai/artifact/1eUEjNeCfEpVHnt3eZzdwr

## Global Constraints

- Every repo convention in `CLAUDE.md` holds. Before each commit:
  `uv run ruff check .`, `uv run ruff format --check .`, `uv run scripts/handoff.py --check`,
  `uv run pytest`, `cd web && npm run lint && npm test`.
- Drinks does not change: no settings request, no quick rows, same sheet and sidebar.
- Food tokens only in CSS (`--bg`, `--surface`, `--border`, `--border-strong`, `--muted`,
  `--label`, `--accent`, `--accent-ink`, `--accent-soft`, `--accent-soft-ink`,
  `--on-accent`); no new colours. 44 px tap targets; on is never colour alone (check icon).
- Exact copy: tabs `All`, `Mains`, …; chips capitalise the first letter (`Kid approved`);
  chip accessible name `{Label}, {n} recipe(s)` when off, `{Label}` when on; groups
  `Category` (radiogroup) and `Quick tags` (group); `More`; `Clear`; sheet and sidebar
  section `More tags`.

## Decisions made while planning

1. **Phone placement.** The spec puts the rows in `PageHeading`'s `below` slot. A sticky
   element only sticks inside its parent, and `.page-heading` ends right under the rows, so
   they could never stick there. On phone the rows render as the next sibling of
   `PageHeading` instead: same place on screen, and their parent (`.browse--phone`) spans the
   page, so `position: sticky` works. Recorded under "Differences from the design".
2. **Which recipes count.** Everything is counted on the list the page loaded (already cut
   down by the search and What you have, as the sidebar is today). A category or quick tag
   with no recipe in that list is left out, unless it is on (so it can be undone).
3. **Spelling.** A setting entry matches recipe tags by `normalise`. The chip filters on the
   most common matching spelling (ties: the first in A–Z order). If no loaded recipe has
   it but a `tag=` in the URL matches by key, that tag is the chip, on. Quickness is then by
   exact spelling, the way the filter itself compares.
4. **More on desktop** focuses the sidebar's More tags heading. With no other tags there is
   no such section, so desktop shows no More then (phone always shows it: the sheet still
   has Marks and Sort).
5. **Before settings arrive** the chip row is not drawn; the badge and More tags use the
   default list meanwhile. A failed or malformed response means the default list.
6. **"Stuck"** is detected with an `IntersectionObserver` on a zero-height sentinel above
   the rows (skipped where it does not exist, e.g. jsdom).

## Tasks

### Task 1: Setting and API

- [ ] `src/app/config.py`: `food_quick_tags: tuple[str, ...] = ("breakfast", "dinner",
  "kid approved", "quick", "vegetarian")`; `load_settings` turns TOML lists into tuples.
- [ ] `config.example.toml`: the key with its comment (spec text).
- [ ] `src/app/api.py`: `api_routes(..., settings)`; `GET /api/settings` →
  `{"food_quick_tags": [...]}`, before the catch-all. `main.py` passes `settings`.
- [ ] Tests: `tests/test_health.py` (TOML list → tuple equal to `Settings(...)`, unknown key
  still ignored, example matches defaults); `tests/test_api.py` (default list; configured
  list via `create_app(Settings(food_quick_tags=(...)))`).

### Task 2: Web data layer

- [ ] `types.ts`: `Settings { food_quick_tags: string[] }`.
- [ ] `api.ts`: `getSettings()`; a body without a string array falls back to the default.
- [ ] `browse.ts`: `DEFAULT_QUICK_TAGS`; `quickTagSpellings(recipes, tags, quickTags)`;
  `quickFilters(recipes, state, quickTags)` → `{ tabs, chips, active }` where a tab is
  `{ category: string | null, label, count, on, disabled }` and a chip is
  `{ tag, label, count, on, disabled, quick }`; `moreTags(allTags, onTags, quick)`.
- [ ] `browse.test.ts`: the cases in the spec's Tests section.

### Task 3: QuickFilters component and styles

- [ ] `QuickFilters.tsx`: tabs radiogroup, chips group, More, Clear; `aria-disabled` items
  ignore clicks; `desktop` switches wrap vs scroll and sticky.
- [ ] `styles/browse.css`: `.quick-filters`, `.quick-tabs`, `.quick-tab`, `.quick-chips`,
  `.quick-chip`, `--more`, `--other`, `.quick-clear`; phone scroll, `mask-image` fade,
  sticky with `.is-stuck` hairline and shadow; desktop wraps.

### Task 4: Browse, FilterPanel

- [ ] `Browse.tsx` (food only): load settings; rows on phone after `PageHeading`, on desktop
  between heading and `Chips`; badge = marks + non-quick tags on; `Chips` shows marks only
  on food; More opens the sheet (phone) or focuses More tags (desktop); Clear keeps
  `q`, `mark`, `sort`, `have`.
- [ ] `FilterPanel.tsx`: `quickTags?: string[]` prop. Food: no Category; Tags →
  More tags (`moreTags`), left out when empty. Drinks unchanged.
- [ ] `Browse.test.tsx`: update tests that used the sidebar/sheet Category and Tags; add the
  spec's cases.

### Task 5: Docs, screenshots, ship

- [ ] `docs/design/README.md`: "Built in M7" and the placement difference.
- [ ] Screenshots in `docs/design/screenshots/m7/` (phone and desktop): nothing on,
  Breakfast on, Mains + Kid approved, a non-quick tag on from the sheet. Taken with
  Playwright against `uv run app` with real-looking food recipes.
- [ ] All checks green; push the branch, merge to `main`, watch CI `test` and `publish`,
  check `/healthz` as `CLAUDE.md` says (or say why it can't be).
