# Design brief: the bar (drinks inventory, M4)

Paste this into a Claude Design session. It continues the Lækkert design canvas:
https://claude.ai/artifact/BueKAjP8pmy98iZUhn4WQY

## What Lækkert is

Lækkert is a recipe app for two people, Serwan and his partner. It has two sides that never
mix: Food and Drinks. Drinks uses the darker masthead theme of the existing canvas. Most use
is on a phone, standing in the kitchen or at the bar cabinet. The desktop matters less but
should still be good.

The canvas already has the browse pages (grid and list, phone and desktop), the filter
sheet, the recipe page and the editor. Keep their look: the tokens, Young Serif for headings
and Hanken Grotesk for everything else, cards and photo-less glass glyphs (rocks, highball,
coupe), and touch targets of at least 44 px. Use British spelling and sentence case.

## What this milestone adds

The app learns what is in the bar, so it can answer "what can I make right now?"

- **Shelf-stable items** (spirits, liqueurs, vermouth, bitters, syrups, mixers that keep) are
  tracked as **have** or **don't have**. Nothing else: no quantities, no "half a bottle".
- **Fresh items** (limes, lemons, mint, soda water, egg white, ice) are **marked as fresh and
  never tracked**. The app assumes you buy them when you need them.
- Every drink therefore falls into one of three groups:
  - **Can make now**: you have every shelf item it needs, and it needs nothing fresh.
  - **Only need fresh items**: you have every shelf item, but it needs something fresh,
    for example "Buy fresh: limes".
  - **Missing something**: at least one shelf item isn't in the bar.
- Claude can also update the bar ("I just bought Campari") through the app's MCP connector.
  That needs no screen. The bar just has to show the change the next time it opens.

The browse page already sketches this. `DrinksDesktop` has the "From your bar" filter
(Everything 24, Can make now 15, Only need fresh items 6), an "Edit inventory" link and the
"Can make now" and "Buy fresh: …" badges on cards. `DrinksPhone` has the same filter as
chips: All, Can make, Fresh only. Keep those and design what is missing.

## How the data works

Design within these rules:

- **There is one bar for the household.** Both people see and change the same bar.
- **The list fills itself.** The bar's items come from the ingredients of every drink
  recipe. A new recipe that uses "maraschino liqueur" adds it to the bar as **not sorted
  yet**. Until someone says "have" or "don't have", it counts as not had. Items can also be
  added by hand, for a bottle no recipe uses yet.
- **Fresh is a property of the item**, set once: lime juice is fresh in every recipe. Moving
  an item between fresh and shelf-stable is rare but must be possible.
- **Names must match.** A recipe says "white rum" and the bar has "Rum". An item therefore
  can have other names ("also called white rum, light rum"), and the app treats them as the
  same item. When two items turn out to be the same, one can be folded into the other. This
  is rare, done once per item, and fine to tuck away.
- **Some syrups are recipes.** Drinks has a Syrups category, so "simple syrup" can be both
  a bar item and a recipe for making it. A homemade syrup is tracked like any other shelf
  item, since it keeps for weeks. Where a syrup has a recipe, link to it.
- Ingredients have no type such as "spirit" or "bitters" today. If grouping the bar by type
  would make the screen much better, say so and show it, and we'll add the field. Otherwise
  group by state.

Realistic sample bar for the mock-ups:

- **Have:** gin, white rum, aged rum, bourbon, rye whiskey, tequila blanco, vodka,
  Campari, sweet vermouth, dry vermouth, Cointreau, Angostura bitters, orange bitters,
  simple syrup, coffee liqueur.
- **Don't have:** mezcal, maraschino liqueur, Chartreuse, Aperol, orgeat.
- **Not sorted yet:** falernum, crème de violette.
- **Fresh:** lime juice, lemon juice, grapefruit, mint, soda water, egg white, espresso.

## Screens to design

Phone first for each, then desktop. Add them to the same canvas as new artboards, and
change existing artboards only where a section below says so.

