# M6: Drinks views, and tracking only the bottles — design

Serwan's feedback after using M4's bar. There is no Claude Design session for this
milestone. The screens reuse what M4 already has (the phone's chip row under the heading,
the desktop filter aside, the drinks badges, the bar page sections).

## Why

- **The Drinks page mixes drinks and makings.** Simple syrup and ginger syrup sit between
  the cocktails. At the cabinet you want to see drinks. Syrups and prep are something you
  look up on purpose.
- **"Can make" asks too much.** A drink only counts as "can make" when you also have
  every fresh item, so anything with lime or mint drops out. Nobody marks limes as have
  when they buy them and as don't have when the last one is gone. What matters is whether
  the **alcohol** is in the cabinet. The rest (lime, mint, simple syrup, tonic) you may or
  may not have, and the drink can say so.
- **Syrups and mixers are tracked like bottles.** Simple syrup has Have/Don't have
  buttons on the bar and on the recipe page, and it can keep a drink out of "can make".
  Nobody keeps that up to date, so it should not be tracked.
- **Mocktail shows up twice.** It is a Style (the category `mocktails`) and a tag
  (`mocktail`) in the filters. It should be one thing, and one you can pick straight from
  the top of the page.

## Goals

- The Drinks page has four **views** at the top: **Can make** (the default), **All
  drinks**, **Mocktails**, **Syrups & prep**. The first three show cocktails and
  mocktails only. Syrups & prep shows those two categories.
- **Can make** means every *tracked* bottle the drink uses is in the bar. The drink's
  card still lists what else it needs ("Also needs: lime juice, mint").
- Only bottles are tracked. Fresh items, syrups and mixers are **not tracked**. They never
  keep a drink out of Can make, and they have no Have/Don't have buttons anywhere.
- Mocktail is a category only. A tag that repeats the recipe's own category goes away.

## Non-goals

- Smart tags (rule-based tags) stay in `docs/ideas.md`.
- A shopping list, or tracking fresh items some other way.
- Changes to the Food side, apart from the category-tag rule, which applies to both
  sides.
- New kinds. Prosecco, wine and beer stay under Other: tracked, like any other bottle.

## Anti-goals (what would make it a failure)

- A drink shows under Can make while a bottle it needs is marked as don't have, or has
  never been sorted.
- Fresh things, syrups or mixers still ask to be sorted (Have/Don't have) once they are
  not tracked.
- The page opens on an empty list for no visible reason.
- Picking Mocktails takes more than one tap from the Drinks page.

## Tracked and not tracked

A bar item is **not tracked** when any of these holds:

1. its catalog entry has `fresh: true` (the stored field keeps its name; it now means
   "not tracked": fresh things, mixers, anything you buy when a drink needs it);
2. its kind is `syrups`;
3. Lækkert has a recipe for it: a drink in the `syrups` or `prep` category whose name
   matches the item's name or an alias (by the catalog key). M4's `recipe` link only
   looked at `syrups`; it now looks at both.

Every other item is **tracked**, kind Other included. An item with no catalog entry, or an
entry with no kind, counts as kind `syrups` when its name contains the word `syrup` or
`syrups` (by `search.words()`, so `ginger syrup` and `Syrup, honey` count, `syrupy` does
not), and as `other` otherwise. So a new drink that uses `passion fruit syrup` doesn't
ask to be sorted. A kind set on the catalog entry always wins over this rule.

A not-tracked item's state is always `null`. Its inventory entry, if any, is ignored when
reading and dropped on the next bar write.

The bar is **set up** once any tracked item has a state.

## Which drinks the bar covers

The bar covers **cocktails and mocktails**. Syrups and prep are things you make, not
drinks you mix from the bar:

- The bar's items are the ingredients of every cocktail and mocktail, plus every catalog
  entry with a kind (as in M4). An ingredient used only by syrups and prep recipes (the
  sugar and ginger in ginger syrup) is not on the bar.
- Syrups and prep recipes have no bar status: `bar` is `null` on their summaries and
  recipe pages, and they are not in the bar's counts.
- `used_in` still lists every drink that uses the item, whatever its category, so
  "Delete" stays safe.

## A drink's status

From the ingredients of a cocktail or mocktail, in this order:

1. any tracked item that is `dont` → `missing` (the names, in recipe order);
2. otherwise any tracked item that is not sorted → `unsorted` (the names);
3. otherwise → `can_make`.

`fresh_only` is gone. A drink that used to be `fresh_only` is now `can_make`. A drink's
`bar` is `{status, missing, unsorted, untracked}`, with all three lists always present.
`untracked` lists every not-tracked ingredient (by item name, in recipe order), whatever
the status. A mocktail with no tracked bottles is `can_make`.

## Changes

M4's change model, with the fresh fields renamed:

| Field | Meaning |
| --- | --- |
| `untrack` | Was `fresh`. Sets `fresh: true` on the entry and clears the state. An unknown name is added as a not-tracked item, kind `other`. |
| `track` | Was `not_fresh`. Clears `fresh`; the item is back on the shelf, not sorted. Refused for an item that is not tracked for another reason: "Syrups aren't tracked. Give ‘X’ another kind first." / "Lækkert has a recipe for ‘X’, so it isn't tracked." |

- Setting a kind to `syrups` clears the item's state.
- `have` or `dont_have` on a not-tracked item is skipped silently, as M4 does for fresh
  items, so "I bought limes, rum and Campari" still works in one call. The bar that comes
  back shows what happened.
- The contradiction rules carry over with the new names (`untrack` and `track`, `have`
  and `untrack`, and so on).
- Fold: A's `fresh` still carries over to B when B has none.

## API

- `GET /api/bar` → `{items, set_up, counts: {can_make, missing, unsorted, total}}`.
  `total` counts cocktails and mocktails. Each item gains `tracked: bool` and
  `untracked_because: "marked" | "syrups" | "recipe" | null` (`null` when tracked; when
  more than one applies, the first in that order), and drops `fresh`. The kind shown is
  the effective one (the `syrup` word rule applied).
- `POST /api/bar` takes the renamed fields.
- Drinks summaries: `bar` as above, `null` for syrups and prep.
- `GET /api/recipes/drinks/<slug>`: the recipe's `bar` as above. Each ingredient's `bar`
  becomes `{item, state, tracked, recipe}` (`fresh` → `tracked`); `null` on syrups and
  prep recipes.

## MCP

- `read_bar()`: as `GET /api/bar`.
- `manage_inventory(have, dont_have, untrack, track, kinds, add_names, remove_names,
  fold)`: `fresh` and `not_fresh` are renamed. The docstring says what is tracked.
- `search_recipes(bar=...)` takes `"can_make"` or `None`. `"fresh_only"` is gone. With
  `bar`, syrups and prep are left out.
- `list_recipes` and `search_recipes` entries carry the new `bar` shape.
- `INSTRUCTIONS`: the bar sentence becomes "The drinks side has a bar (read_bar,
  manage_inventory). Only bottles are tracked; fresh items, syrups and mixers never are,
  and ‘can make’ means every tracked bottle is in."
