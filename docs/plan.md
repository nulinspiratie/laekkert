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
  `httpx` for image fetching. One process; at a few hundred recipes no database is
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
- **Design:** the Claude Design session's output is migrated at the start of M1; its
  export format is decided then.

## Storage (under `/data`, Git-friendly)

```
recipes/<side>/<slug>/recipe.json        # format_version, current state
recipes/<side>/<slug>/timeline.jsonl     # notes, ratings, edit events (date, via)
recipes/<side>/<slug>/versions/0003.json # snapshot per edit → diffs + rollback
recipes/<side>/<slug>/<image>            # optional photo / source photo
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

### M2: Editing and timeline

Form editor (all fields of requirement 5, image upload); tags and marks with their rules
(favourite implies tried, try next clears on the first tasting); timeline with notes,
ratings and edits; snapshot per edit with a readable diff; rollback.

### M3: Claude integration

`search_recipes`, `add_recipe`, `edit_recipe` on top of M0's read tools; style guide in
`docs/style-guide.md`, also served as an MCP resource/prompt; URL import (Claude fetches
and converts, the server stores `source_url` and grabs `og:image`).

### After the PoC (rest of V1)

Two users and authorship; drinks inventory with "can make now" / "just buy fresh";
throwaway ingredient filter; `merge_ingredients` and `manage_inventory`; photo search
with illustration fallback; offline PWA.

## Open questions

- Claude Design export format (M1).
- Image licensing on import (M3).
- Whether claude.ai can pass a chat-attached photo to an MCP tool (M3).
