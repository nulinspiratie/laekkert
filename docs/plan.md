# Lækkert: PoC plan

High-level plan for the proof of concept of the recipe app described in
`docs/requirements-v1.md`. Each milestone gets its own detailed
implementation plan under `docs/superpowers/plans/`.

## Goal

Prove the parts that are expensive to change later:

- the recipe file format and storage layout;
- the reading experience on a phone (servings scaling, tsp/tbsp toggle);
- editing with a timeline;
- Claude adding recipes end to end over MCP, **from claude.ai on a phone**;
- the whole thing running on the NAS behind Cloudflare Access.

Everything else in V1 comes after the PoC.

## Decisions

- **Backend:** the template's Starlette app, plus `pydantic` (recipe format), `rapidfuzz`
  (typo- and word-order-tolerant search), the official `mcp` SDK (2.x, `MCPServer`)
  mounted at `/mcp` in the same process (stateless streamable HTTP, JSON responses), and
  `httpx2` for image fetching. One process; at a few hundred recipes no database is
  needed.
- **Frontend:** Vite + React + TypeScript in `web/`, built to static files that Starlette
  serves (the "mixed" archetype in `docs/dockerfile-archetypes.md`). No Node at runtime.
- **Users:** none in the PoC. There is no login and no author mapping; Cloudflare Access
  is the only gate. Timeline entries record *how* they were made (`via: "app"` or
  `via: "claude"`), and an `author` field can be added with the two-user work later.
