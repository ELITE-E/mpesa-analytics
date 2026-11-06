import os
import stat
import subprocess
import sys

import pytest

from conftest import GUARDS, REPO, plant
from run_node_tool import resolve_node

LAUNCHER = GUARDS / "run_node_tool.py"
# The Git panel of an editor can start without nvm, so node is not on PATH.
NO_NODE_ENV = {"PATH": "/nonexistent", "HOME": os.devnull}


def run_without_node_on_path(tool, *args, cwd=REPO):
    return subprocess.run(
        [sys.executable, str(LAUNCHER), tool, *map(str, args)],
        capture_output=True,
        text=True,
        env=NO_NODE_ENV,
        cwd=cwd,
    )


def executable(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("#!/bin/sh\n")
    path.chmod(path.stat().st_mode | stat.S_IXUSR)
    return path


def test_pinned_node_is_preferred_over_path(tmp_path):
    pinned = executable(tmp_path / "pinned" / "node")
    executable(tmp_path / "onpath" / "node")
    assert resolve_node(pinned, str(tmp_path / "onpath")) == str(pinned)


def test_falls_back_to_node_on_path(tmp_path):
    on_path = executable(tmp_path / "onpath" / "node")
    assert resolve_node(tmp_path / "absent", str(tmp_path / "onpath")) == str(on_path)


def test_no_node_anywhere_resolves_to_none(tmp_path):
    assert resolve_node(tmp_path / "absent", str(tmp_path / "empty")) is None


@pytest.mark.parametrize("tool", ["eslint", "prettier"])
def test_tool_runs_with_no_node_on_path(tool):
    completed = run_without_node_on_path(tool, "--version")
    assert completed.returncode == 0, completed.stdout + completed.stderr


def test_eslint_violation_still_fails_with_no_node_on_path(tmp_path):
    plant(tmp_path, "pdf_reader/stub.js", "export function checkRow() {}\n")
    config = REPO / "eslint.config.mjs"
    completed = run_without_node_on_path(
        "eslint", "--config", config, "pdf_reader/stub.js", cwd=tmp_path
    )
    assert completed.returncode == 1


def test_prettier_violation_still_fails_with_no_node_on_path(tmp_path):
    plant(tmp_path, "pdf_reader/stub.js", "export const rowCount   =  1\n")
    config = REPO / "prettier.config.mjs"
    completed = run_without_node_on_path(
        "prettier", "--config", config, "--check", "pdf_reader/stub.js", cwd=tmp_path
    )
    assert completed.returncode == 1


def test_unknown_tool_fails_closed():
    assert run_without_node_on_path("not-a-tool").returncode == 2


@pytest.mark.parametrize("tool", ["eslint", "prettier"])
def test_pre_commit_runs_tools_through_the_launcher(tool):
    hooks = (REPO / ".pre-commit-config.yaml").read_text(encoding="utf-8")
    assert f"tools/guards/run_node_tool.py {tool}" in hooks
    assert f"node_modules/.bin/{tool}" not in hooks
