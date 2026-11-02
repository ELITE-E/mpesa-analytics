import re

import pytest
from conftest import REPO

BOTH = [
    "scan_patterns.py",
    "check_pdf_location.py",
    "check_risky_types.py",
    "check_fixture_provenance.py",
    "check_secrets.py",
    "check_imports.py",
    "check_core_purity.py",
]


@pytest.mark.parametrize("guard", BOTH)
def test_guard_runs_in_pre_commit_and_ci(guard):
    assert guard in (REPO / ".pre-commit-config.yaml").read_text()
    assert guard in (REPO / ".github/workflows/ci.yml").read_text()


def test_wheel_check_is_ci_only():
    assert "check_wheel.py" not in (REPO / ".pre-commit-config.yaml").read_text()
    assert "check_wheel.py" in (REPO / ".github/workflows/ci.yml").read_text()


@pytest.mark.parametrize("mode", ["staged", "history"])
def test_gitleaks_covers_staged_and_history(mode):
    wired = (REPO / ".pre-commit-config.yaml").read_text() + (
        REPO / ".github/workflows/ci.yml"
    ).read_text()
    assert f"--mode {mode}" in wired


def test_ci_defines_no_secrets():
    # \b keeps the check_secrets.py guard name from matching a secrets context.
    assert not re.search(r"\bsecrets\.", (REPO / ".github/workflows/ci.yml").read_text())
