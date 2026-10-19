# CLAUDE.md

## What this repo is

An app that runs on Serwan's Synology NAS behind Cloudflare. It was made from
`nulinspiratie/nas-app-template`. Its **slug is the repo name, lowercased**: the image is
`ghcr.io/nulinspiratie/<slug>`, the NAS stack and service are `<slug>/<slug>`, and the
default hostname is `<slug>.serwan.me`. The slug is never written in a file; CI computes it.

Until someone replaces it, `src/app/` holds a placeholder (Starlette + uvicorn): `/` says
hello with the `greeting` from `config.toml`, `/healthz` reports the version. Replace it with
the real app and keep every convention below.

Commands (`just` and `uv` are all you need; `docker` only for `just build`):

| Command | What it does |
| --- | --- |
| `just test` | `uv run pytest` |
| `just lint` | `ruff check`, `ruff format --check`, and the `nas-app.toml` check |
| `just run` | App on `http://localhost:8080` with `config.example.toml` |
| `just build` | Local `linux/amd64` image `<slug>:local`; never pushed |
| `just handoff` | Hand-off block; the description of the home-server PR |

CI (`.github/workflows/ci.yml`) runs the same checks. There is no deploy recipe: deploying
is a push to `main`.

## Conventions

These are rules, not suggestions. The NAS compose file is fill-in-the-blanks and a safety
check on the NAS rejects anything else.

- **Listen on `0.0.0.0:8080`** inside the container. One fixed port; nothing is published
  on the NAS host, Cloudflare reaches the app over a Docker network.
- **`GET /healthz` returns 200 with JSON `{"status":"ok","version":"<full sha>"}`.**
  `version` comes from the `APP_VERSION` env var, which the Dockerfile bakes from the
  `GIT_SHA` build arg. CI passes the commit SHA.
- **The Dockerfile has a `HEALTHCHECK`** that hits `/healthz` using the runtime's own
  language (Python here); never install curl for it.
- **Config comes from the TOML file at `$APP_CONFIG`** (`/config/config.toml`, mounted
  read-only). A missing file means defaults; unknown keys are ignored.
- **Writes go only to `/data` and `/tmp`.** `/data` is the one writable mount
  (`/volume1/docker/<slug>/data` on the NAS); `/tmp` is a tmpfs. The container runs with
  `read_only: true`, so anything else fails. No paths outside the container in code.
- **Secrets are environment variables only**, and every name is listed in `nas-app.toml`
  under `[secrets] names`. Their values live only in the NAS `.env`, never in git.
- **Non-root, uid/gid 1000** (`USER app`). No root, no privileges, no capabilities. The NAS
  runs every app with `user: "1000:1000"`, `cap_drop: [ALL]` and `no-new-privileges`, and
  CI's `image-check` runs the image the same way.
- **Logs go to stdout/stderr only.** No log files.
- **`linux/amd64` only**, tags `:main` and `:<short-sha>` only (CI does this).

`nas-app.toml` is the deploy manifest the home-server side is built from: port, health
path, subdomain (`""` = the slug), `claude_access`, whether `/data` is mounted, and secret
names. Keep it true. `just lint` and CI reject a bad port, a health path not starting with
`/`, a subdomain that is not one lowercase DNS label, and secret names not in
`UPPER_SNAKE_CASE`.

## Config rule

Every app setting lives in `config.example.toml` with its default and a comment, and in
`Settings` in `src/app/config.py` with the same default. Adding a setting means updating
both (the test `test_example_config_matches_defaults` checks they agree). Never put
secrets in `config.example.toml`: it is copied into the home-server repo as
`containers/<slug>/config.toml`. Settings reach the NAS with a home-server `git pull`, not
with an image deploy, so the app must cope with a key appearing before or after the image
that uses it.

## Deploying

This app runs on Serwan's NAS and deploys itself.

- A push to `main` runs CI. When the `test` job passes, the `publish` job pushes
  `ghcr.io/nulinspiratie/<slug>:main` and `:<short-sha>`. A poller on the NAS picks up the
  new `:main` within a minute and restarts the app on it. Other branches and pull requests
  never deploy; they run `test` and `image-check` (an unpushed build plus a `/healthz` smoke
  test).
- So pushing or merging to `main` ships to the NAS, about one to two minutes after CI
  finishes. Every push to `main` restarts the app, docs-only commits included: merge work
  that is ready to try, not half-finished work.
- Cloud sessions cannot reach the NAS. Ship by pushing or merging to `main`, then verify as
  below. Serwan gets a notification for every deploy and every failure.
- Never change the publish job's tags, never push `:latest`, never add a second workflow
  that pushes images. The runtime compose and `config.toml` live in Serwan's home-server
  repo (`nulinspiratie/home-server`, `containers/<slug>/`), not here. You change them only
  through a PR there that Serwan merges (see "First deploy of a new app").
