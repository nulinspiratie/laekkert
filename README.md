# Lækkert

Lækkert is a recipe app for food and drinks, kept as separate sides, that runs on Serwan's
NAS and that Claude can search, add and edit over MCP. The PoC plan is in
[`docs/plan.md`](docs/plan.md); the rules an agent follows are in [`CLAUDE.md`](CLAUDE.md).

Made from `nulinspiratie/nas-app-template`; the notes below on how such an app deploys
still apply.

## Day 1 for a new app

1. On GitHub: **Use this template** → private repo. The name becomes the slug, image name
   and default hostname (`<slug>.serwan.me`), so pick it with that in mind.
2. Wait for the first CI run to go green. It publishes the placeholder image to GHCR. The
   package is private and linked to the repo.
3. Open a Claude Code cloud session on the new repo and describe the app. The session
   replaces the placeholder, keeps `nas-app.toml` and `config.example.toml` current, and
   pushes to `main`.
4. Once CI has published `:main`, the same session opens a PR in
   `nulinspiratie/home-server`. The PR adds `containers/<slug>/docker-compose.yml` (from
   `deploy/compose.example.yml`), `config.toml` and the allowlist line. Its description is
   the `just handoff` block plus a checklist of the Cloudflare and secrets steps. The
   session never pushes to home-server `main`.
5. Do the checklist (Cloudflare hostname/Access, secrets in the NAS `.env`) and merge the
   home-server PR. Within a minute the config applier on the NAS creates the data
   directory and starts the stack. From then on every push to `main` deploys within a
   couple of minutes.

## Local commands

Needs [`uv`](https://docs.astral.sh/uv/), [`just`](https://just.systems/) and Node 24 (npm);
Docker for `just build`.

```sh
just test      # pytest and the frontend tests (vitest)
just lint      # ruff, nas-app.toml check, frontend typecheck + oxlint
just run       # builds web/, then http://localhost:8080 with config.example.toml
just web-dev   # frontend dev server with hot reload, proxying to `just run`
just build     # local linux/amd64 image <slug>:local (never pushed)
just handoff   # hand-off block (the home-server PR description)
```

There is no deploy command: deploying is `git push` to `main`.

## Files

| Path | What it is |
| --- | --- |
| `src/app/` | Backend: app (`main.py`), JSON API, MCP server, recipe store, seed recipes |
| `web/` | Frontend: Vite + React, built into the image at `/app/static` |
| `config.example.toml` | Every app setting with its default; becomes `containers/<slug>/config.toml` |
| `nas-app.toml` | Deploy manifest: port, health path, subdomain, Claude access, data, secret names |
| `deploy/compose.example.yml` | The compose the app session writes in its home-server PR |
| `scripts/handoff.py` | `just handoff`; also validates `nas-app.toml` in CI |
| `docs/dockerfile-archetypes.md` | Dockerfiles for Node, mixed and other apps |
