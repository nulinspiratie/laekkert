"""App settings, read from the TOML file at $APP_CONFIG.

Every setting has a default here and an entry in config.example.toml. A missing
file means all defaults. Unknown keys are ignored, so a config.toml that gains a
key before the matching image is deployed does not crash the running app.
Secrets never go in this file; they arrive as environment variables.
"""

import os
import tomllib
from dataclasses import dataclass, fields
from pathlib import Path

DEFAULT_CONFIG_PATH = "/config/config.toml"


@dataclass(frozen=True)
class Settings:
    seed_examples: bool = True
    food_quick_tags: tuple[str, ...] = (
        "breakfast",
        "dinner",
        "kid approved",
        "quick",
        "vegetarian",
    )


def load_settings(path: str | os.PathLike[str] | None = None) -> Settings:
    if path is None:
        path = os.environ.get("APP_CONFIG", DEFAULT_CONFIG_PATH)
    try:
        data = tomllib.loads(Path(path).read_text(encoding="utf-8"))
    except FileNotFoundError:
        return Settings()
    lists = {f.name for f in fields(Settings) if isinstance(f.default, tuple)}
    known = {f.name for f in fields(Settings)}
    values = {}
    for k, v in data.items():
        if k not in known:
            continue
        if k in lists:
            # A list setting that is not a list of strings keeps its default.
            if not (isinstance(v, list) and all(isinstance(x, str) for x in v)):
                continue
            # Tuples, so they compare equal to the (hashable) defaults.
            v = tuple(v)
        values[k] = v
    return Settings(**values)
