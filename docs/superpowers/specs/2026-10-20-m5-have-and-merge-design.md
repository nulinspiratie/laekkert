# M5: Cook with what you have, and merging ingredients — design

Requirements 19, 21 and 24 ("merge ingredients") of `docs/requirements-v1.md`. There is no
Claude Design session for this milestone: the screens reuse the patterns M1 and M4 already
have (the filter aside, the phone header buttons, the drinks status badges). Serwan asked
for the two features together; two users and authorship are dropped from V1 for now.

## Why

- **Cook with what you have.** On a weeknight, standing at the fridge with a phone: "I have
  chicken and leeks, what can I cook?" The list should show the recipes that use them, the
  ones needing the fewest other things first, and say what is missing. Nothing is saved:
  tomorrow's fridge is different.
- **Merging ingredients.** Recipes write ingredients as free text, so the same thing turns
  up as `leek` and `leeks`, `coriander` and `cilantro`. The catalog already maps names to
  one identity (M4's bar uses it). Claude should be able to find such duplicates and merge
  them, so tsp conversions, the bar and the new "what you have" match all treat them as one.

## Goals

- Food's browse page takes a short, throwaway list of ingredients. It keeps the recipes
  that use at least one of them, ranks them by fewest missing ingredients, and shows each
  card's missing items.
- The same works for Claude: `search_recipes` takes the list too.
- Claude can list every ingredient name in use with its catalog identity
  (`list_ingredients`) and merge or separate names (`merge_ingredients`).

## Non-goals

- A saved pantry, staples list, or food inventory. Quantities. A shopping list.
- "What you have" on the Drinks side (the bar answers that).
- An app screen for merging. The bar's fold (M4) stays the app's way for drinks; for food,
  merging is Claude's job. A catalog page in the app can come later.
- Rewriting recipe text when names merge. A recipe keeps `2 leeks` as written; the catalog
  maps it.
- Two users, authorship.

## Anti-goals (what would make it a failure)

- The list survives into another visit, or ends up in `/data` or `localStorage`.
- "I have chicken" shows recipes that don't use chicken, or ranks a recipe high because it
  is short while using none of what you have.
- Salt-to-taste counts as missing in every recipe.
- A merge made by mistake can't be undone without a hand edit.
- A merge quietly changes what is in the bar, or puts a food ingredient on the bar.

## Part 1: Cook with what you have

### Matching

The list is a set of **terms** ("chicken", "leeks"). Blank terms are dropped, terms are
stripped, and terms with the same catalog key (`name_key`) are one term; the first spelling
is kept. At most 20 terms count; the rest are ignored. A term is at most 60 characters
(longer is cut).

A term **covers** an ingredient row of a recipe when either:

1. the term and the row's `item` resolve to the same catalog entry (by name or alias), or
2. every word of the term matches a word of one of the row's names. The row's names are its
   `item` and, if it resolves to a catalog entry, that entry's name and aliases. Words are
   `search.words()`. Any term word matches a name word that is equal to it or differs by a
   plural (`s`, `es`, or `y` for `ies`, either way round). A term word of five letters or
   more also matches when `fuzz.ratio >= 85` (changed from 80 at the final review: at 80,
   "chicken" covered `chickpea`, "butter" `butternut`, "pasta" `paste`). A shorter term
   word gets no fuzzy match, because
   `fuzz.ratio` is too forgiving for short words ("pea" vs "pear", "rice" vs "rise"). There
   is no prefix rule: a term is a whole word, so "pea" must not cover "peanuts". So "leeks"
   covers `leek`, "egg" covers `eggs`, "potato" covers `baby potatoes`, "chicken" covers
   `chicken thighs`.

A row is **assumed** (never missing) when its unit is `to taste`, or its item's catalog key
is `water` or resolves to the catalog entry `water`. An assumed row a term covers still
counts as matched.

For each recipe: **matched** is the rows some term covers; **missing** is every other row
that isn't assumed. A recipe is **kept** when at least one row is matched. The same item
written twice in one recipe counts once (by catalog identity, or `name_key` when it has no
entry). Each list holds the row texts as written (`item`), in recipe order.

### Ranking

Kept recipes sort by: number missing (fewest first), then number of distinct terms matched
(most first), then name (case-insensitive). A "what you have" list overrides the chosen
sort, the way a search keeps relevance order. With a search (`q`) as well, the search
filters and the list ranks.

### API

`GET /api/recipes?side=food&have=chicken&have=leeks` (repeatable `have`, combines with `q`)
returns only kept recipes, ranked, each summary with:

```json
"have": {"matched": ["chicken thighs", "leeks"], "missing": ["baby potatoes", "olive oil", "smoked paprika", "lemon"]}
```

Without `have` (or with only blank terms) the response is unchanged and summaries have no
`have` key. `have` with `side=drinks` answers 400 `"What you have" is for food only.`

### MCP

`search_recipes` gains `have: list[str] = []`. Food only; on drinks it refuses with
`"What you have" is for food only.` Matching, keeping and ranking as above; with `have`,
`sort` is ignored. Each entry gains the `have` block. The docstring explains it in a
sentence or two ("recipes that use at least one, fewest missing first; salt to taste and
water are assumed").

### Screens

The list lives in the URL only (`have=` params, repeatable), so Back from a recipe keeps
it, and nothing else remembers it: not `localStorage`, not `/data`. Switching side, the
logo and "Clear" drop it. It is Food only; on drinks the param is ignored.

**Desktop, food.** The filter aside gets a section between the search field and the marks:
heading **What you have**; a text field, placeholder `Add an ingredient`; Enter or a comma
adds the typed text as a term; each term shows as a chip with a remove button
(`aria-label "Remove chicken"`); a **Clear** link when there are any terms. With no terms a
one-line hint under the field: `See what you can cook with what's in the fridge.` Adding a
term that is already there (by `name_key`) does nothing. Backspace in an empty field
removes the last chip.

**Phone, food.** The header gets a round button left of search (the existing `Basket`
icon, `aria-label "What you have"`, pressed state when terms exist). It opens a panel
under the title, the way the search button opens the search field: the same field, chips
and Clear. The panel stays open while there are terms; closing it with terms keeps them
and the button shows pressed. The search panel and this panel can be open together.

**Subtitle.** With terms, the sort part of the subtitle reads `fewest missing first`
(phone and desktop), e.g. `fewest missing first · 2 recipes`. The sort control is left as
it is (as during a search).

**Cards (grid and list).** With terms, each card gets a badge in the drinks badge style and
position:

- nothing missing: check icon, `Have everything`
- otherwise: `Missing: ` and the first two missing items, then ` +N` for the rest, e.g.
  `Missing: baby potatoes, olive oil +2`. One line, ellipsis if too long; the full list is
  in the badge's `title` and accessible name.

Food's food colours, not the drinks greens: use theme tokens, no hard-coded hex.

**Empty states.**

- Terms given, no recipe uses any of them: title `Nothing uses chicken or leeks` (terms
  joined with commas and a final "or"; with more than three, `Nothing uses those`), body
  `Try another ingredient, or clear the list.`, a **Clear** button.
- Terms plus other filters leave nothing while the terms alone would keep some: the
  existing generic empty state ("clear filters") applies.

## Part 2: Merging ingredients (MCP)

### `list_ingredients(side: "food" | "drinks" | None = None)`

Every ingredient identity in use, sorted by `name` case-insensitively. An identity is a
catalog entry, or, for item text with no entry, its `name_key`. Each entry:

```json
{"name": "leek", "other_names": ["leeks"], "recipes": {"food": 3, "drinks": 0},
 "in_catalog": true, "g_per_tsp": null, "fresh": false, "kind": null}
```

- `name`: the catalog entry's name, or the item as written in the first recipe using it
  (recipes in side then name order).
- `other_names`: the entry's aliases plus every other spelling recipes use for it that
  differs by more than case/accents/spacing from `name` and the aliases, each once.
- `recipes`: how many recipes on each side use it.
- With `side`, only identities used on that side are listed, and catalog entries used by no
  recipe are left out. Without `side`, catalog entries used by no recipe are included with
  zero counts.

The docstring tells Claude what to do with it: look for names that are the same ingredient
(plurals, spellings, synonyms) and merge them with `merge_ingredients`; ingredients that are
only similar (`chicken thighs` and `chicken breast`) are not merged.

### `merge_ingredients(merges: dict[str, str] = {}, separate: list[str] = [])`

`merges` maps a name to the name it merges into: `{"leeks": "leek", "cilantro":
"coriander"}`. `separate` lists names to make their own ingredient again. One call is all
or nothing; the catalog and the inventory are written only if every part succeeds.

A **merge** of `A` into `B`:

- `A` must not be on the bar: used by a drink, or a catalog entry with a `kind` or a bar
  state. Otherwise refuse: `‘A’ is on the bar. Fold it there instead (manage_inventory).`
  The bar's fold keeps bar states and kinds; this keeps the merge from moving bottles
  around the bar, and `separate` from leaving a bottle behind. `B` may be on the bar (for
  example `caster sugar` into `sugar`).
- `A` and `B` must each be an ingredient name in use: a catalog name or alias, or an item
  some recipe uses (matched by `name_key`). Otherwise refuse:
  `There is no ingredient ‘A’.`
- If they already resolve to the same identity, refuse:
  `‘A’ and ‘B’ are already the same ingredient.`
- `B`'s identity keeps its catalog entry, or gets a new one `{"name": B as written in the
  first recipe that uses it, or as given}`. Its `aliases` gain `A`'s identity's name, its
  aliases and its other recipe spellings (each once, by `name_key`, never `B`'s own name).
- Fields: `B`'s entry keeps every field it has; fields only `A`'s entry has (`g_per_tsp`,
  `fresh`, `kind`, and unknown fields) are copied over. `A`'s entry, if any, is removed.
  So a food merge never gives an entry a `kind`, and nothing lands on the bar that a drink
  or a kind didn't already put there.
- Bar: `A` is never on the bar, so the inventory is not changed. Copying `fresh` from `A`
  onto a `B` that is on the bar is the one way a merge can change the bar; it is allowed
  (B's own `fresh` wins when it has one) and the returned entry shows it.
- Recipes are not changed.

A **separate** of `N`:

- `N` must be an alias of a catalog entry (by `name_key`), else refuse:
  `‘N’ isn't another name of anything.` A main name refuses:
  `‘N’ is the main name of its ingredient. Merge it into another name instead.`
- The alias is removed from its entry. `N` becomes its own identity again, with no entry
  (it is virtual on the bar if a drink uses it, and unsorted there). Fields copied over in
  the merge (`g_per_tsp`, `fresh`) stay with `B`; `N` starts without them. That loss is
  accepted: without a conversion the app shows the amount as written and flags it, as it
  does for any ingredient, and the merged names are never bottles.

**Conflicts in one call** (refused before anything is written, compared by `name_key`):
a name both merged and merged into (`Chains aren't allowed in one call: ‘B’ is merged and
merged into.`), the same name merged into two targets (impossible in a dict, but two
spellings of one key are: `‘A’ is merged twice.`), and a name both merged and separated
(`‘A’ can't be merged and separated in one call.`). An empty name refuses with the bar's
`A name can't be empty.` An empty call refuses: `Nothing to change.`

Refusals reach Claude as the sentence (a `ToolError`). An unreadable catalog or inventory
refuses with the existing unavailable sentences, and nothing is written.

**Returns** `{"ingredients": [...]}`: the `list_ingredients` entry for each identity the
call touched (each merge's `B`, each separated name), in call order.

### Where it lives

The merge writes the catalog and the inventory together, so it runs under the bar's lock
and uses the bar's strict reads and writes (`Catalog.raw()`/`save_raw()`, the inventory's
strict read and `_write`). Whether that is a method on `Bar` or a module that borrows its
lock is left to the plan.

### Instructions and style guide

- The MCP server instructions gain one sentence: Claude can list ingredients and merge
  names that are the same ingredient; recipes keep their wording.
- The style guide gains one line under ingredients: before adding a recipe, prefer the
  ingredient names already in use (`list_ingredients`), and merge true duplicates rather
  than adding a third spelling.

## Docs

- `docs/plan.md`: an M5 section (what was built, rulings), and the "After the PoC" list
  updated: two users dropped for now, photo search and offline PWA left.
- `docs/design/README.md`: "Cook with what you have" built (M5), no artboard; the
  screenshots folder.
- Screenshots in `docs/design/screenshots/m5/`: food with terms (phone and desktop, light
  and dark), the phone panel open, the empty state.

## Left to the builder

- "Recipes in side then name order" means food before drinks.
- Both water clauses (key `water`, and any name resolving to a catalog entry named
  `water`), tested with and without such an entry.
- The merge needs an identity lookup that knows food items too; `_Registry` knows only
  drinks. A small separate lookup is fine.

- Module layout (a `have.py` next to `search.py` is the obvious home for the matcher).
- The chip input's markup and CSS, within the existing tokens and the 44 px touch-target
  rule.
- Whether the client parses the `have` params in `browse.ts` (it should, beside `q`), and
  how the debounce treats them (adding a chip is a deliberate act: no debounce needed).

## Calls I made (Serwan didn't decide these)

- The name "Cook with what you have", from the design README.
- The list lives in the URL, so Back works; that is not "saving" it.
- Keep only recipes using at least one term, then rank by fewest missing; ranking alone
  would put short unrelated recipes first.
- Salt-to-taste rows and water are assumed. No staples list.
- Whole-word fuzzy matching, no prefix matching.
- Up to two missing names on a card, then `+N`.
- Merging is MCP-only, with `list_ingredients` so Claude can see what to merge and
  `separate` so a wrong merge can be undone.
- Merges never rewrite recipes and never give a food entry a kind; an item on the bar is
  never merged away (the bar's fold does that).
- Short term words (four letters or fewer) match exactly or as a plural only.
