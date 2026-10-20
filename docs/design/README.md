# Design snapshot

The visual design for Lækkert was made as a canvas of artboards in Claude. Artifact:
https://claude.ai/artifact/BueKAjP8pmy98iZUhn4WQY

`artboards/` holds a verbatim copy of its `project/` files (`canvas.json` and the 21
`*.dc.html` artboards; the M4 session added eleven and updated four), so the design survives
the artifact. They are design-tool files, not app code: read them as text to lift colours,
SVG paths, spacing and type. Do not run them. They load Google Fonts and a `support.js` that
is not part of the snapshot; the app does neither (fonts are self-hosted through
`@fontsource`).

## Export format (decided in M1)

The design tool's export is a set of HTML artboards with inline styles and a `canvas.json`
layout, not code to ship. They are kept verbatim in `artboards/` as the reference and rebuilt
by hand as React components with CSS in `web/src/styles/`: colours and fonts become the tokens
below, SVG paths and spacing are lifted from the artboards as text. Nothing from the export is
loaded at runtime.

## Artboard to component

| Artboard | Built as |
| --- | --- |
| `Main.dc.html` (Food, grid, desktop) | `Browse.tsx`, `RecipeCard.tsx`, `PhotoTile.tsx`, `FilterPanel.tsx` (Task 7) |
| `FoodListDesktop.dc.html` | same, list view |
| `FoodGridPhone.dc.html`, `FoodListPhone.dc.html` | same, phone |
| `FilterSheetPhone.dc.html` | `FilterPanel.tsx` as a phone sheet (Task 7) |
| `DrinksDesktop.dc.html`, `DrinksPhone.dc.html` | same pages with the Drinks theme (Task 7) |
| `RecipeDesktop.dc.html`, `RecipePhone.dc.html` | `RecipeView.tsx`, `Ingredients.tsx` (Task 8); the history section is `History.tsx`, ratings are `Stars.tsx` (M2) |
| `EditorDesktop.dc.html` | `Editor.tsx` (M2); the same form is the phone editor, one column with a fixed Cancel and Save bar |
| `EditorPhone.dc.html` | the phone layout of `Editor.tsx` (M2). It arrived with the M4 snapshot, after the phone editor was built, and has not been checked against it |
| `BarPhone.dc.html`, `BarDesktop.dc.html` | `BarPage.tsx` (M4), styles in `bar.css` |
| `BarFirstVisitPhone.dc.html`, `BarSearchEmptyPhone.dc.html` | `BarPage.tsx`: the first visit (nothing sorted) and a search with no match |
| `BarItemSheetPhone.dc.html` | `BarItemSheet.tsx` (M4): names, kind, fresh (Track it since M6), fold and delete; a sheet on phone, a dialog on desktop |
| `DrinksPhone.dc.html`, `DrinksDesktop.dc.html` (M4 update) | the views in `FilterPanel.tsx` and the phone chips (M6; they replaced the bar filter), the unsorted banner in `Browse.tsx`, the status badges in `RecipeCard.tsx` |
| `DrinksNoBarPhone.dc.html`, `DrinksNoBarDesktop.dc.html`, `DrinksFilterEmptyPhone.dc.html` | the Can make view's empty states in `Browse.tsx` |
| `DrinkRecipePhone.dc.html`, `DrinkRecipeDesktop.dc.html` | `RecipeView.tsx` and `Ingredients.tsx` (M4): the bar summary, each row's state with Have/Not in bar/Fresh, undo |
| the header and phone bottom bar of all of them | `Shell.tsx` (Task 6) |

Icons and the photo-less tile glyphs (bowl, pot, plate; rocks, highball, coupe) are in
`web/src/icons.tsx`.

## Built in M2

The editor (`EditorDesktop`, plus a phone layout that has no artboard), the history section of
the recipe page with its notes, ratings, "Made it" form, mark entries, readable diffs and
"Restore this version", the mark toggles (Favourite and Try next; Tried is shown as status
only), and ratings on cards with the "Rating" and "Recently made" sorts.

