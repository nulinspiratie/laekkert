# NAS app template repo — spec

Oct 17, 2026 · @Serwan

Revised Oct 17, 2026: a cloud session can work on several repos, so the app session writes the home-server side itself, as a PR.

## Purpose

`nulinspiratie/nas-app-template` is a private GitHub template repo. A repo made from it with "Use this template" publishes a working image to GHCR on its first push, with no file edited. A Claude Code cloud session then replaces the placeholder app with the real one and ends by opening a PR in `nulinspiratie/home-server` that adds the app (compose, `config.toml`, allowlist line), with the hand-off summary as its description.

Done means:

- A new repo from the template goes green in CI and publishes `ghcr.io/nulinspiratie/<repo-name>:main` and `:<short-sha>` with zero edits.
- The template repo itself runs tests but never publishes.
- The placeholder app already follows every runtime convention below, so the real app only has to keep them.
- `just handoff` prints everything the home-server PR needs, including the `config.toml` contents; it becomes that PR's description.
- CLAUDE.md tells a cloud session how to build, deploy, verify and open the home-server PR without anyone explaining it again.

This spec covers the template only. The home-server side (applier, ruleset, shared network, Cloudflare) is a separate piece of work in the plan doc.

## Runtime conventions

Every app built from the template keeps these. They are what lets the home-server side stay a fill-in-the-blanks compose file, and what the NAS safety check expects.

| Convention | Value | Why |
| --- | --- | --- |
| Image name | Repo name, lowercased, computed in CI | No placeholder to edit; slug = repo name |
| Tags | `:main` and `:<short-sha>` only, never `:latest` | Poller deploys `:main`; SHA tags are for pinning |
| Platform | `linux/amd64` | NAS is x86-64 |
| Listen | `0.0.0.0:8080` inside the container | One fixed port; no published ports on the NAS |
| Health | `GET /healthz` → 200, JSON `{"status":"ok","version":"<full sha>"}` | Claude verifies the deployed commit through Cloudflare |
| Version | `APP_VERSION` env, baked from build arg `GIT_SHA` | Feeds `/healthz` |
| Docker healthcheck | `HEALTHCHECK` in the Dockerfile hitting `/healthz`, using the runtime's own language (no curl) | Poller and `docker ps` see real health |
| Config | `/config/config.toml`, read-only; path from `APP_CONFIG`; missing file → defaults | Non-secret settings arrive with the git pull |
| Data | `/data`, the only writable mount | Maps to `/volume1/docker/<slug>/data`, the only bind path the safety check allows |
| Secrets | Environment variables only, names declared in `nas-app.toml` | Values live only in the NAS `.env` |
| User | Non-root, uid/gid 1000 | Bind-mount ownership; no root in the container |
| Filesystem | Must run with `read_only: true` plus a tmpfs `/tmp` | Hardening for free if the app writes only to `/data` |
| Logs | stdout/stderr only | `docker logs`; no log files to fill the disk |

Non-secret settings that compose itself needs (none, by these conventions) would go in the compose file, never `.env`.

## Repo layout

The placeholder app is a minimal Python service managed by `uv`, because the rest of your apps are Python and the archetype already exists. Apps in another language swap the Dockerfile using `docs/dockerfile-archetypes.md`.

