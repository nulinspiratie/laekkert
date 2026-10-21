# Future ideas

Everything that might come next, in one place. Nothing here is planned or promised. When an
idea becomes a milestone, it moves into `docs/plan.md` and comes off this list.

## Features

- **Ingredient merge screen.** A page in the web app for what Claude does now with
  `list_ingredients` and `merge_ingredients`. It would list every ingredient with its other
  names and how many recipes use it. You could fold one name into another (caster sugar into
  sugar) or take a name back out. Like the MCP merge, it would change only the catalog, never
  a recipe, and refuse anything that would change the bar. Today the only screen for this is
  the Bar page's fold, which works for drink bottles only.
- **Kitchen mode.** The recipe page as a cooking view: the screen stays awake, large text,
  one step at a time. It needs its own design first. The requirements call it a high-priority
  follow-up.
- **Photo search with an illustration fallback.** For a recipe added without a source photo,
  search for a fitting photo; if none is found, use an illustration.
- **"Find image" button.** On a recipe, AI search picks the best photo.
- **Source photos and photos from the chat.** Claude attaches the cookbook page or card a
  recipe came from as its source photo, and a dish photo Serwan shares in the chat. A
  `source_url` that is an image link is saved as the source photo; for a chat photo,
  `add_recipe`/`edit_recipe` take `upload_photos` and return a one-time upload URL that
  Claude `curl`s the file to from its code sandbox. No new MCP tools. Needs a Cloudflare
  Access Bypass on `/upload/photo` and network access for Claude's sandbox. Spec:
  `docs/superpowers/specs/2026-10-21-photo-from-chat-design.md`.
- **Offline PWA.** The app keeps working without a connection, for example in the kitchen.
- **Shopping list.** Built from a recipe's missing ingredients; for drinks, from the bar's
  fresh items.
- **Smart tags.** Rule-based tags, such as vegetarian from ingredient flags, mocktail when
  there is no alcohol, or under 30 minutes. Any manual tag can be turned smart, and from then
  on the rule decides. Existing simple tags need a way to migrate.
  Mocktail is not one of them any more: since M6 it is a category, picked from the Drinks
  page's Mocktails view, and a `mocktail` tag on a mocktail is dropped.
- **Two users and authorship.** Each history entry says who made it, with avatars in the
  header and on the timeline. Dropped for now.
- **Recipes in a private GitHub repo.** Claude Code could then do bulk work: merges, or
  rewriting many recipes against an updated style guide. The app pulls before it writes.
- **Built-in AI.** For example, dictate a recipe and have it structured.

## Smaller design gaps

From `docs/design/README.md` ("Still not built"):

- Drag handles in the editor. Rows and steps move with Move up and Move down buttons today.
- The "..." menu on the recipe page.

## Small fixes worth doing some day

- "Clear filters" on the Food page's no-results screen also clears your What you have
  ingredients. It should keep them and clear only the other filters.
- An encoded NUL in a page path (`/%00`) answers 500 instead of the app.

Smaller review findings left for later are listed in each milestone's PR.
