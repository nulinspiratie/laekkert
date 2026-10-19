# Dockerfile archetypes

The repo's own `Dockerfile` is the Python + `uv` archetype. For an app in another language,
replace it with one of these. They are the auto-deploy reference archetypes adapted to the
template's runtime conventions. Whatever you pick, the image must still:

- listen on `0.0.0.0:8080` and answer `GET /healthz` with
  `{"status":"ok","version":"<APP_VERSION>"}`;
- take `ARG GIT_SHA=dev` and set `ENV APP_VERSION=$GIT_SHA` in the final stage (CI passes
  the commit SHA);
- set `ENV APP_CONFIG=/config/config.toml` and treat a missing file as defaults;
- have a `HEALTHCHECK` that hits `/healthz` with the runtime's own language or binary,
  never an installed curl;
- run as uid/gid 1000 and write only to `/data` and `/tmp` (it runs with
  `read_only: true` and a tmpfs `/tmp`);
- log to stdout/stderr only.

After swapping, update the CI `test` job and the `test`/`lint`/`run` recipes in the
`justfile` to the new toolchain. Keep the `nas-app.toml` check step, `image-check` and
`publish` unchanged. `.dockerignore` excludes `docs/`, `tests/`, `scripts/` and every `*.md`
except `README.md`; adjust it if the build needs any of those.

## Node service

For a `package.json` app with no separate Python backend (Express, Fastify, Hono, …).
Placeholder: `<START_CMD>` (as JSON array items, e.g. `"node", "dist/index.js"`). Listen on a
fixed 8080, not on `$PORT`. Parse `APP_CONFIG` with a TOML library (e.g.
`smol-toml`).

The official Node images already have a `node` user with uid/gid 1000, so use it instead
of creating `app`.

```dockerfile
# syntax=docker/dockerfile:1.7

# ---------- Builder stage ----------
FROM node:24-slim AS builder

WORKDIR /app

# Deps first for layer caching.
COPY package.json package-lock.json ./
RUN npm ci

# Build (drop this if the project has no build step).
COPY . .
RUN npm run build

# Prune dev deps for the runtime copy.
RUN npm prune --omit=dev

# ---------- Runtime stage ----------
FROM node:24-slim AS runtime

RUN mkdir /data && chown node:node /data

WORKDIR /app

COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/dist         /app/dist
COPY --from=builder /app/package.json /app/package.json

ARG GIT_SHA=dev
ENV NODE_ENV=production \
    APP_VERSION=$GIT_SHA \
    APP_CONFIG=/config/config.toml

# node is uid/gid 1000 in the official images.
USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD ["node", "-e", "fetch('http://127.0.0.1:8080/healthz',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

CMD [<START_CMD>]
```

Adjust the runtime `COPY` lines to the project's output paths. Without a build step, copy
`src/` (or wherever the entrypoint lives) instead of `dist/`. Do not use `npm start` as the
command: npm writes to `~/.npm`, which is read-only.

CI `test` job for Node, replacing the uv steps:

```yaml
      - uses: actions/setup-node@v7
        with:
          node-version: "24"
          cache: npm
      - run: npm ci
      - run: npm run lint --if-present
      - run: npm test
      - uses: astral-sh/setup-uv@v10.3.0   # only for the manifest check
      - name: Check nas-app.toml
        run: uv run scripts/handoff.py --check
```

## Mixed: Node frontend + Python backend

For a repo with a frontend that builds to static files (e.g. `apps/web-frontend/`) and a
`uv`-managed Python backend that serves them (e.g. `apps/api-backend/`). A Node stage builds
the frontend; the backend uses the same two-stage `uv` pattern as the repo's own
`Dockerfile`, so the runtime image has no Node in it.

Placeholders: `<FRONTEND_DIR>`, `<BACKEND_DIR>`, `<ENTRYPOINT>` (the backend's console
script, which must listen on `0.0.0.0:8080`).