| Path | What it is |
| --- | --- |
| `.github/workflows/ci.yml` | `test` job on push and PR; `publish` job on push to main only, needs `test`, skipped in the template repo |
| `Dockerfile` | Two-stage uv build, non-root, `GIT_SHA` build arg, `HEALTHCHECK` |
| `.dockerignore` | The standard baseline from the auto-deploy references |
| `.gitignore` | Python, `.env`, `.data/` |
| `pyproject.toml`, `uv.lock` | Project, console script `app`, deps kept minimal |
| `src/app/main.py` | Placeholder HTTP app: `/` says hello, `/healthz` per convention |
| `src/app/config.py` | Loads `APP_CONFIG` with `tomllib`, falls back to defaults |
| `tests/test_health.py` | `/healthz` status, body and version; config load with and without a file |
| `config.example.toml` | Every app setting with its default and a comment; becomes `containers/<slug>/config.toml` |
| `nas-app.toml` | Deploy manifest: port, health path, hostname, Claude access, data, secret names |
| `deploy/compose.example.yml` | The compose the app session writes into its home-server PR, with `<slug>` placeholders |
| `scripts/handoff.py` | Prints the hand-off summary (the home-server PR description) from `nas-app.toml` and `config.example.toml` |
| `justfile` | `test`, `lint`, `run`, `build`, `handoff`. No deploy recipe: deploying is `git push` |
| `CLAUDE.md` | Agent instructions: conventions, how a deploy works, how to verify, how to open the home-server PR |
| `README.md` | Human-facing: what the template is and the day-1 steps |
| `docs/dockerfile-archetypes.md` | Node, mixed and generic Dockerfiles from the auto-deploy references, adapted to these conventions |

There is no `scripts/deploy.sh`. The laptop path is a push to main, the same as everywhere else.

## File specs

### `.github/workflows/ci.yml`

Start from the existing CI publish job in the nas-auto-deploy references, with three changes so it works unedited in every new repo.

- **Image name computed, not typed.** A step sets `image=ghcr.io/${GITHUB_REPOSITORY,,}` (bash lowercase) as an output, and `metadata-action` uses it.
- **Template guard.** `publish` runs only when `github.event_name == 'push' && github.ref == 'refs/heads/main' && github.repository != 'nulinspiratie/nas-app-template'`.
- **Version baked in.** `build-push-action` passes `build-args: GIT_SHA=${{ github.sha }}`.

Kept as in the reference: `needs: [test]`, `permissions: contents: read, packages: write`, login with `GITHUB_TOKEN`, `flavor: latest=false`, tags `type=raw,value=main` and `type=sha,prefix=,format=short`, the OCI labels, `linux/amd64`, GHA build cache.

Jobs:

1. `test` (push and PR): `uv sync --frozen`, `ruff check`, `pytest`, and a manifest check that `nas-app.toml` parses and its fields are valid.
2. `image-check` (PR, and every push in the template repo): builds the image without pushing, so a broken Dockerfile fails before merge.
3. `publish` (push to main, not the template repo): as above.

### `Dockerfile`

The uv archetype from the references, plus:

- `ARG GIT_SHA=dev` and `ENV APP_VERSION=$GIT_SHA` in the runtime stage.
- `ENV APP_CONFIG=/config/config.toml`.
- `HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/healthz',timeout=4).status==200 else 1)"`
- `EXPOSE 8080`, `USER app` (uid 1000), `ENTRYPOINT ["app"]`.
- Nothing writes outside `/data` and `/tmp` at runtime.

### Placeholder app

Smallest thing that proves the conventions: one HTTP framework, `/` returning a hello page that shows one value from `config.toml`, `/healthz` per the conventions table. Starlette with uvicorn is enough; no database.

### `nas-app.toml`

```toml
# Deploy manifest. Read by scripts/handoff.py and checked in CI.
# The slug is always the repo name; it is not set here.

[app]
description = "Placeholder app from nas-app-template"
internal_port = 8080          # keep 8080 unless there is a reason
health_path = "/healthz"

[routing]
subdomain = ""                # empty = the slug; becomes <subdomain>.serwan.me
claude_access = false         # true = add the Claude service-token rule in Cloudflare Access

[storage]
data = true                   # mount /volume1/docker/<slug>/data at /data

[secrets]
names = []                    # env var names only, e.g. ["OPENAI_API_KEY"]; values never in git
```

The CI check rejects: a port other than an integer 1–65535, a health path not starting with `/`, a subdomain that isn't a single DNS label, and secret names that aren't `UPPER_SNAKE_CASE`.

### `deploy/compose.example.yml`