- Rollback is Serwan's: he pins `:<short-sha>` in home-server's compose.

## Verifying

1. Watch the CI run for the pushed commit: `gh run watch` (or the GitHub tools the session
   has). `test` and `publish` must both succeed.
2. Wait a minute or two for the poller, then:

   ```sh
   curl -fsS https://<subdomain>.serwan.me/healthz \
     -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
     -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET"
   ```

   `<subdomain>` is `routing.subdomain` in `nas-app.toml`, or the slug when it is empty. The
   two values come from the cloud environment's secrets. The response's `version` must equal
   the full SHA you pushed (`git rev-parse HEAD`); an older SHA means the deploy has not
   landed yet or failed.
3. If `claude_access = false`, the variables are missing, or the hostname does not resolve
   or is not routed yet, say so plainly ("CI published `<sha>`; I can't check the NAS from
   here because …") instead of guessing that it deployed.

## First deploy of a new app

A cloud session can work on several repos, so the app session writes the home-server
side itself, as a PR that Serwan reviews and merges.

1. Finish the app, keeping every convention above. Keep `nas-app.toml` and
   `config.example.toml` current (secret names, subdomain, `claude_access`, `data`).
2. `just lint`, `just test`, and ideally `just build`, then push to `main`.
3. Confirm CI's `publish` job succeeded for that commit, so `:main` exists on GHCR. Do not
   open the home-server PR before that: a compose pointing at a missing `:main` breaks the
   pull.
4. Run `just handoff`. Its `published` line should say `yes`; if it says `unknown`, check the
   `publish` job instead and note in the PR which commit it published.
5. Get `nulinspiratie/home-server` into the session (attach the repo if it isn't there and
   clone it), and on a new branch (`add-<slug>`) add:
   - `containers/<slug>/docker-compose.yml`: `deploy/compose.example.yml` with `<slug>`
     filled in. Uncomment `env_file: [.env]` only if `nas-app.toml` lists secrets; drop the
     `/data` volume line if `storage.data = false`. No `ports:`, nothing else changed.
   - `containers/<slug>/config.toml`: a copy of `config.example.toml`.
   - The line `<slug>/<slug>` in `containers/_autodeploy/services`.
   - The stack under "Available Services" in `containers/README.md`, if that list exists.

   Follow home-server's own `CLAUDE.md` where it says more.
6. Open a PR to home-server `main`. Its description is the `just handoff` block verbatim,
   in a code block, followed by a checklist of what only Serwan can do:
   - Cloudflare: route `<hostname>` through the tunnel to `<slug>:8080`, and if
     `claude_access = true`, add the Claude service-token rule to its Access application.
   - Secrets: set each name from the `secrets` line in `containers/<slug>/.env` on the
     NAS (`chmod 600`); skip this step when it says `none`. Until that file exists the
     stack cannot start; the NAS retries every minute and starts it once the file is there.
   - Merging the PR is the deploy. Within a minute the config applier on the NAS pulls
     home-server, checks the stack against its allowlist, creates
     `/volume1/docker/<slug>/data` owned by uid/gid 1000 (if `data`) and starts the stack;
     ntfy reports the result. Merging also adds the service to the auto-deploy allowlist:
     from then on every push to this repo's `main` deploys to the NAS.
7. Give Serwan the PR link. **Never push to home-server `main`**, never merge that PR
   yourself, and never touch anything else in home-server. If you can't get write access
   to home-server, give Serwan the `just handoff` block and the checklist instead.

## Never

- No `:latest`, anywhere.
- No published ports (`ports:`), no listening on anything but 8080.
- No host paths in code (`/volume1/...` and the like); only `/data`, `/tmp`, `/config`.
- No secrets, tokens or `.env` files in git.
- No changes to the CI template guard (`github.repository != 'nulinspiratie/nas-app-template'`),
  the publish tags, or the computed image name. No PAT in CI.
- No Docker socket, no privileged mode, no added capabilities, no root user.
- No `deploy.sh`, ssh step or anything else that reaches the NAS.
- No push to home-server `main` and no merging home-server PRs; only a branch and a PR.

## Other languages

For an app that is not Python, replace the `Dockerfile` with the matching one from
`docs/dockerfile-archetypes.md` (Node, mixed frontend + Python backend, or generic), keeping
every convention: port 8080, `/healthz` with `APP_VERSION`, `GIT_SHA` build arg,
`APP_CONFIG`, a `HEALTHCHECK` in the runtime's own language, uid 1000, writes only to
`/data` and `/tmp`. Then update the CI `test` job (and the `test`/`lint`/`run` recipes in
the `justfile`) to the new toolchain. Keep the manifest check step
(`uv run scripts/handoff.py --check`), `image-check` and `publish` as they are.