- `list_ingredients` is unchanged (it keeps reporting the stored `fresh` and `kind`).

## Tags that repeat the category

A recipe's tags never include its own category. When a recipe is read (`parse_recipe`),
any tag whose catalog key equals the category's key, or the category without its final
`s`, is dropped: `mocktail` and `mocktails` on a mocktail, `dessert` on a dessert. Both
sides. No format version bump: files keep the tag until they are next saved, and an older
image still reads them.

A tag that names a *different* category is kept (a cocktail tagged `mocktail`), because
it may mean the recipe is filed in the wrong place. The filters show it, so it can be
spotted.

The style guide's tag examples lose `mocktail` and gain the line "Don't tag what the
category already says (`mocktail`, `syrup`)."

## Screens

### Drinks browse: the views

The views replace both M4's "From your bar" filter and the Style (category) filter on the
drinks side. Food is unchanged.

| View | Shows | URL |
| --- | --- | --- |
| Can make | cocktails and mocktails with status `can_make` | (no param) |
| All drinks | cocktails and mocktails | `show=all` |
| Mocktails | mocktails | `show=mocktails` |
| Syrups & prep | syrups and prep | `show=syrups` |

- **Can make is the default**, so `/drinks` opens on it. Old links still work: `bar=can`
  and `bar=fresh` open Can make, `cat=cocktails` All drinks, `cat=mocktails` Mocktails,
  `cat=syrups` and `cat=prep` Syrups & prep. When `show=` is present it wins, and the old
  params are dropped from the URL on the next change.
- If the bar fails to load, Can make can't be worked out: the view is hidden and the page
  falls back to All drinks, as M4 hides its bar filter.
- **Phone:** the chip row under the heading becomes `Can make {n}`, `All {n}`,
  `Mocktails {n}`, `Syrups {n}` (radiogroup, aria-label "Show"). The row scrolls sideways
  if it doesn't fit. The unsorted banner stays under it.
- **Desktop:** the aside's "From your bar" section becomes a "Show" section with the same
  four radios (`Can make`, `All drinks`, `Mocktails`, `Syrups & prep`) and counts, then
  "Edit the bar" / "Set up the bar" and the unsorted note, as now.
- Counts follow the search, marks and tags, like the other facets.
- The Style section goes from the desktop aside and the phone filter sheet on the drinks
  side, and so does its removable chip. The sheet's Reset leaves the view as it is.
- Desktop result line: Can make "Can make · {N drinks}"; All drinks "{N} drinks · {M} you
  can make"; Mocktails "Mocktails · {N drinks}"; Syrups & prep "Syrups & prep · {N
  recipes}".