## Built in M4

The bar (`/bar`): every drink ingredient and every catalog entry with a kind, grouped by kind,
with Have and Don't have toggles and a separate list of fresh items; search that offers to
add a missing name as a bottle or as fresh; the first visit, with the unsorted bottles first
and "Mark the other N as don't have"; and the item sheet for state, other names, kind, fresh,
fold and delete. On the drinks page: the From your bar filter (Everything, Can make now, Only
need fresh items) and its phone chips, the "not sorted yet" banner, a status badge on each
card (Can make now, Buy fresh, Missing, Not sorted) and the empty states for a bar that was
never set up and for a filter with no drinks. On a drink's page: the bar summary, each
ingredient's state with its own toggles and an undo bar, and a link to the recipe for a
syrup. Logic shared by these is in `bar.ts`.

## Built in M5

"Cook with what you have" (Food), with no artboard. It follows the drinks page's patterns:
- a What you have section in the filter aside on desktop;
- a basket button in the phone header that opens the field;
- chips with Remove buttons;
- a badge on each card ("Have everything", "Missing: a, b +N") in the drinks badge position
  with food colours;
- the empty state "Nothing uses …".

The field is `HaveField.tsx` and the badge text is in `haveBadge.ts`.

## Built in M6

The drinks views and tracking only the bottles, with no artboard. They follow the M4 bar
designs:
- the From your bar filter and the Style section are replaced by four views (Can make, All
  drinks, Mocktails, Syrups & prep): radios with counts under Show in the desktop aside,
  chips with counts in the phone header;
- a can-make card whose drink also uses untracked items says "Also needs: …" in the badge
  position, with the basket icon;
- on the bar page, a Not tracked section of chips replaces Fresh, and not-sorted rows get a
  "Don't track" button;
- the item sheet's Fresh switch is a Track it switch, disabled with the reason for syrups
  and for items that have a recipe;
- on a drink's page, the bar summary counts bottles and says what else the drink needs.

## Still not built

- Drag handles in the editor. Rows and steps move with "Move up" and "Move down" buttons.
- Avatars, in the header and on timeline entries. There are no users in the PoC, so entries
  show no author.
- The artboards' "..." menu on the recipe page.

## Differences from the design

M4 (the bar), where the app and the artboards differ:

- `BarFirstVisitPhone` shows a "You can make 0 drinks now" card; the app shows the summary
  card only once the bar is set up.
- The phone recipe page uses the phone artboard's short labels ("Not in bar", "Fresh"); the
  desktop uses the long ones.
- The drink recipe page keeps the tsp / g-ml toggle, and the "Recipe: ..." link next to a
  syrup is 44 px tall rather than 32 px.
- A status badge with a long name wraps to two lines on a phone card instead of being cut
  off at the artboard's fixed 26 px height.

Earlier milestones:

- The design's sample categories (Breakfast, Soups, Sours, ...) are placeholders. The app has
  food mains, sides, desserts, sauces and prep, and drinks cocktails, mocktails, syrups and prep.
- The brand reads "Lækkert", not "Recipes".
- Kid approved is a tag, not a mark. The artboards' Kid approved toggle and kid icon are left
  out; a "kid approved" tag looks like any other tag. The marks are Favourite, Try next and
  the status Tried.
- A change of rating shows as bold text ("Changed the rating 4.0 → 4.5"), not the artboard's
  pill.

## Tokens

Defined in `web/src/styles/tokens.css`. `:root` is the Food theme; `[data-side='drinks']`
overrides it. `Shell` sets `data-side` on its root (and on `<html>`, so the page background
follows).

- Surfaces and text: `--bg`, `--surface`, `--bar`, `--border`, `--border-strong`, `--rule`,
  `--text`, `--muted`, `--label`
