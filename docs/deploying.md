# Deploying

How the running instance of Lækkert gets to Serwan's Synology NAS. None of this is needed to run
the app yourself; see "Running it" in the [README](../README.md).

Lækkert was made from `nulinspiratie/nas-app-template`, a private template for apps that run on
the NAS behind Cloudflare. The rules a Claude Code session follows here are in
[`CLAUDE.md`](../CLAUDE.md); this page is the short version.

## How a change ships

1. A push to `main` runs CI (`.github/workflows/ci.yml`). When the `test` job passes, `publish`
   pushes `ghcr.io/nulinspiratie/laekkert:main` and `:<short-sha>`. Branches and pull requests
   only run `test` and `image-check` (an unpushed build plus a `/healthz` smoke test).
2. A poller on the NAS sees the new `:main` within a minute and restarts the app on it.
3. `GET /healthz` on the live hostname then reports the pushed commit's full SHA.

There is no deploy command: deploying is a push to `main`, and every push to `main` restarts the
app, docs-only commits included.

## The NAS side

The runtime compose file and `config.toml` live in Serwan's `home-server` repo under
`containers/laekkert/`, not here. They change only through a PR there. `nas-app.toml` is the
manifest that side is built from (port, health path, subdomain, Claude access, data mount,
secret names), and `just handoff` prints the block that described the first home-server PR.

Cloudflare Access protects the hostname, including `/mcp`: claude.ai signs in through Access's
managed OAuth, and Claude Code cloud sessions use a service token. Rollback is pinning a
`:<short-sha>` tag in home-server's compose.

## Local commands

```sh
just build     # local linux/amd64 image laekkert:local (never pushed)
just handoff   # hand-off block (the home-server PR description)
```