What the app session writes into `containers/<slug>/docker-compose.yml` in its home-server PR:

```yaml
services:
  <slug>:
    image: ghcr.io/nulinspiratie/<slug>:main
    container_name: <slug>
    restart: unless-stopped
    read_only: true
    tmpfs: [/tmp]
    user: "1000:1000"
    cap_drop: [ALL]
    security_opt: [no-new-privileges:true]
    environment:
      APP_CONFIG: /config/config.toml
    # env_file: [.env]          # only when nas-app.toml lists secrets
    volumes:
      - ./config.toml:/config/config.toml:ro
      - /volume1/docker/<slug>/data:/data   # only when storage.data = true
    networks: [tunnel]

networks:
  tunnel:
    external: true
```

No `ports:`. `env_file` is added only when secrets exist, because Compose 2.20.1 on the NAS fails on a missing `.env` and optional env files need 2.24. The `./config.toml` read-only mount is the one bind outside `/volume1/docker/<slug>` the safety check must allow.

### `scripts/handoff.py` and `just handoff`

Stdlib only. Reads the repo name from `git remote get-url origin`, `nas-app.toml` and `config.example.toml`, and prints the summary in the next section. Exits non-zero if the manifest is invalid.

### `CLAUDE.md`

Self-contained, because a cloud session knows nothing else. Sections:

1. **What this repo is.** An app that runs on Serwan's NAS behind Cloudflare. Slug = repo name.
2. **Conventions.** The runtime conventions table, as rules: port 8080, `/healthz` with version, config from `APP_CONFIG`, writes only to `/data` and `/tmp`, secrets only as env vars declared in `nas-app.toml`, non-root.
3. **Config rule.** App settings in `config.example.toml` with defaults; never secrets there. Adding a setting means updating the example file and `config.py`.
4. **Deploying.** The "Deploying" section from the auto-deploy references, minus `just deploy`: push or merge to main ships within a couple of minutes of CI finishing; every push to main restarts the app; never change publish tags, never push `:latest`, never add a second publishing workflow.
5. **Verifying.** `gh run watch` on CI, then `curl` the app's `https://<subdomain>.serwan.me/healthz` with the headers `CF-Access-Client-Id` and `CF-Access-Client-Secret` from the cloud environment's secrets; the `version` must equal the pushed SHA. If the app isn't Claude-accessible (`claude_access = false`) or not yet routed, say so instead of guessing.
6. **First deploy of a new app.** Finish the app, keep `nas-app.toml` and `config.example.toml` current, push to main, and confirm CI has published `:main`. Then, in `nulinspiratie/home-server` on a branch, add `containers/<slug>/` (the compose from `deploy/compose.example.yml` and `config.toml` from `config.example.toml`) and the `<slug>/<slug>` line in the allowlist, and open a PR there whose description is the `just handoff` block, followed by the Cloudflare and secrets steps as a checklist for Serwan. Never push to home-server `main` and never merge that PR.
7. **Never.** No `:latest`, no published ports, no host paths in code, no secrets in git, no changing the CI guard or tags, no Docker socket, no privileged anything, no push to home-server `main`.
8. **Other languages.** Replace the Dockerfile with the right one from `docs/dockerfile-archetypes.md`, keeping every convention, and update the CI `test` job to match.

## Hand-off summary

`just handoff` prints one block that the app session uses, verbatim, as the description of its home-server PR. It carries everything a reviewer of that PR needs without reading the app repo.

```text
=== NAS app hand-off ===
repo:           nulinspiratie/<repo>
slug:           <slug>
image:          ghcr.io/nulinspiratie/<slug>:main
stack/service:  <slug>/<slug>
internal_port:  8080
health:         /healthz
hostname:       <subdomain>.serwan.me
claude_access:  no
data:           /volume1/docker/<slug>/data -> /data
secrets:        none            (or: OPENAI_API_KEY, ... -> set on the NAS .env)
published:      yes, :main at <short-sha>
--- config.toml ---
<contents of config.example.toml>
--- end ---
```