- **Claude on the phone:** claude.ai custom connectors need OAuth (they support Dynamic
  Client Registration) and cannot send Cloudflare service-token headers. The plan is for
  Cloudflare Access to act as the OAuth server for `/mcp` (Access's MCP/OAuth support on
  the app's Access application), so the app itself has no auth code. **Proven in M0:**
  with Managed OAuth (and Dynamic Client Registration) on the Access application,
  claude.ai registers itself, signs in through Access and calls the read-only tools; the
  Claude service token still works for cloud sessions. The fallback (exempt `/mcp` from
  Access, add the MCP SDK's own OAuth to the app) is not needed.
- **Seed data:** the app ships a few example recipes and copies them into `/data` the
  first time it starts with no recipes (`seed_examples` in `config.toml`). Bar Book
  recipes come later through the Claude import flow.
- **Photos on import:** the app is only for Serwan and his partner, behind Cloudflare
  Access, so no photo is republished and any photo is fine. A URL import keeps the source
  page's own photo (`og:image`) next to the source link; a recipe with no source may get
  any photo from the web that shows the dish well. The server does not check licences.
- **Photos from the chat:** an MCP tool receives JSON only, so Claude can read a photo in
  the chat (a cookbook page, a handwritten card) but cannot hand its bytes to the app.
  There is no upload tool; Claude transcribes the recipe and the photo is added with the
  app's upload button. The style guide says so.
- **Design:** the Claude Design session's output is migrated at the start of M1. Its
  export format (HTML artboards) is kept as a snapshot and rebuilt as components; see
  `docs/design/README.md`.

## Storage (under `/data`, Git-friendly)

```
recipes/<side>/<slug>/recipe.json        # format_version, current state
recipes/<side>/<slug>/timeline.jsonl     # one entry per line: created, baseline, edit, note,
                                         # rating, made, marks (each with id, at, via)
recipes/<side>/<slug>/versions/0003.json # snapshot per edit → diffs + rollback
recipes/<side>/<slug>/<image>            # optional photo / source photo
uploads/                                 # photos parked on pick; Save moves them into the
                                         # recipe folder; files over a day old are removed
trash/<side>/<slug>-<UTC stamp>/         # deleted recipes; getting one back is a file move
catalog/ingredients.json                 # canonical names, aliases, g_per_tsp, fresh flag,
                                         # kind (the bar's shelf groups)
inventory.json                           # the bar: item name → have / dont; no key = unsorted
```

`<side>` is `food` or `drinks`. Writes are atomic (temp file in the same folder, then
rename). Ingredient rows hold `amount`, `unit` (`g`, `ml`, `piece`, `dash`, `pinch`,
`to taste`), `item`, `note`, `no_scale`, and `original` (the amount as written, e.g.
"1 tsp", when no conversion exists yet; requirement 8's flag). tsp display: ml converts
directly (5 ml per tsp), g needs the catalog's `g_per_tsp`.

## Milestones

### M0: Skeleton, first deploy, MCP from the phone

Detailed plan: `docs/superpowers/plans/2026-10-19-m0-skeleton.md`.

Recipe format v1 with migrations hook, read-only store with seed recipes, JSON API,
unstyled React list/detail with the Food/Drinks switch, `/mcp` with `list_recipes` and
`read_recipe`, Dockerfile/CI for the mixed archetype, first deploy and the home-server
PR. Done when claude.ai on Serwan's phone lists the seeded drinks through the connector.

**Done** (2026-10-19): deployed as `1390c71`; the claude.ai connector lists Daiquiri and
Virgin mojito. Found on the way: uid 1000 cannot read the NAS's home-server checkout
(DSM home-folder ACLs), so the config applier now copies `config.toml` to
`/volume1/docker/laekkert/config.toml` and the stack mounts that copy (home-server
`de72be0`, `cd2ddf3`; template fix in nas-app-template PR 3). Two minors left for later:
an encoded NUL in a page path (`/%00`) answers 500 instead of the app; and `main.py`
lifts the MCP sub-app's routes without its middleware, which matters only if M3 ever
needs the MCP SDK's own auth.

### M1: Reading (design migration happens here)

Migrate the Claude Design output. Food/Drinks with own accent colour; list, detail,
categories, responsive layout; servings stepper with sensible rounding and `no_scale`;
tsp/tbsp toggle with flagged missing conversions; fuzzy search; tag and mark filters;
default food view (kid approved, by cooking time); photo-less recipes that look
intentional; PWA manifest.

**Done:** the design is migrated
as React components with the Food and Drinks themes; browse page with grid and list, fuzzy
search, mark, category and tag filters, the default kid-approved view and the phone filter
sheet; recipe page with the servings stepper (rounding, `no_scale`) and the tsp/tbsp toggle
with flagged missing conversions; photo-less tiles; recipe images served from `/data`; the
ingredient catalog; an installable PWA manifest with icons (no service worker, so no offline
yet). The built UI was checked against the artboards at phone and desktop widths with no
horizontal scroll at 360 px; the screenshots are in `docs/design/screenshots/m1/`. Claude
Design's export format is decided: HTML artboards kept as a reference snapshot and rebuilt as
components, see [docs/design/README.md](design/README.md).

### M2: Editing and timeline

Form editor (all fields of requirement 5, image upload); tags and marks with their rules
(favourite implies tried, try next clears on the first tasting); timeline with notes,
ratings and edits; snapshot per edit with a readable diff; rollback.

**Done** (2026-10-20): the recipe editor (new and edit, one form for both sides, photo and
source photo upload, delete to `trash/`), the timeline on the recipe page (notes, half-star
ratings, a "Made it" entry, mark changes, edits with a readable diff) and "Restore this
version", which writes the old content as a new version. Versions start at `0001` on create;
recipes that predate M2 get a `baseline` entry on their first edit. Recipe format 2 drops
the Kid approved and Kids rejected marks (their data becomes the tags `kid approved` and
`kids rejected`); the marks are now Favourite, Try next and Tried, with the tasting rules.
The API computes `rating` and `last_made` from the timeline, and the browse page gains the
"Rating" and "Recently made" sorts. The default food view is all food, quickest first.
Drag handles and avatars are not built. Screenshots are in `docs/design/screenshots/m2/`.

### M3: Claude integration

`search_recipes`, `add_recipe`, `edit_recipe` on top of M0's read tools; style guide in
`src/app/style_guide.md`, also served as an MCP resource/prompt; URL import (Claude fetches
and converts, the server stores `source_url` and grabs `og:image`).

**Done** (2026-10-20): Claude can search, add and edit recipes over MCP. `search_recipes`
filters by side, text, category, tags and marks and sorts like the browse page;
`list_recipes` and `read_recipe` now include rating, last made and version. The style
guide (`src/app/style_guide.md`) is served as the `get_style_guide` tool, the
`laekkert://style-guide` resource and the `import_recipe` prompt. `add_recipe` saves
`source_url` and takes the page's `og:image` (or a given `image_url`), refuses a link a
recipe on that side already has, and saves without a photo, with a warning, when the
photo can't be fetched. Page and photo fetches refuse private and local addresses, odd
ports and oversized bodies. `edit_recipe` changes only the fields it is given and needs
the `version` from `read_recipe`; the app's editor sends its version too, so a stale edit
from either side is refused instead of overwriting the other. Claude's writes show as
`via: "claude"` in the timeline. Claude can't set marks or ratings, add notes, delete or
restore.

### M4: Drinks inventory

Requirement 20 and the `manage_inventory` tool from requirement 24: shelf-stable items are
tracked as have / don't have, fresh items are marked fresh and never tracked, and drinks
show "Can make now" and "Only need fresh items". Design first: the brief for the Claude
Design session is [design/m4-inventory-brief.md](design/m4-inventory-brief.md). The spec
and plan follow from its artboards.

**Done** (2026-10-20): the bar. Spec: `docs/superpowers/specs/2026-10-20-m4-bar-design.md`.
The catalog gains a `kind` per entry and an accent-insensitive key (`Crème de violette` and
`creme de violette` are one name), and a writer that keeps fields it doesn't know. The bar's
items are every drink ingredient plus every catalog entry with a kind; `inventory.json` holds
have or don't have per item, and fresh items are never tracked. Each drink gets a status
(missing, unsorted, fresh only, can make) from its ingredients. `GET`/`POST /api/bar` read
and change the bar with one all-or-nothing change model (states, fresh, kinds, other names,
fold, delete); drinks summaries and recipes carry their `bar`. Over MCP, `read_bar` and
`manage_inventory` (everything but delete), and `search_recipes` gains a `bar` filter for
drinks. The app has the `/bar` page with its item sheet, the From your bar filter, the
"not sorted yet" banner, status badges and empty states on the drinks page, and on a drink's
page the bar summary, per-ingredient toggles with undo and a link to a syrup's recipe. Food is
unchanged. The seed catalog only writes a missing file, so on the NAS white rum and simple
syrup show as Other and soda water as a bottle rather than fresh until someone sets them
(Claude can, with `manage_inventory`). Screenshots are in `docs/design/screenshots/m4/`.

Rulings made on the way:

- A change to an item with no catalog entry (or no kind) writes one with kind `other`, so it
  stays on the bar.
- Changes that contradict each other are refused, compared by resolved item: besides the
  spec's pairs, `dont_have` with `fresh`, `unsorted` with a state, and `delete` with
  anything. Have or don't have on a fresh item does nothing. An empty name is refused ("A
  name can't be empty.").
- `manage_inventory` takes kinds as plain strings and checks them itself, so a bad kind gets
  a readable sentence.
- The item sheet's kind is a select, as in the artboard. Copy the artboards don't give was
  written to match ("Pick an item", "Fold into …", "Delete …", "Cancel"). The bulk button
  counts the unsorted items the search leaves; the desktop no-match also offers fresh; the
  first-visit subtitle says Click on desktop and Tap on a phone.
- Drinks page: singular forms, the "Inventory" and "From your bar" labels, and a true
  sentence when nothing needs only fresh items but some drinks can be made ("Nothing needs
  only fresh items"). The fresh-only and generic empty states come from the summaries, so
  they still show when the bar can't be read.
- Drink page: the phone uses the phone artboard's short labels ("Not in bar", "Fresh"); the
  tsp / g-ml toggle stays; the syrup link is 44 px; undo restores the exact previous state
  and stays until it is used or replaced; a refusal shows at its row.

### M5: Cook with what you have, and merging ingredients

**Done** (2026-10-20). Spec: `docs/superpowers/specs/2026-10-20-m5-have-and-merge-design.md`.

- **Cook with what you have (Food).** You list what's in the fridge ("chicken", "leeks").
  The food list keeps the recipes that use at least one of them and ranks them by fewest
  missing ingredients. Each card says "Have everything" or "Missing: …".
  - A term matches a row when both resolve to the same catalog entry, or when every word of
    the term matches a word of the row's names. Long words match fuzzily; short words must
    match exactly or by a plural. Ingredients "to taste" and water are never missing.
  - The list lives in the URL only (`have=`, repeatable), so Back keeps it and nothing else
    stores it.
  - `GET /api/recipes?side=food&have=…` ranks the list. Each summary carries `have` (what is
    matched and what is missing). Drinks answer 400.
  - `search_recipes` gains `have`.
  - On desktop the filter aside has a What you have section. On a phone a basket button in
    the header opens the same field.
- **Merging ingredients (MCP).** `list_ingredients` lists each ingredient with its names,
  recipe counts per side, kind and fresh. `merge_ingredients` folds one name into another and
  `separate` takes a name back out (a conversion or fresh flag copied in the merge stays). Recipes keep their wording; only the catalog changes. A merge never
  changes what is on the bar. The server instructions and the style guide tell Claude to use
  the names already in use and to merge true duplicates.
- Screenshots are in `docs/design/screenshots/m5/`.

Rulings made on the way:

- Merge names are stripped before use. A merge reads the inventory strictly but never
  writes it.
- A merge that would change any bar item's state is refused; only copying `fresh` onto the
  target is allowed. The check runs after the merges and before the separates, so a
  separated drink alias still becomes its own unsorted bar item.
- Contradictions are compared by identity: a name whose identity was already merged
  elsewhere is "merged twice", and one that resolves to an earlier target is a chain.
- A new catalog entry for a name a drink uses takes the drink's spelling.
- One `merge_ingredients` call takes at most 200 names, as the bar does.
- `list_ingredients` reads a broken catalog leniently, like `read_bar`; only the merge
  refuses.
- The web list also stops at 20 terms. It doesn't cut long terms; the server does.
- The phone panel has no visible heading. Its field and chip list have aria-labels ("Add an
  ingredient", "Ingredients you have").
- The fuzzy match for words of five letters or more needs a ratio of 85, not the spec's 80,
  and plurals (`s`, `es`, `y`/`ies`) match at any length. At 80, "chicken" covered
  chickpeas and "butter" covered butternut squash.

### M6: Drinks views, and tracking only the bottles

**Done** (2026-10-20). Serwan's feedback after using the bar; no Claude Design session.
Spec: `docs/superpowers/specs/2026-10-20-m6-drinks-views-design.md`.

- **Views.** The Drinks page opens on four views instead of the From your bar and Style
  filters: **Can make** (the default), **All drinks**, **Mocktails** and **Syrups & prep**.
  The first three show cocktails and mocktails only. They are phone chips with counts
  (`Can make 2`, `All 3`, `Mocktails 1`, `Syrups 2`) and a Show section in the desktop
  aside. The view is `show=` in the URL; old `bar=` and `cat=` links still land on the
  matching view. While the bar isn't set up, Can make shows the set-up box above its list. A
  search shows "{k} more in All drinks" (or Syrups & prep) when the view hides matches.
- **Only bottles are tracked.** Fresh items (the catalog's `fresh: true`), kind Syrups, and
  anything Lækkert has a syrups or prep recipe for are not tracked: they have no Have/Don't
  have buttons and never keep a drink out of Can make. A new item with the word "syrup" in
  its name starts as Syrups. A drink's `bar` is `{status, missing, unsorted, untracked}`;
  status is `can_make`, `missing` or `unsorted`, and `fresh_only` is gone. The card says
  "Also needs: lime juice, mint" when a makeable drink uses untracked things. Syrups and
  prep recipes have no bar status, and their ingredients don't fill the bar.
- **Bar page.** A Not tracked section replaces Fresh; not-sorted rows get a "Don't track"
  button; a search with no match offers "Add it without tracking"; the item sheet has a
  Track it switch, disabled with the reason for syrups and recipe items. Counts are of
  tracked bottles.
- **Recipe page.** "From your bar: {n} of {n} bottles" plus "Also needs: …"; untracked rows
  have no state buttons, and a syrup's row still links to its recipe.
- **API and MCP.** `POST /api/bar` and `manage_inventory` take `untrack` and `track`
  (were `fresh` and `not_fresh`). A `track` that can't take effect is refused with a
  sentence. Bar items carry `tracked` and `untracked_because`. `search_recipes(bar=...)`
  takes only `"can_make"` and leaves syrups and prep out. Stale states of untracked items
  are dropped on the next bar write.
- **Mocktail is a category.** A tag that repeats the recipe's own category (`mocktail` on a
  mocktail, `dessert` on a dessert) is dropped when a recipe is read and when it is saved,
  on both sides, with no format bump. The style guide says not to add them.
- On the NAS, mixers M4 gave kind Other (tonic, ginger beer) stay tracked until someone
  untracks them, from the bar or with one `manage_inventory(untrack=[...])` call.
- Screenshots are in `docs/design/screenshots/m6/`.

Calls made in the spec (Serwan didn't decide these): the default keeps the name Can make;
Mocktails is its own view and syrups and prep share one ("Syrups" on the phone chip);
mocktails with no tracked bottle count as Can make; the Style filter goes on drinks; kind
Other stays tracked; syrup-named items start as Syrups; only tags repeating the recipe's
*own* category are dropped; Can make shows the set-up box while the bar isn't set up; a
syrup M4 marked fresh reports `syrups` as its reason; the stored `fresh` field keeps its
name.

Rulings made on the way:

- A tag link on a syrups or prep recipe page goes to Syrups & prep; on any other drink, to
  All drinks.
- The empty Can make state says "Show 1 drink" for one drink rather than "Show all 1
  drinks".
- A search with no hits on Can make shows the plain empty state and the "{k} more in…" link,
  not "Nothing to make yet".
- If the bar can't be read, the views still show, without Can make, and the list is All
  drinks.
- Have or Don't have on an untracked item that has no catalog entry still writes the entry
  (as M4 does for fresh items); the state is ignored.
- An MCP client still sending `fresh=` gets no error: the argument is dropped, as for any
  unknown argument.
- The category tag rule drops a final `s` bluntly, so `main` on a Mains recipe goes too,
  which is intended.
- On phone, a not-sorted row's "Don't track" sits on a second line under Have and
  Don't have, so the item name keeps its width.
- No dark screenshots: the app has one theme.
- An item of kind Other that only syrups and prep recipes use (the sugar and water M4
  sorted when its bar listed syrup ingredients) is not on the bar: not listed, not
  counted, and not "on the bar" for a merge, whatever state it kept. An Other bottle
  added by hand that no recipe uses stays, and so does an item of any other kind.
- The set-up box on Can make says "so drinks that need bottles can't show here yet",
  not "so nothing can show here", since drinks with no tracked bottle are listed under it.
- An old `tag=mocktail` or `tag=mocktails` link (with no `show=`) opens the Mocktails
  view, and the tag is dropped.

### Groups and notes

**Done** (2026-10-20). Spec: `docs/superpowers/specs/2026-10-20-groups-and-notes-design.md`.

- **Recipe format 3.** Ingredients and steps each carry a `group` (a short heading, empty
  for none), steps become objects (`{text, group}`) and a recipe has `notes`. Format 2
  files migrate on read, so old versions still restore; files are rewritten as format 3
  only when saved. Ingredient groups and step groups are independent, and a recipe with no
  groups looks as it did.
- **Recipe page.** Group headings (a small accent label with a rule) in the ingredients
  card and the method, a rule alone for an ungrouped run after a group, step numbers
  running through the whole method, and a Notes section when there are notes. Notes keep
  their line breaks and allow `**bold**`, `*italic*` and "- " bullets, rendered without
  HTML.
- **Editor.** Heading rows in the ingredient and step lists, with move and remove buttons,
  an Add group button under each list, and a Notes card with Bold, Italic and List
  buttons.
- **History.** Group moves ("moved to ..."), group renames as one line, and notes added,
  removed or changed.
- **Claude.** `add_recipe` and `edit_recipe` take groups and notes (steps as strings or
  `{text, group}`), `read_recipe` returns them, and the style guide says when to use them
  (only for recipes with distinct parts) and how to name groups.
- Screenshots are in `docs/design/screenshots/groups/`.

### After the PoC

Every idea for what comes next is in `docs/ideas.md`.

## Open questions

None at the moment.
