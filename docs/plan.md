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
catalog/ingredients.json                 # canonical names, aliases, g_per_tsp, fresh flag
inventory.json                           # (after the PoC)
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

### After the PoC (rest of V1)

Two users and authorship; throwaway ingredient filter; `merge_ingredients`; photo search
with illustration fallback; offline PWA.

Kitchen mode (screen awake, large text, step by step) moves to V2. It needs its own design.

## Open questions

None at the moment.
