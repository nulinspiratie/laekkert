# Food quick filters — design

Serwan wants to get to a subset of Food in one tap: a category (mains, sides, …) and the
tags that matter most (breakfast, kid approved, …), shown at the top of the Food page.
There is no Claude Design session for this. The screens reuse what the app already has:
the phone's `PageHeading` `below` slot (Drinks' view chips), the Food tokens, and the
existing tag and category filters.

Mockup (clickable, on the 11 real recipes): https://claude.ai/artifact/1eUEjNeCfEpVHnt3eZzdwr

## Why

- On a phone, Category and Tags are in the filter sheet behind the sliders button in the
  bottom bar. Getting to the breakfasts takes three taps and a sheet that covers the list.
- Most visits start with the same few questions: what's for breakfast, what's a quick
  dinner, what will the kids eat. Those should be one tap from the Food page.
- Drinks already has this: its four views are chips at the top of the page (M6). Food has
  nothing like it.

## Goals

- The Food page shows **category tabs** (All, Mains, Sides, …) and **quick tag chips**
  (Breakfast, Dinner, Kid approved, Quick, Vegetarian) at the top, on phone and desktop.
- Any category or quick tag is one tap from the Food page, and a second tap undoes it.
- Every tab and chip says how many recipes it would leave.
- Which tags are quick tags is a short list Serwan controls.

## Non-goals

- Drinks. Its views, sheet and sidebar stay exactly as they are.
- New recipe fields. Category and tags stay as they are; no meal field.
- Smart tags (still in `docs/ideas.md`).
- OR between tags. Two tags on still means a recipe needs both, as today.
- In-app pinning of quick tags (see "Decisions").

## Anti-goals (what would make it a failure)

- The rows push the first recipe card below the fold on a phone.
- A tap on a tab or chip leads to an empty list.
- The same filter shows in two places at once with two different states.
- Old links (`?cat=mains&tag=quick`) stop working.

## Decisions

Serwan was shown these with a recommendation and has not overruled them. Build to them;
if he says otherwise, follow him.

1. **Breakfast stays a tag.** In the data, category is the kind of dish (mains, sides,
   desserts, sauces, prep) and breakfast and dinner are tags. Some recipes are both (carrot
   buns and sesame buns are sides and breakfast; overnight oats is mains and breakfast), so
   a breakfast category would force a choice. Breakfast and Dinner come first in the chip
   row instead, which keeps them one tap away.
2. **The quick tags are a list in `config.toml`.** Not "the most used tags": kid approved
   is on one recipe today, so a frequency rule would leave out the tag Serwan named first.
   Changing the list is a home-server PR.
3. **No Favourite chip.** Marks stay in the sheet and sidebar.

## The two rows

Both rows sit directly under the page heading. On phone they go in `PageHeading`'s
`below` slot (the one Drinks uses for its view chips). On desktop they go above the
results, under the heading with its Sort and New recipe.

| | Category tabs | Quick tag chips |
| --- | --- | --- |
| Picks | One. A radio group: All, then each category. | Any number, each a toggle. Two on means a recipe needs both. |
| Shows | Categories with at least one food recipe, in `CATEGORIES.food` order. An empty category is left out, as the sidebar does today (but a category in the URL with 0 recipes still shows, so it can be undone). | The quick tags used by at least one food recipe, in the configured order; then any other tag that is on (from the sheet or a link); then **More**; then **Clear** when anything is on. |
| Looks | Text tabs, 15 px semibold, `--muted`. The one picked is `--accent-ink` with a 3 px `--accent` underline. A 1 px `--border` rule under the row. Count after the name, 12 px, `--label`. | Pills, 40 px tall, 14 px semibold. Off: `--surface` with a `--border-strong` border, count in `--muted`. On: `--accent` fill, `--on-accent` text, a check icon, no count. A non-quick tag that is on uses `--accent-soft` / `--accent-ink`. More has a dashed border. |
| Label | The category capitalised ("Mains"). | The tag with its first letter capitalised ("Kid approved"); the filter itself uses the recipe's spelling. |

- **Phone:** each row scrolls sideways when it doesn't fit, with a fade at the right edge
  (`mask-image`), no scrollbar, 16 px gutter. Once the heading has scrolled away, the two
  rows stick to the top of the screen (`position: sticky`, page background, a hairline
  and soft shadow under them while stuck). Every tab and chip has a tap target of at least
  44 px.
- **Desktop:** the rows wrap instead of scrolling and don't stick.
- **More** opens the filter sheet on phone. On desktop it moves focus to the sidebar's
  More tags section.
- **Clear** (a text link at the end of the chip row) clears the category and the tags. It
  keeps the search, marks, sort and What you have.
- The removable chips under the desktop heading (`Chips` in `Browse.tsx`) stop showing the
  category and tags on Food, since the rows show them. They keep showing marks. Drinks is
  unchanged.

## Counts and dead ends

- A category tab's count is how many recipes it would show with everything else that is
  on now (tags, marks, and the list the page already has for the search and What you
  have). All shows the total under those.
- A chip that is **off** shows how many recipes you would see if you tapped it. A chip
  that is **on** shows no count; the subtitle already says how many are left.
- A tab or chip that would leave 0 is dimmed (opacity about 0.45) and does nothing when
  tapped: `aria-disabled="true"`, not `disabled`, so it stays focusable and in the row and
  nothing jumps. A tab or chip that is on is never dimmed, so it can always be undone.
  Example with today's data: with Breakfast on, Kid approved is dimmed, because the one
  kid-approved recipe is a dinner.
