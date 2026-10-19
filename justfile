# Deploying is `git push` to main; there is deliberately no deploy recipe.

slug  := lowercase(`basename -s .git "$(git remote get-url origin 2>/dev/null || pwd)"`)
image := slug + ":local"

# List recipes
default:
    @just --list

# Run the tests
test:
    uv run pytest

# Lint the code and check nas-app.toml (what CI checks)
lint:
    uv run ruff check .
    uv run ruff format --check .
    uv run scripts/handoff.py --check

# Run the app locally on http://localhost:8080 with config.example.toml
run:
    APP_CONFIG=config.example.toml APP_DATA_DIR=.data uv run app

# Build the image locally (linux/amd64), tagged <slug>:local, never pushed
build *args:
    docker buildx build --platform linux/amd64 --load \
        --build-arg GIT_SHA=$(git rev-parse HEAD) -t {{image}} {{args}} .

# Print the hand-off block (the description of the home-server PR)
handoff:
    @uv run scripts/handoff.py
