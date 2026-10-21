# M4: the bar (drinks inventory) — design

Requirements 20 and 24 ("manage inventory") of `docs/requirements-v1.md`. The design is the
Claude Design canvas (https://claude.ai/artifact/BueKAjP8pmy98iZUhn4WQY), copied into
`docs/design/artboards/`. The brief it answers is `docs/design/m4-inventory-brief.md`.
Where this document and an artboard disagree on copy, the artboard wins; where they
disagree on behaviour, this document wins.

## Why

The household wants to answer "what can I make right now?" at the bar cabinet, on a
phone, in a tap or two. Claude should be able to update the bar too ("I just bought
Campari").

## Goals

- One bar for the household. Shelf items are **have**, **don't have** or **not sorted
  yet**. Fresh items are never tracked.
- The bar fills itself from the ingredients of every drink. Items can also be added by
  hand.
- Every drink is in exactly one group: can make now, only needs fresh items, missing
  something, or uses something not sorted yet.
- The Drinks browse page filters on those groups; cards and the recipe page show the
  bar state; the recipe page can flip a bottle's state with undo.
- Claude reads and changes the bar through MCP.

## Non-goals

Quantities, levels, prices, expiry, barcodes, photo recognition, a shopping list,
inventory for Food ("Cook with what you have" stays unbuilt), Kitchen mode (V2),
notifications, who changed the bar.

## Anti-goals (what would make it a failure)

- Changing one bottle takes more than a tap or two after opening the bar.
- New, unsorted items silently count as "don't have" with no hint.
- Fresh items look like things to track.
- The bar feels like a separate app rather than part of Drinks.

## Data

### The catalog is the identity registry

`<data_dir>/catalog/ingredients.json` (already exists) gains an optional `kind` per entry:
`spirits`, `liqueurs`, `aperitifs`, `bitters`, `syrups`, `other`. Labels and display order:
Spirits, Liqueurs, Aperitifs and vermouth, Bitters, Syrups, Other.

The catalog key becomes accent-insensitive: NFKD, combining marks removed, casefold,
runs of whitespace collapsed to one space, stripped. So `Crème de violette` and
`creme  de violette` are one name. The same key is used for g-per-tsp lookups (only more
lenient than before) and everywhere the bar compares names.

The catalog gets a writer. A write re-reads the file, applies the change, and writes it
atomically (`atomic_write`). Entries the change does not touch are written back exactly
as read, unknown fields included; touched entries keep their unknown fields too. If the
file exists but cannot be read, or has a newer `format_version`, every write is refused
(the bar shows the sentence; nothing is overwritten). A missing file is written fresh.

### The inventory

New file `<data_dir>/inventory.json`:

```json
{"format_version": 1, "items": {"white rum": "have", "mezcal": "dont"}}
```

Keys are item names (compared by the catalog key). A shelf item with no key is not sorted
yet. Fresh items never have a key. If the file is missing, everything is unsorted. If it
exists but cannot be read or is from a newer version, the bar reads as all unsorted, a
warning is logged, and writes are refused.

### Items

The bar's items are:

1. Every distinct ingredient of every drink recipe, resolved through the catalog (name or
   alias) to its entry. An ingredient with no catalog entry is a *virtual item*: its name
   is the `item` as written in the first drink that uses it (drinks in name order), kind
   `other`, not fresh. Two drinks writing `White Rum` and `white rum` are one item.
2. Every catalog entry with a `kind` (added by hand, or given a kind), even if no drink
   uses it ("Not in any drink yet").

Catalog entries with no kind that no drink uses (salt, cumin) are food reference data and
never show.

Each item has: `name`, `aliases`, `kind` (`other` when the entry has none), `fresh`,
`state` (`have`, `dont`, or `null` for unsorted; always `null` for fresh), `used_in`
(the drinks that use it, `{slug, name}`, in name order) and `recipe`: a drink in the
`syrups` category whose name matches the item's name or an alias by the catalog key, as
`{slug, name}`, else `null`.

The bar is **set up** once any item has a state.

### A drink's status

From its ingredients' items, in this order:

1. any `dont` → `missing` (the names, in recipe order);
2. otherwise any unsorted shelf item → `unsorted` (the names);
3. otherwise any fresh item → `fresh_only` (the fresh names);
4. otherwise → `can_make`.

A drink with no ingredients is `can_make`. Each drink's `bar` is
`{status, missing: [...], unsorted: [...], fresh: [...]}`; all three lists are always
present (fresh lists every fresh ingredient, whatever the status).

### Changes

One change model, used by the app and by Claude, applied all-or-nothing under one lock:

| Field | Meaning |
| --- | --- |
| `have`, `dont_have` | Set the state. An unknown name is added as a new item, kind `other`. |
| `unsorted` | Clear the state (the app's undo). An unknown name is an error. |
| `fresh` | Mark fresh and clear the state. An unknown name is added as a fresh item. |
| `not_fresh` | Back on the shelf, unsorted. |
| `kinds` | `{name: kind}`. A new name in `have` or `dont_have` is added with this kind. |
| `add_names`, `remove_names` | `{name: [other names]}`. |
| `fold` | `{name: into}`. |
| `delete` | `[names]`. The app only; Claude cannot delete. |

Order: fold, names, fresh and not fresh, kinds, states, delete. A name in two lists that
contradict each other (`have` and `dont_have`, `fresh` and `not_fresh`, `have` and
`fresh`, any list and `delete`) is refused. Any change to a virtual item, or to a catalog
entry with no kind, creates or updates its catalog entry and gives it kind `other` if it
has none (so it stays on the bar). Writes go to the catalog first, then the inventory.

- **Names.** An added name that already belongs to another item (a catalog name or alias,
  or a virtual item's name) is refused: "‘X’ is already an item. Fold one into the other
  instead." Removing a name the item does not have is refused. An item's own name cannot
  be removed.
- **Fold A into B.** B gains A's name and aliases as aliases; B takes A's state if B has
  none and A's g-per-tsp if B has none; A's catalog and inventory entries go. If B is
  virtual it gets a catalog entry with A's kind and fresh. Folding into itself, or into an
  unknown name, is refused. Drinks that said A now resolve to B.
- **Delete.** Only when no drink uses the item: "Only items no drink uses can be deleted."
  The inventory state and the kind go; the catalog entry goes too unless it has a
  g-per-tsp, which is kept (with its names).
- **Unknown kind** values, unknown fields, or more than 200 names in one change are
  refused by validation.

## API

- `GET /api/bar` → `{items: [...], set_up, counts: {can_make, fresh_only, missing,
  unsorted, total}}`. Items sorted by name (catalog key).
- `POST /api/bar` with a change body → the same shape, after the change. Refusals are
  400 with `{"error": sentence}`; an unreadable catalog or inventory is 503 with its
  sentence.
- Drinks summaries in `GET /api/recipes?side=drinks` gain `bar`. Food summaries don't.
- `GET /api/recipes/drinks/<slug>` gains `bar` on the recipe and, per ingredient,
  `bar: {item, state, fresh, recipe}` (`item` is the bar item's name).

## MCP

- `read_bar()`: the same as `GET /api/bar`.
- `manage_inventory(have, dont_have, fresh, not_fresh, kinds, add_names, remove_names,
  fold)`: the change model without `delete`. Returns the bar. Refusals are `ToolError`s
  with the same sentences.
- `list_recipes` and `search_recipes` entries for drinks gain `bar`. `search_recipes`
  gains `bar: "can_make" | "fresh_only" | None`, only for drinks (for food it is
  refused: "The bar filter is for drinks only.").
- `INSTRUCTIONS` add one sentence: the drinks side has a bar (read_bar,
  manage_inventory); fresh items are never tracked.

## Screens

Copy is the artboards'. Names display capitalised (first letter). All toggles have the
artboards' aria-labels; state is never shown by colour alone (icon plus text).

### The bar page (`/bar`)

A static route before `/:side`, on the Drinks theme (`Shell side="drinks"`). A drink
slugged `bar` is still reached at `/drinks/bar`, so nothing clashes.
Artboards: `BarPhone`, `BarDesktop`, `BarFirstVisitPhone`, `BarSearchEmptyPhone`.

- Title "The bar"; desktop has a back link "Drinks" and the 56 px h1.
- Subtitle: set up → "One bar for the household · {have} of {total} bottles in"; not set
  up → "Lækkert found {total} bottles in your drinks. Tap Have for each one in your
  cabinet." `total` counts shelf items.
- Not set up: a progress line "{sorted} of {total} sorted" with a bar.
- Can-make card (set up only): "You can make {N drinks|1 drink} now", linking to
  `/drinks?bar=can`. Desktop shows it in the aside ("From this bar", "You can make N now",
  "See them"; "Every bottle is sorted" when nothing is unsorted).
- Search field filters by name, then aliases (lowercased, accents stripped, substring).
  An alias match shows "Also called {alias}" instead of the used text. Client-side.
- "Not sorted yet" section first when there are any, with the count, the help text
  (everyday: "New from drinks you added. Until you sort them, drinks that use them count
  as missing."; not set up: "Nothing is sorted yet, so no drink shows under ‘Can make
  now’. Tap what you have, then mark the rest in one go."), per item Have / Don't have
  buttons, grouped by kind, and the bulk button "Mark it as don’t have" (one) / "Mark the
  other {N} as don’t have", which marks every unsorted item (the visible ones only when
  searching).
- Sorted items grouped by kind in the fixed order, header "{have} of {n} in", empty groups
  hidden. Each row: name, used text ("Not in any drink yet" / "Used in 1 drink" /
  "Used in N drinks"), and a one-tap toggle (have: filled, check icon, "Have"; don't have:
  dashed outline, minus-circle icon, "Don't have"). aria-label "{Name}: have. {Tap|Click}
  if you've run out." / "{Name}: don't have. {Tap|Click} when you've bought it." (Tap on
  phone, Click on desktop). The row's name opens the item sheet; desktop has a 44 px "⋯"
  button, aria-label "More for {name}".
- Fresh section: "Fresh, so never tracked", "Buy these when a drink needs them. Those
  drinks say ‘Buy fresh’.", items as chips that open the sheet, and the footnote "Open a
  bottle or a fresh item to move it between the two."
- "Add a bottle" focuses the search field (its job is search-then-add).
- No match for "{q}": "No bottle called ‘{q}’", the artboard's sentence (phone and desktop
  differ), "Add ‘{q}’ to the bar" (adds it as have, kind other, name as typed) and "It's
  fresh: add it without tracking". Both clear the search.
- A toggle updates at once (optimistic) and rolls back with the server's sentence if the
  write fails. Each write returns the whole bar, which replaces the page's copy.

### The item sheet

`BarItemSheetPhone`: a `<dialog>`, a bottom sheet on phone, a centred dialog on desktop
(my call; there is no desktop artboard). Title is the name; subtitle "{Kind} · used in N
drinks". The "In the bar" radiogroup (Have / Don't have) hides when fresh. "Used in" links
to each drink. "Other names" with removable chips (aria-label "Remove the name {name}")
and "Add another name" + Add. "Kind" radio list. "Fresh item" switch with "Never tracked.
Drinks that use it say ‘Buy fresh’." "Same bottle as another item?" with "Fold into
another item" (a picker of the other items, then a confirm) and its help text. "Delete
from the bar", disabled with "Only items no drink uses can be deleted. {N drinks use|1
drink uses} {name}." when used, otherwise with a confirm. Each action is one change;
errors show inside the sheet.

### Drinks browse

`DrinksDesktop`, `DrinksPhone`, `DrinksNoBarDesktop`, `DrinksNoBarPhone` (variants `nobar`
and `nofresh`), `DrinksFilterEmptyPhone`.

- A "From your bar" filter in the URL as `bar=can|fresh` (absent = everything). Desktop:
  a radiogroup in the filter panel, "Everything {n}", "Can make now {n}", "Only need fresh
  items {n}", and a link "Edit the bar" ("Set up the bar" when not set up). Phone: chips
  "All {n}", "Can make {n}", "Fresh only {n}" under the heading. Counts follow the other
  filters, like the other facets.
- A "The bar" link: a masthead button on phone, a top-nav link on desktop (drinks side).
- An unsorted banner when set up and any item is unsorted: desktop "{N} bottle(s) not
  sorted yet. Drinks that use them count as missing." + "Sort them"; phone "{N} new
  bottle(s) not sorted yet" + "Sort". Both link to `/bar`.
- Desktop result line: "{N} drinks · {M} you can make right now".
- Card badges: "Can make now"; "Buy fresh: {x}" (phone "Buy: {x}"); "Missing: {x}";
  "Not sorted: {x}". Lists of more than two names show the first two and "+N".
- Empty states, when the bar filter leaves nothing:
  - Not set up: "Set up your bar first", the artboard's sentence (phone "Tap Have for each
    bottle you own."; desktop "Mark each bottle as have or don't have."), "Set up the bar",
    "Show all {N} drinks".
  - `can` empty, fresh-only not: "Nothing without a trip to the shop", "You have the
    bottles for {N} drinks, but every one needs something fresh. {Item} covers {k} of
    them." (one drink: "You have the bottles for 1 drink, but it needs something fresh:
    {item}."), "Show the {N} that need fresh items" / "Show the drink that needs fresh
    items", "Open the bar". `{Item}` is the fresh item most of those drinks need.
  - Otherwise (my call): "Nothing to make yet", "Every drink is missing a bottle or uses
    one not sorted yet.", "Open the bar", "Show all {N} drinks".

### A drink's recipe page

`DrinkRecipePhone`, `DrinkRecipeDesktop`. Food pages are unchanged.

- Summary line above the rows: "Missing: a, b" (minus-circle) or "From your bar: {n} of
  {n}" (check), plus "Buy fresh: x, y" (basket) when there are fresh items. Unsorted items
  count as missing in this line.
- Each shelf row has its state button ("In the bar" / "Not in the bar", unsorted shows
  "Not sorted"); tapping flips have ↔ don't have (unsorted → have). aria-label "{item} is
  in the bar. {Tap|Click} if you've run out." / "{item} is not in the bar. {Tap|Click}
  when you have it." Fresh rows show "Fresh, buy when needed", no button.
- After a flip, an undo row under that ingredient: "Marked as in the bar." / "Marked as
  not in the bar." + Undo, which restores the previous state (unsorted included). One undo
  at a time.
- A syrup with a recipe: "Recipe: {Name}", or "Out? Make it: {Name}" when not in the bar;
  links to it.
- The stepper reads "1 drink" / "N drinks", 1 to 12, aria-label "Drinks to make".
- Desktop top nav has "The bar".

## Seed and existing installs

The seed catalog adds `soda water` (fresh) and kinds for `white rum` (spirits) and
`simple syrup` (syrups). The seed only writes a missing catalog, so on the NAS those items
show as Other until someone sets a kind; Claude can do that with `manage_inventory`.

## Left to the builder

Component and CSS structure, exact spacing from the artboards, the fold picker's look,
and test layout, following the existing code's patterns.
