# Design snapshot

The visual design for Lækkert was made as a canvas of artboards in Claude. Artifact:
https://claude.ai/artifact/BueKAjP8pmy98iZUhn4WQY

`artboards/` holds a verbatim copy of its `project/` files (`canvas.json` and the ten
`*.dc.html` artboards), so the design survives the artifact. They are design-tool files, not app
code: read them as text to lift colours, SVG paths, spacing and type. Do not run them. They
load Google Fonts and a `support.js` that is not part of the snapshot; the app does neither
(fonts are self-hosted through `@fontsource`).

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
| `RecipeDesktop.dc.html`, `RecipePhone.dc.html` | `RecipeView.tsx`, `Ingredients.tsx` (Task 8) |
| `EditorDesktop.dc.html` | not built (M2) |
| the header and phone bottom bar of all of them | `Shell.tsx` (Task 6) |

Icons and the photo-less tile glyphs (bowl, pot, plate; rocks, highball, coupe) are in
`web/src/icons.tsx`.

## Not built in M1

- Ratings: stars on cards and the page, and the "Rating" and "Recently made" sorts. M2
  (timeline).
- History, notes, "Restore this version", Edit, New recipe and the editor artboard. M2.
- Mark toggles on the recipe page. M2; M1 shows marks read-only.
- "Cook with what you have", "Can make now", "Buy fresh" and "From your bar". After the PoC.
- The signed-in avatar. There are no users in the PoC.

## Differences from the design

- The design's sample categories (Breakfast, Soups, Sours, ...) are placeholders. The app has
  food mains, sides, desserts, sauces and prep, and drinks cocktails, mocktails, syrups and prep.
- The brand reads "Lækkert", not "Recipes".

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

`screenshots/m1/` holds what the built M1 UI looks like, for comparing against the artboards:
`food-grid-*`, `food-list-*`, `drinks-*`, `recipe-*` (phone 390 x 844 at 2x, desktop 1440 x 1000)
and `filter-sheet-phone.png`. They were taken from the app running on three example recipes plus
two with generated photos; the gradient "photos" are placeholders, not recipe images.
