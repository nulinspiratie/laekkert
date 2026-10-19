# /// script
# requires-python = ">=3.11"
# ///
"""Print the hand-off block (the home-server PR description), or check the manifest.

    uv run scripts/handoff.py           # print the hand-off block
    uv run scripts/handoff.py --check   # only validate nas-app.toml (used in CI)

Stdlib only. Exits non-zero if nas-app.toml is invalid.
"""

import argparse
import json
import re
import subprocess
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOMAIN = "serwan.me"
DNS_LABEL = re.compile(r"[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?")
SECRET_NAME = re.compile(r"[A-Z][A-Z0-9]*(_[A-Z0-9]+)*")
SHORT_SHA = re.compile(r"[0-9a-f]{7}")


def validate_manifest(manifest: dict) -> list[str]:
    """Return a list of problems with a parsed nas-app.toml; empty means valid."""
    errors = []

    def table(name: str) -> dict:
        value = manifest.get(name)
        if not isinstance(value, dict):
            errors.append(f"[{name}] table is missing")
            return {}
        return value

    app, routing = table("app"), table("routing")
    storage, secrets = table("storage"), table("secrets")

    if not isinstance(app.get("description", ""), str):
        errors.append("app.description must be a string")
    port = app.get("internal_port")
    if isinstance(port, bool) or not isinstance(port, int) or not 1 <= port <= 65535:
        errors.append(f"app.internal_port must be an integer 1-65535, got {port!r}")
    health = app.get("health_path")
    if not isinstance(health, str) or not health.startswith("/"):
        errors.append(f"app.health_path must start with '/', got {health!r}")

    subdomain = routing.get("subdomain")
    if not isinstance(subdomain, str) or (
        subdomain and not DNS_LABEL.fullmatch(subdomain)
    ):
        errors.append(
            "routing.subdomain must be empty or a single lowercase DNS label, "
            f"got {subdomain!r}"
        )
    if not isinstance(routing.get("claude_access"), bool):
        errors.append("routing.claude_access must be true or false")

    if not isinstance(storage.get("data"), bool):
        errors.append("storage.data must be true or false")

    names = secrets.get("names")
    if not isinstance(names, list):
        errors.append("secrets.names must be a list of env var names")
    else:
        for name in names:
            if not isinstance(name, str) or not SECRET_NAME.fullmatch(name):
                errors.append(f"secrets.names: {name!r} is not UPPER_SNAKE_CASE")
        if len(set(map(str, names))) != len(names):
            errors.append("secrets.names has duplicates")

    return errors


def load_manifest(path: Path) -> dict:
    try:
        manifest = tomllib.loads(path.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError) as exc:
        sys.exit(f"{path.name}: cannot read: {exc}")
    errors = validate_manifest(manifest)
    if errors:
        sys.exit(f"{path.name} is invalid:\n" + "\n".join(f"  - {e}" for e in errors))
    return manifest


def repo_from_origin() -> tuple[str, str]:
    """Return (owner, name) from `git remote get-url origin`."""
    try:
        url = subprocess.run(
            ["git", "remote", "get-url", "origin"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        sys.exit("cannot read `git remote get-url origin`; pass --repo OWNER/NAME")
    # https://github.com/owner/name(.git), git@github.com:owner/name(.git), ...
    parts = re.split(r"[/:]", url.removesuffix("/").removesuffix(".git"))
    if len(parts) < 2 or not parts[-1] or not parts[-2]:
        sys.exit(f"cannot parse owner/name from origin URL {url!r}")
    return parts[-2], parts[-1]


def published(owner: str, slug: str) -> str:
    """Say whether :main exists on GHCR, via `gh api`; "unknown" if we can't tell."""
    try:
        result = subprocess.run(
            ["gh", "api", f"/users/{owner}/packages/container/{slug}/versions"],
            capture_output=True,
            text=True,
            timeout=20,
        )
        versions = json.loads(result.stdout) if result.returncode == 0 else None
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError):
        versions = None
    if not isinstance(versions, list):
        return "unknown (could not query GHCR; check the package before merging)"
    for version in versions:
        tags = version.get("metadata", {}).get("container", {}).get("tags", [])
        if "main" in tags:
            shas = [t for t in tags if SHORT_SHA.fullmatch(t)]
            return f"yes, :main at {shas[0] if shas else '?'}"
    return "no, :main is not on GHCR yet"


def handoff(manifest: dict, config_text: str, owner: str, name: str) -> str:
    slug = name.lower()
    image = f"ghcr.io/{owner.lower()}/{slug}:main"
    subdomain = manifest["routing"]["subdomain"] or slug
    if not DNS_LABEL.fullmatch(subdomain):
        sys.exit(
            f"slug {slug!r} is not a valid DNS label; set routing.subdomain "
            "in nas-app.toml"
        )
    names = manifest["secrets"]["names"]
    secrets = f"{', '.join(names)} -> set on the NAS .env" if names else "none"
    data = (
        f"/volume1/docker/{slug}/data -> /data"
        if manifest["storage"]["data"]
        else "none"
    )
    fields = [
        ("repo", f"{owner}/{name}"),
        ("slug", slug),
        ("image", image),
        ("stack/service", f"{slug}/{slug}"),
        ("internal_port", manifest["app"]["internal_port"]),
        ("health", manifest["app"]["health_path"]),
        ("hostname", f"{subdomain}.{DOMAIN}"),
        ("claude_access", "yes" if manifest["routing"]["claude_access"] else "no"),
        ("data", data),
        ("secrets", secrets),
        ("published", published(owner, slug)),
    ]
    lines = ["=== NAS app hand-off ==="]
    lines += [f"{label + ':':<16}{value}" for label, value in fields]
    lines += ["--- config.toml ---", config_text.rstrip("\n"), "--- end ---"]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="only validate")
    parser.add_argument("--manifest", type=Path, default=ROOT / "nas-app.toml")
    parser.add_argument("--config", type=Path, default=ROOT / "config.example.toml")
    parser.add_argument("--repo", help="OWNER/NAME; default: git remote origin")
    args = parser.parse_args()

    manifest = load_manifest(args.manifest)
    if args.check:
        print(f"{args.manifest.name} is valid")
        return
    if args.repo:
        owner, _, name = args.repo.partition("/")
        if not owner or not name:
            sys.exit("--repo must be OWNER/NAME")
    else:
        owner, name = repo_from_origin()
    print(handoff(manifest, args.config.read_text(encoding="utf-8"), owner, name))


if __name__ == "__main__":
    main()