The `published` line comes from `gh api` if available and says "unknown" otherwise, so the home-server PR isn't merged before the image exists. The app session opens that PR only after CI has published `:main`. In it, the app session adds `containers/<slug>/docker-compose.yml`, `containers/<slug>/config.toml` and the allowlist line, and lists the Cloudflare and secrets steps for you as a checklist. It never pushes to home-server `main`; merging the PR is your decision.

## Acceptance tests

Tests 1 to 3 the building session runs itself. Tests 4 onward need a throwaway repo made from the template, which you create on the phone after the template is merged; the session or you then run them against it.

- [ ] 1\. Template repo, push to main: `test` and `image-check` pass, `publish` is skipped.
- [ ] 2\. Local: `just test`, `just lint` and `just build` pass; `docker run --read-only --tmpfs /tmp --user 1000:1000 --cap-drop ALL --security-opt no-new-privileges:true -p 8080:8080` the image, `/healthz` returns 200 with `version` = the build arg.
- [ ] 3\. `just handoff` prints a complete block; with a broken `nas-app.toml` it exits non-zero.
- [ ] 4\. Create `template-smoke` from the template, push nothing: CI on the initial commit is green and publishes `ghcr.io/nulinspiratie/template-smoke:main` and `:<short-sha>`.
- [ ] 5\. The package is private and linked to the repo; the NAS PAT can pull it (`docker pull` from the laptop with the same PAT is enough).
- [ ] 6\. `docker buildx imagetools inspect` shows the revision label = full SHA, the source label = repo URL, and `:main` and `:<short-sha>` have the same digest.
- [ ] 7\. The container runs as uid 1000, `docker inspect` health goes `healthy` within 30 s.
- [ ] 8\. A PR to `template-smoke` runs `test` and `image-check` but publishes nothing.
- [ ] 9\. A repo whose name has capitals (`Template-Smoke2`) publishes a lowercase image name.
- [ ] 10\. Delete the smoke repos and their packages afterwards.

## Scope and open questions

**Out of scope:** the home-server side (applier, ruleset, shared `tunnel` network, safety check), Cloudflare setup, the secrets page, and migrating existing apps to the template conventions.

**Do not:**

- Push or reference `:latest`, build multi-arch, or use a PAT in CI.
- Add a `deploy.sh`, an ssh step, or anything that reaches the NAS.
- Push to home-server `main`; the app session only opens a PR there.
- Put secrets, tokens or NAS host paths in the repo.
- Remove the template guard; without it the template repo publishes an image of itself.

**Open questions:**

- [ ] Is Python with uv the right default placeholder, or do most new apps start as Node?
- [x] uid 1000 in the container vs your DSM user (often 1026): the applier creates `/volume1/docker/<slug>/data` owned by 1000 before a stack's first start.
- [x] Name of the Docker network cloudflared sits on: `tunnel`, created by hand and declared `external` (home-server `containers/cloudflared/`).
- [ ] Should `nas-app.toml` also declare a schedule or memory limit, or keep it minimal for now?

## Handing it to Claude Code

A cloud session can't open this doc, so the spec goes into the repo as a file.

1. On GitHub, create `nulinspiratie/nas-app-template`, private, with a README so `main` exists. Make sure the Claude GitHub App can access it.
2. Export this doc as Markdown.
3. Open a Claude Code cloud session on the repo and paste the prompt below, followed by the exported Markdown.
4. Review and merge its PR.
5. In the repo's Settings, tick "Template repository".
6. Create `template-smoke` from it and run acceptance tests 4 to 10.

Prompt:

```text
Build this repository as the template described in the spec below.
First commit the spec verbatim as docs/template-spec.md.
Then implement it on a branch and open a PR to main; do not push to main.
Run acceptance tests 1-3 yourself and report the results in the PR description.
Where the spec leaves something open, pick the simplest option that keeps
every runtime convention and list your choices in the PR description.

<paste the exported spec here>
```
