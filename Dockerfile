# syntax=docker/dockerfile:1.7

# ---------- Builder stage ----------
FROM python:3.12-slim AS builder

COPY --from=ghcr.io/astral-sh/uv:0.11.32 /uv /uvx /bin/

ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PYTHON_DOWNLOADS=never

WORKDIR /app

# Install deps first for layer caching.
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-install-project --no-dev

# Install the project itself.
COPY src/ ./src/
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-editable

# ---------- Runtime stage ----------
FROM python:3.12-slim AS runtime

# Uncomment and list packages if the runtime needs apt deps.
# RUN apt-get update \
#     && apt-get install -y --no-install-recommends <APT_PACKAGES> \
#     && rm -rf /var/lib/apt/lists/*

# uid/gid 1000 owns /data; nothing else in the image is writable at runtime.
RUN groupadd --gid 1000 app \
    && useradd --uid 1000 --gid app --no-create-home --home-dir /nonexistent app \
    && mkdir /data \
    && chown app:app /data

WORKDIR /app

COPY --from=builder /app/.venv /app/.venv

ARG GIT_SHA=dev
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    APP_VERSION=$GIT_SHA \
    APP_CONFIG=/config/config.toml

USER app

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/healthz',timeout=4).status==200 else 1)"

ENTRYPOINT ["app"]
