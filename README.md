# nas-app-template

Template for apps hosted on Serwan's NAS. A repo made from it with **Use this template**
publishes a working image to GHCR on its first push, with no file edited:
`ghcr.io/nulinspiratie/<repo-name>:main` and `:<short-sha>` (the repo name lowercased).
The image is a placeholder Python app that already follows every runtime convention
(port 8080, `/healthz` with the commit SHA, config from `/config/config.toml`, writes only
to `/data`, uid 1000, read-only filesystem). The template repo itself runs the tests and
an image build but never publishes.

The full design is in [`docs/template-spec.md`](docs/template-spec.md); the rules an agent
follows are in [`CLAUDE.md`](CLAUDE.md).

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

Needs [`uv`](https://docs.astral.sh/uv/) and [`just`](https://just.systems/); Docker for
`just build`.

```sh
just test      # pytest
just lint      # ruff + nas-app.toml check
just run       # http://localhost:8080 with config.example.toml
just build     # local linux/amd64 image <slug>:local (never pushed)
just handoff   # hand-off block (the home-server PR description)
```

There is no deploy command: deploying is `git push` to `main`.

## Files

| Path | What it is |
| --- | --- |
| `src/app/` | Placeholder app (`main.py`) and config loader (`config.py`) |
| `config.example.toml` | Every app setting with its default; becomes `containers/<slug>/config.toml` |
| `nas-app.toml` | Deploy manifest: port, health path, subdomain, Claude access, data, secret names |
| `deploy/compose.example.yml` | The compose the app session writes in its home-server PR |
| `scripts/handoff.py` | `just handoff`; also validates `nas-app.toml` in CI |
| `docs/dockerfile-archetypes.md` | Dockerfiles for Node, mixed and other apps |
