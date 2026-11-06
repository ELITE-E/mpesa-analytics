"""Shared helpers for guard tests. Violations are planted in tmp_path only."""

import os
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
GUARDS = REPO / "tools" / "guards"


def run_guard(script, *args, cwd=None):
    return subprocess.run(
        [sys.executable, str(GUARDS / script), *map(str, args)],
        capture_output=True,
        text=True,
        cwd=cwd or REPO,
    )


def git(repo, *args):
    env = {
        **os.environ,
        "GIT_CONFIG_GLOBAL": os.devnull,
        "GIT_CONFIG_NOSYSTEM": "1",
    }
    return subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@example.invalid", *args],
        cwd=repo,
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )


def plant(root, rel, content=""):
    path = Path(root) / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(content, bytes):
        path.write_bytes(content)
    else:
        path.write_text(content, encoding="utf-8")
    return path


def assert_fails_quietly(guard_run, name, *secrets):
    """Guard must exit 1, name the file, and never echo the matched text."""
    assert guard_run.returncode == 1, guard_run.stdout + guard_run.stderr
    assert name in guard_run.stdout
    output = guard_run.stdout + guard_run.stderr
    for secret in secrets:
        assert secret not in output


@pytest.fixture
def clean_tree(tmp_path):
    plant(tmp_path, "README.md", "A clean tree with nothing to report.\n")
    plant(tmp_path, "src/mpesa_core/__init__.py", "")
    plant(tmp_path, "tests/fixtures/synthetic/notes.txt", "synthetic\n")
    return tmp_path
