import importlib.util
import subprocess
import sys
import tomllib
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "scripts" / "handoff.py"

spec = importlib.util.spec_from_file_location("handoff", SCRIPT)
handoff = importlib.util.module_from_spec(spec)
spec.loader.exec_module(handoff)


def manifest(**overrides):
    data = tomllib.loads((ROOT / "nas-app.toml").read_text())
    for dotted, value in overrides.items():
        section, key = dotted.split("__")
        data[section][key] = value
    return data


def test_repo_manifest_is_valid():
    assert handoff.validate_manifest(manifest()) == []


@pytest.mark.parametrize(
    "overrides",
    [
        {"app__internal_port": 0},
        {"app__internal_port": 65536},
        {"app__internal_port": "8080"},
        {"app__internal_port": True},
        {"app__health_path": "healthz"},
        {"routing__subdomain": "a.b"},
        {"routing__subdomain": "My-App"},
        {"routing__subdomain": "-app"},
        {"routing__claude_access": "no"},
        {"storage__data": 1},
        {"secrets__names": ["openai_api_key"]},
        {"secrets__names": ["OPENAI-KEY"]},
        {"secrets__names": "OPENAI_API_KEY"},
    ],
)
def test_invalid_manifest_is_rejected(overrides):
    assert handoff.validate_manifest(manifest(**overrides))


def test_missing_table_is_rejected():
    data = manifest()
    del data["secrets"]
    assert handoff.validate_manifest(data)


def test_valid_secrets_and_subdomain():
    data = manifest(routing__subdomain="my-app", secrets__names=["OPENAI_API_KEY"])
    assert handoff.validate_manifest(data) == []


def test_check_exits_nonzero_on_broken_manifest(tmp_path):
    broken = tmp_path / "nas-app.toml"
    broken.write_text((ROOT / "nas-app.toml").read_text().replace("8080", "80800", 1))
    result = subprocess.run(
        [sys.executable, SCRIPT, "--check", "--manifest", broken],
        capture_output=True,
        text=True,
    )
    assert result.returncode != 0
    assert "internal_port" in result.stderr


def test_handoff_block(monkeypatch):
    monkeypatch.setattr(handoff, "published", lambda owner, slug: "unknown")
    config = (ROOT / "config.example.toml").read_text()
    data = manifest(secrets__names=["OPENAI_API_KEY", "OTHER_KEY"])
    block = handoff.handoff(data, config, "nulinspiratie", "My-App")
    lines = block.splitlines()
    assert lines[0] == "=== NAS app hand-off ==="
    assert "image:          ghcr.io/nulinspiratie/my-app:main" in lines
    assert "hostname:       my-app.serwan.me" in lines
    assert "data:           /volume1/docker/my-app/data -> /data" in lines
    assert "secrets:        OPENAI_API_KEY, OTHER_KEY -> set on the NAS .env" in lines
    assert block.endswith(config.rstrip("\n") + "\n--- end ---")