- The list can still be empty through the search or What you have. The existing empty
  states and their Clear filters handle that, unchanged.
- Counts are computed from the recipes the page already loaded; no new request.

## Which tags are quick tags

A new setting:

```toml
# Tags shown as one-tap filters at the top of the Food page, in this order.
# Tags no food recipe uses are left out. [] shows no tag row.
food_quick_tags = ["breakfast", "dinner", "kid approved", "quick", "vegetarian"]
```

- A setting entry matches a recipe tag by name key (`normalise` in `web/src/bar.ts`, the
  client copy of the server's `name_key`), so `Kid approved` in the setting matches
  `kid approved` on a recipe. The chip filters on the spelling the recipes use (the most
  common one if they differ), so `tag=` in the URL is a real recipe tag.
- The app serves it from a new `GET /api/settings`:
  `{"food_quick_tags": ["breakfast", ...]}`.
- The page renders the category row at once and the chip row once settings arrive. If the
  request fails, it uses the default list.
- The home-server `containers/laekkert/config.toml` doesn't need the key: the default
  applies until it is added. Per the Config rule, the app must cope with the key appearing
  before or after the image that reads it.

## Filter sheet, badge and sidebar (Food only)

- **Phone filter sheet:** the Category section goes (the tabs do it). Tags becomes
  **More tags** and lists only tags that are not quick tags. Marks and Sort stay. If there
  are no other tags, the section is left out.
- **The sliders button's badge** counts what the rows don't show: marks that are on, plus
  tags that are on and are not quick tags. Category and quick tags no longer count. Its
  `aria-label` follows the same count.
- **Desktop sidebar:** the Category section goes. Tags becomes More tags, the same list as
  the sheet. Search, What you have and Marks stay.

## Links

No new query parameters. A tab sets or removes `cat=`, a chip adds or removes a `tag=`,
exactly as the sheet does today, so bookmarks, Claude's links and the back button behave
as now. A `tag=` that is not a quick tag shows as a soft chip in the row.

## Accessibility

- The tabs are `role="radiogroup"` with `aria-label="Category"`; each tab is
  `role="radio"` with `aria-checked`. Arrow keys are not required (they are buttons, as
  the existing `CategoryPill`s are).
- The chips are buttons with `aria-pressed`, inside a group labelled "Quick tags". A chip's
  accessible name includes its count ("Breakfast, 6 recipes").
- On is shown by fill and a check icon, not by colour alone.
- Focus stays visible on both rows.

## Build

| Where | Change |
| --- | --- |
| `src/app/config.py`, `config.example.toml` | `food_quick_tags: tuple[str, ...]` with the default above; TOML lists become tuples. `test_example_config_matches_defaults` keeps them in step. |
| `src/app/api.py` | `GET /api/settings` returning `{"food_quick_tags": [...]}`. Before the `/api/{rest:path}` catch-all. |
| `src/app/main.py` (or wherever `api_routes` gets its arguments) | Pass the settings through. |
| `web/src/api.ts` | `getSettings()`. |
| `web/src/types.ts` | `Settings` type. |
| `web/src/browse.ts` | `DEFAULT_QUICK_TAGS`; a pure `quickFilters(recipes, state, quickTags)` returning the tabs (name, count, on, disabled) and the chips (tag, label, count, on, disabled, quick or not). `facetCounts`' tag list (or a new helper) leaves out quick tags for More tags. |
| `web/src/QuickFilters.tsx` (new) | The two rows, More and Clear. Takes the `quickFilters` result, `onChange`, `onMore`, and `desktop`. |
| `web/src/Browse.tsx` | Food only: render `QuickFilters` (phone in `PageHeading below`, desktop above the results); load settings; new badge count; `Chips` drops category and tags. |
| `web/src/FilterPanel.tsx` | Food only: no Category section; Tags becomes More tags without the quick tags. |
| `web/src/styles/browse.css` | Tabs, chips, sticky rows, edge fade. Food tokens only, no new colours. |
| `docs/design/README.md` | A "Built in M7" (or next number) section saying this has no artboard and which patterns it follows. |

## Tests

- `browse.test.ts`:
  - counts with nothing on, with a category, with two tags;
  - an off chip that would leave 0 is disabled; an on chip never is;
  - quick tags come in configured order, unused ones are left out, an on non-quick tag is
    appended;
  - name-key matching between the setting and recipe tags;
  - More tags leaves out the quick tags.
- `Browse.test.tsx`:
  - tapping a tab sets `cat=`; tapping All removes it;
  - tapping a chip twice adds then removes `tag=`;
  - a disabled chip does nothing;
  - Clear keeps `q=`, `mark=`, `sort=` and `have=`;
  - the badge ignores category and quick tags;
  - More opens the sheet;
  - the sheet has no Category section on Food;
  - Drinks renders as before (no quick rows).
- `test_api.py`: `/api/settings` returns the default, and a configured list.
- Config test: the new key in `config.example.toml` matches the default; an unknown key is
  still ignored.

## Done when

- `just lint` and `just test` pass, and the web tests and lint pass.
- Phone and desktop screenshots of: nothing on, Breakfast on (Kid approved dimmed), Mains
  + Kid approved, and a non-quick tag on from the sheet. Put them in
  `docs/design/screenshots/<milestone>/`.
- Pushed to `main` (that is the deploy), CI's `test` and `publish` green, and `/healthz`
  checked as `CLAUDE.md` describes, or said plainly why it can't be.