- Accent: `--accent`, `--accent-ink`, `--accent-soft`, `--accent-soft-ink`, `--on-accent`
- Controls and tiles: `--track` (nav pill background), `--tile`, `--tile-ink` (photo-less card
  tile), `--card-rule` (rule inside a card), `--star`
- Fonts: `--font-serif` (Young Serif: headings, recipe names, step numbers), `--font-sans`
  (Hanken Grotesk 400/500/600/700: everything else)
- Drinks masthead: `--masthead`, `--masthead-ink`, `--masthead-muted`, `--masthead-eyebrow`,
  `--masthead-border`, `--masthead-raised`, `--masthead-track`, `--masthead-pressed`,
  `--masthead-brand`, `--masthead-cta`
- Chrome (header and bottom bar; Drinks maps these to the masthead): `--bar-ink`,
  `--bar-border`, `--bar-shadow`, `--brand`, `--nav-ink`, `--btn`, `--btn-border`, `--btn-ink`,
  `--seg-*` (grid/list toggle), `--cta`, `--cta-ink`

Drinks has no separate `--rule` in the design; it reuses `--border`.

Layout: desktop is `(min-width: 768px)`; phone has 16 px gutters (`.gutter` in `base.css`) and
every control is at least 44 x 44 px.

## Screenshots

`screenshots/m6/` holds the drinks views and the untracked items:
- `drinks-can-make-*`, `drinks-mocktails-*` and `drinks-syrups-*` (the three views other than
  All drinks);
- `bar-not-tracked-*` (the bar page with a not-sorted bottle and the Not tracked section);
- `bar-item-sheet-phone` (Mint, with Track it off), `bar-item-sheet-syrup-phone` (Track it
  disabled for a syrup) and `bar-item-sheet-desktop`;
- `drink-recipe-*` (the Mojito, with Also needs).

Phone shots are 390 wide and desktop 1440, at 1x; the bar pages and the recipe page are
full-page shots, the rest are 390 x 844 and 1440 x 900. They were taken from a scratch data
directory with the seed recipes plus eight test drinks. The app has one theme, so there are
no dark shots.

`screenshots/m5/` holds "Cook with what you have":
- `food-have-desktop` and `food-have-phone` (`?have=chicken&have=leeks`, with the phone
  panel open);
- `food-have-empty-phone` (no recipe uses the terms).

They were taken the same way as M4's, from a scratch data directory with five extra food
recipes. The app has one theme, so there are no dark shots.

`screenshots/m4/` holds the bar and the drinks inventory: `bar-phone`, `bar-desktop`,
`bar-first-visit-*` (nothing sorted), `bar-search-empty-*`, `bar-item-sheet-*`,
`drinks-phone`, `drinks-desktop`, `drinks-can-make-*` (`/drinks?bar=can`), `drinks-no-bar-*`
(the bar never set up), `drinks-filter-empty-*` (nothing to make without fresh items) and
`drink-recipe-*`. Phone shots are 390 wide and desktop 1440, at 1x; the bar pages and the
recipe page are full-page shots, the rest are 390 x 844 and 1440 x 900. They were taken from
a scratch data directory with the seed recipes plus nine test drinks, with metric units.

`screenshots/m2/` holds the editor (`editor-desktop`, `editor-phone`, `editor-drinks-phone`),
the recipe page scrolled to its history (`recipe-history-desktop`, `recipe-history-phone`) and
the food grid sorted by rating (`food-grid-rating-desktop`). Phone shots are 390 x 844 and
desktop 1280 x 900, at 1x. They were taken from a scratch data directory with generated
gradient photos, not recipe images.

`screenshots/m1/` holds what the built M1 UI looks like, for comparing against the artboards:
`food-grid-*`, `food-list-*`, `drinks-*`, `recipe-*` (phone 390 x 844 at 2x, desktop 1440 x 1000)
and `filter-sheet-phone.png`. They were taken from the app running on three example recipes plus
two with generated photos; the gradient "photos" are placeholders, not recipe images.