### 1. The bar (the inventory editor)

This is where "Edit inventory" goes. On the phone it is a full page or a tall sheet from
the Drinks browse page; on desktop it is a page or a side panel, whichever reads better
next to the filter panel.

It needs:

- **A fast have / don't-have toggle per item**, one tap. The main job is "I ran out of
  Campari" or "we bought mezcal" in under five seconds, so it needs search or
  type-to-filter at the top.
- **Not sorted yet**, shown first and clearly when there are any, with a way to sort them
  quickly. This is the common case after importing a few new drinks.
- **Fresh items** in their own quiet section, explained once ("Fresh, so never tracked:
  buy when needed"), with no toggles. They need a way to move an item out of fresh, and a
  way to mark a shelf item as fresh.
- **Adding an item by hand.**
- **The rare per-item actions** (other names, fold into another item, delete one no
  recipe uses), tucked behind the item. Show this item detail or sheet as its own
  artboard.
- **How many drinks each item matters for** is worth showing if it fits, for example
  "Used in 6 drinks". It helps decide what to buy.
- **States:**
  - **First visit:** nothing sorted yet, so every item is "not sorted yet".
  - **Everyday:** everything sorted.
  - **Search with no match:** this offers "Add 'falernum' to the bar".

### 2. The Drinks browse page with the bar applied

These are updates to `DrinksDesktop` and `DrinksPhone`.

- **The three filters are in the artboards already.** Check that they and their counts
  work in the empty states below.
- **Cards in the "missing something" group** should probably say what is missing when it
  is one or two items ("Missing: Campari"). Show this, or argue it away.
- **"Buy fresh: limes"** stays as designed.
- **Empty states:**
  - **The bar has never been set up:** "Can make now" shows 0 and should invite setting
    up the bar, not look broken.
  - **No drink matches the chosen filter,** for example "Can make now" is empty because
    everything needs limes.

### 3. A drink's recipe page

This updates `RecipePhone` and `RecipeDesktop`, drawn here for a drink on the Drinks theme.

- **Each ingredient shows its bar state** at a glance: in the bar, not in the bar, fresh.
  Use icon plus text or shape; never colour alone.
- **One summary line near the ingredients,** for example "From your bar: 3 of 3 · Buy
  fresh: lime juice" or "Missing: Campari".
- **Changing the bar from the ingredient row:** this is when you notice you've run out.
  Tapping a shelf item's state toggles have / don't have, with a clear way to undo.
- **A syrup with its own recipe** links to it from the row.

## Not in this milestone

- Quantities, levels, prices, expiry dates, barcode scanning or photo recognition of
  bottles.
- A shopping list. "Buy fresh" and "Missing" are labels, not a list to tick off.
- Inventory for the Food side. Food's "Cook with what you have" is a separate, simpler
  filter.
- Kitchen mode (the step-by-step cooking view). It moves to V2 with its own design.
- Notifications, or showing who changed the bar.

## What would make it a failure

- Updating one bottle takes more than a tap or two after opening the bar.
- New, unsorted items quietly count as "don't have" with no hint, so a drink you can make
  never shows under "Can make now".
- Fresh items look like things you are meant to track.
- The bar feels like a separate app rather than part of Drinks.

## Deliverables

- **New artboards:**
  - `BarPhone` and `BarDesktop` (everyday);
  - `BarFirstVisitPhone`;
  - `BarItemSheetPhone` (other names, fold, fresh, delete);
  - `BarSearchEmptyPhone`.
- **Updated artboards:**
  - `DrinksPhone` and `DrinksDesktop`, with a "missing" card and the never-set-up empty
    state (as new variants, or as extra artboards next to them);
  - `DrinkRecipePhone` and `DrinkRecipeDesktop`: the recipe page for a drink, for
    example a Negroni or a Daiquiri, with bar states on the ingredients.
- **A short note on what you decided and why**, in particular the item detail and any
  argument for grouping by type.