- **Search inside a view:** the view still filters. When it hides some matches, a line
  under the results says "{k} more in All drinks" and links there (or "in Syrups & prep"
  when that's where they are; All drinks when both have some).

### Cards

On cocktails and mocktails (any view):

- `can_make` with nothing untracked: check icon, "Can make now".
- `can_make` with untracked items: basket icon, "Also needs: lime juice, mint +1". The
  two-names-then-`+N` rule, one line with ellipsis, and the full list in `title` and the
  accessible name, as M4 and M5 do.
- `missing`: "Missing: x" and `unsorted`: "Not sorted: x", as now.

Syrups and prep cards have no bar badge.

### Empty states

- Can make, bar not set up: M4's "Set up your bar first" (unchanged copy), with "Set up
  the bar" and "Show all {N} drinks".
- Can make, set up, nothing makeable: "Nothing to make yet", "Every drink is missing a
  bottle or uses one not sorted yet.", "Open the bar", "Show all {N} drinks".
- M4's fresh-only empty states go.
- Other views: the existing generic empty state.

### The bar page

- The subtitle and the progress line count tracked items only ("{have} of {total} bottles
  in").
- The can-make card ("You can make {N drinks|1 drink} now") and the desktop aside's "See
  them" link to `/drinks`.
- Kind groups for tracked items: Spirits, Liqueurs, Aperitifs and vermouth, Bitters,
  Other. Syrups have no group, because they are never tracked.
- "Not sorted yet": the help text becomes "New from drinks you added. Until you sort
  them, drinks that use them don't show under Can make." Each row gets a third choice,
  "Don't track", next to Have and Don't have (one `untrack` change). The bulk "Mark the
  other {N} as don't have" is unchanged.
- The fresh section becomes **Not tracked**: "Fresh things, syrups and mixers. Drinks that
  use them still show under Can make and say what else they need." It lists every
  not-tracked item as chips that open the sheet, and ends with the footnote "Open an item
  to start or stop tracking it."
- No match for a search: "Add ‘{q}’ to the bar" (as have, as now), and "Add it without
  tracking" (was "It's fresh: add it without tracking").

### The item sheet

- The "Fresh item" switch becomes **Track it**. On means tracked. Help text: "Tracked
  items are bottles: a drink needs them before it shows under Can make. Turn it off for
  fresh things, syrups and mixers."
- When the item is untracked because of its kind or a recipe, the switch shows off and
  disabled, with "Syrups are never tracked." or "Lækkert has a recipe for it, so it's
  never tracked."
- The "In the bar" radiogroup hides when not tracked (it hid for fresh).

### A drink's recipe page

Cocktails and mocktails:

- Summary line: "Missing: a, b" or "From your bar: {n} of {n} bottles", plus "Also needs:
  x, y" (basket) when anything is untracked. Unsorted bottles count as missing in this
  line, as now.
- Tracked rows keep their state button and undo.
- Untracked rows have no button and no state text. A row with a recipe still links to
  it: "Recipe: {Name}". "Out? Make it" goes, since a syrup has no state.

Syrups and prep recipe pages show no bar summary and no state buttons.

## Existing data on the NAS

- Items of kind Syrups, and items Lækkert has a recipe for, stop being tracked as soon as
  the new image runs. Their old states are dropped on the next bar write.
- Mixers and juices that M4 gave kind Other when someone tapped them (tonic, ginger beer)
  stay tracked until they are untracked: from their sheet, from "Not tracked", or with
  one `manage_inventory(untrack=[...])` call from Claude. Kind Other stays tracked
  because M4 also gave Other to real bottles tapped from a drink (a mezcal with no catalog
  entry). Untracking every Other item would show drinks as makeable without them.
- Rolling back to an older image keeps working: the catalog fields are unchanged, and
  dropped inventory states read as not sorted.

## Docs

- `docs/plan.md`: an M6 section (what was built, rulings).
- `docs/ideas.md`: smart tags stay. Note that mocktail is now a category view, not a tag.
- `docs/design/README.md`: M6, no artboard; the screenshots folder.
- Screenshots in `docs/design/screenshots/m6/`: drinks phone and desktop on Can make,
  Mocktails and Syrups & prep (light and dark for Can make), the bar page's Not tracked
  section, the item sheet with Track it, and a drink recipe page with "Also needs".

## Left to the builder

- Where the `syrup` word rule and the tracked rule live in `bar.py`, and how
  `BarItem.json` exposes them.
- Layout of the third "Don't track" choice on not-sorted rows, within the 44 px rule (a
  text button under the two is fine on phone).
- How `browse.ts` maps the old params and holds the view (a `show` field replacing `bar`
  on `BrowseState`, or a view next to it).
- Tests for each part, following the existing test layout.

## Calls I made (Serwan didn't decide these)

- The default view keeps the name **Can make**: short, already on the phone chips, and it
  now means "you have the alcohol".
- Four views, with Mocktails as a view of its own and Syrups and prep together ("Syrups"
  on the phone chip to keep the row short).
- Mocktails count as Can make when they use no tracked bottle, so they show there too.
- The Style filter goes on drinks, because the views cover it.
- Kind Other stays tracked (see "Existing data"); mixers are untracked one by one or by
  Claude. Syrups are never tracked, and neither is anything Lækkert has a recipe for.
- New items with "syrup" in the name start as Syrups, so they never ask to be sorted.
- Only tags that repeat the recipe's *own* category are dropped, on read, with no format
  bump.
- The stored `fresh` field keeps its name; the API, MCP and screens say "tracked".
- Syrups and prep recipes get no bar status, and their ingredients don't fill the bar.