```dockerfile
# syntax=docker/dockerfile:1.7

# ---------- Frontend build ----------
FROM node:24-slim AS frontend-build

WORKDIR /build/<FRONTEND_DIR>
COPY <FRONTEND_DIR>/package.json <FRONTEND_DIR>/package-lock.json ./
RUN npm ci
COPY <FRONTEND_DIR>/ ./
RUN npm run build

# ---------- Backend build ----------
FROM python:3.12-slim AS builder

COPY --from=ghcr.io/astral-sh/uv:0.11.32 /uv /uvx /bin/

ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PYTHON_DOWNLOADS=never

WORKDIR /app

COPY <BACKEND_DIR>/pyproject.toml <BACKEND_DIR>/uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-install-project --no-dev

COPY <BACKEND_DIR>/src/ ./src/
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-editable

# ---------- Runtime ----------
FROM python:3.12-slim AS runtime

RUN groupadd --gid 1000 app \
    && useradd --uid 1000 --gid app --no-create-home --home-dir /nonexistent app \
    && mkdir /data \
    && chown app:app /data

WORKDIR /app

COPY --from=builder /app/.venv /app/.venv
COPY --from=frontend-build /build/<FRONTEND_DIR>/dist /app/static

ARG GIT_SHA=dev
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    STATIC_DIR=/app/static \
    APP_VERSION=$GIT_SHA \
    APP_CONFIG=/config/config.toml

USER app

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/healthz',timeout=4).status==200 else 1)"

ENTRYPOINT ["<ENTRYPOINT>"]
```

The backend reads `STATIC_DIR` to find the built frontend. If the backend depends on a
sibling package by relative path (e.g. `"../../shared-lib"` in its `pyproject.toml`),
`uv sync` from the backend directory alone can't resolve it: copy the sibling into the
builder at the same relative location, or make the repo a `uv` workspace and sync from the
root. The CI `test` job then needs both the Node steps above and the uv steps from
`ci.yml`, run in the right directories.

## Generic

For anything else (Go or Rust binary, static site, custom build). Placeholders:
`<BUILD_IMAGE>`, `<BASE_IMAGE>`, `<BINARY>`.

```dockerfile
# syntax=docker/dockerfile:1.7

# ---------- Builder stage ----------
FROM <BUILD_IMAGE> AS builder
WORKDIR /src
COPY . .
# TODO: build a single binary to /out/<BINARY>, e.g.
#   RUN CGO_ENABLED=0 go build -o /out/<BINARY> ./cmd/server
#   RUN cargo build --release && cp target/release/<BINARY> /out/

# ---------- Runtime stage ----------
FROM <BASE_IMAGE>

COPY --from=builder /out/<BINARY> /app/<BINARY>

ARG GIT_SHA=dev
ENV APP_VERSION=$GIT_SHA \
    APP_CONFIG=/config/config.toml

# Distroless "nonroot" is uid 65532; the conventions need 1000.
# For a Debian/Alpine base, create the user and /data as in the Python Dockerfile.
USER 1000:1000

EXPOSE 8080

# The binary checks its own health: give it a `healthcheck` subcommand that GETs
# http://127.0.0.1:8080/healthz and exits 0 on 200, 1 otherwise.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD ["/app/<BINARY>", "healthcheck"]

ENTRYPOINT ["/app/<BINARY>"]
```

Notes:

- With a distroless or `scratch` base there is no shell and no `mkdir`; `/data` is created
  by the NAS bind mount, so that is fine at runtime.
- A static site needs a server that runs read-only as uid 1000 on 8080 and answers
  `/healthz` with the version JSON. Stock nginx wants writable cache and pid paths: point
  them at `/tmp` (`pid /tmp/nginx.pid;`, `client_body_temp_path /tmp/...`), or serve the
  files from a tiny binary instead. Bake the version into `/healthz` at build time from
  `GIT_SHA`.
- Leave a comment at the top of the finished Dockerfile saying which archetype it came
  from.
