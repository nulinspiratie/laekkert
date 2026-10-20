# Lækkert

A self-hosted recipe app for a household's food and drinks, with Claude as a first-class way
to add and edit recipes. It runs as one small container, keeps every recipe as a plain file,
and installs on a phone as an app.

![Lækkert on a phone: the food list, a recipe's ingredients with the servings stepper, and a
cocktail with what the bar has](docs/screenshots/phone.png)

## Features

### Two sides, never mixed

Food and drinks share one layout, each with its own colours. The app remembers which side you
used last. Recipes have categories (mains, sides, desserts, sauces, prep; cocktails, mocktails,
syrups, prep), free-form tags, marks (Favourite, Try next) and a rating. Search is fuzzy about
word order and typos: "leek chiken" finds "Chicken and leek traybake".

### Cook from what you have

Type what's in the fridge and the food list ranks recipes by how little you'd need to buy.
Nothing is saved: it's a filter for tonight, not an inventory.

![The food list filtered by spaghetti, garlic, olive oil, chilli flakes and parsley: Spaghetti
aglio e olio has everything, the rest show what's missing](docs/screenshots/food.png)

### Drinks from your bar

Mark each bottle as in or out once, and every drink tells you whether you can make it now,
only need something fresh (lime, mint, soda), or are missing a bottle. Fresh items are never
tracked; they just go on the shopping trip.

![The drinks list with Can make now, Buy fresh and Missing badges, and the From your bar
filter](docs/screenshots/drinks.png)

![The bar: bottles grouped by kind with Have and Don't have, a list of fresh items, and how
many drinks you can make](docs/screenshots/bar.png)

### Recipes that read well in the kitchen

- Metric only: grams and millilitres. Small amounts can show as tsp and tbsp; each ingredient
  can carry its own grams-per-teaspoon, and anything unconverted shows as written and is
  flagged.
- A servings stepper that scales sensibly, with a "don't scale" flag for "a pinch" and
  "salt to taste".
- Recipes without a photo look intentional, with a drawn tile per category. Add a photo with
  the upload button, or let a URL import keep the source page's own.

### A history for every recipe

Notes, "Made it" entries with a rating, mark changes and edits share one timeline. Every edit
stores a snapshot and shows as a readable diff ("coconut milk 400 → 300 ml"), and you can
restore any earlier version.

![A recipe's history: a note, a five-star "Made it", and an edit made via Claude shown as a
diff](docs/screenshots/history.png)

### Claude, over MCP

The app serves an [MCP](https://modelcontextprotocol.io) server at `/mcp`, so Claude (on the
phone too, as a claude.ai connector) can work with the recipes directly:

| Tool | What it does |
| --- | --- |
| `search_recipes`, `list_recipes`, `read_recipe` | Find and read recipes, fuzzy and typo-tolerant |
| `add_recipe`, `edit_recipe` | Add or change a recipe; a source URL also grabs the page's photo |
| `read_bar`, `manage_inventory` | See and change what's in the bar |
| `list_ingredients`, `merge_ingredients` | Keep one name per ingredient ("caster sugar" is "sugar") |
| `get_style_guide` | How recipes are written: names, metric units, conversions |

There is also an `import_recipe` prompt: give Claude a link and it fetches the page, writes
the recipe to the [style guide](src/app/style_guide.md) and adds it. Edits made this way are
marked "via Claude" in the history.

## Running it

The app has **no login**. It is meant to sit behind something that does authentication, such
as Cloudflare Access or another reverse proxy. Don't expose it to the internet as it is.

### With Docker

```sh
docker build --build-arg GIT_SHA=$(git rev-parse HEAD) -t laekkert .
mkdir -p data && sudo chown 1000:1000 data
docker run -d --name laekkert -p 8080:8080 \
  --read-only --tmpfs /tmp --user 1000:1000 \
  --cap-drop ALL --security-opt no-new-privileges:true \
  -v "$PWD/data:/data" \
  -v "$PWD/config.example.toml:/config/config.toml:ro" \
  laekkert
```

Then open <http://localhost:8080>. On first start with an empty `/data`, the app copies in a
few example recipes (`seed_examples` in [`config.example.toml`](config.example.toml)).
`GET /healthz` reports the running version.

### Locally

Needs [`uv`](https://docs.astral.sh/uv/), [`just`](https://just.systems/) and Node 24.

```sh
just run       # builds web/, then http://localhost:8080 with config.example.toml
```

### Where your recipes live

Everything is plain files under `/data`, laid out to be Git-friendly and easy to back up:

```
recipes/<food|drinks>/<slug>/recipe.json      # the recipe, with a format version
recipes/<food|drinks>/<slug>/timeline.jsonl   # notes, ratings, edits, one per line
recipes/<food|drinks>/<slug>/versions/        # a snapshot per edit, for diffs and restore
catalog/ingredients.json                      # ingredient names, aliases, g per tsp, fresh
inventory.json                                # the bar
trash/                                        # deleted recipes; restoring is a file move
```

Writes are atomic, and older `recipe.json` files are upgraded on read when the format changes.

## How it's built

- **Backend:** Python 3.12, [Starlette](https://www.starlette.io/) and uvicorn, `pydantic`
  for the recipe format, `rapidfuzz` for search, and the official `mcp` SDK mounted in the
  same process. No database.
- **Frontend:** Vite, React and TypeScript in [`web/`](web), built to static files that the
  backend serves. An installable PWA.
- **Container:** one `linux/amd64` image, non-root (uid 1000), read-only filesystem; it
  writes only to `/data` and `/tmp`.

## Development

```sh
just test      # pytest and the frontend tests (vitest)
just lint      # ruff, the nas-app.toml check, frontend typecheck and oxlint
just run       # the app on http://localhost:8080
just web-dev   # frontend dev server with hot reload, proxying to `just run`
just build     # local linux/amd64 image, never pushed
```

| Path | What it is |
| --- | --- |
| `src/app/` | Backend: app, JSON API, MCP server, recipe store, seed recipes, style guide |
| `web/` | Frontend |
| `config.example.toml` | Every setting with its default |
| `docs/` | Requirements, the PoC plan, milestone plans, design snapshot, [future ideas](docs/ideas.md) |
| `CLAUDE.md` | The rules a Claude Code session follows in this repo |

This instance runs on a home Synology NAS and deploys itself on every push to `main`; see
[`docs/deploying.md`](docs/deploying.md). The app started from a private template for such
apps, which is where `nas-app.toml`, `deploy/` and `scripts/handoff.py` come from.

Lækkert is Danish for "delicious".
