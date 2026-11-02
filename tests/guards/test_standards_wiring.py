import pytest

from conftest import REPO

PRE_COMMIT = (REPO / ".pre-commit-config.yaml").read_text(encoding="utf-8")
CI = (REPO / ".github/workflows/ci.yml").read_text(encoding="utf-8")
BOTH = [
    "check_function_docstrings.py",
    "check_banned_names.py",
    "ruff check",
    "ruff format",
    "pydoclint",
    "eslint",
    "prettier",
]


@pytest.mark.parametrize("check", BOTH)
def test_check_runs_in_pre_commit_and_ci(check):
    assert check in PRE_COMMIT
    assert check in CI


@pytest.mark.parametrize(
    "heavy", ["pytest", "run_pyodide_tests", "check_wheel.py", "--mode history"]
)
def test_heavy_checks_stay_out_of_pre_commit(heavy):
    assert heavy not in PRE_COMMIT
    assert heavy in CI


def test_ci_installs_node_tooling_from_the_lockfile():
    assert "npm ci" in CI


def test_eslint_denylist_matches_guards_toml():
    import tomllib

    config = tomllib.loads((REPO / "tools/guards/guards.toml").read_text(encoding="utf-8"))
    eslint = (REPO / "eslint.config.mjs").read_text(encoding="utf-8")
    for name in config["names"]["generic"] + config["names"]["banned_names"]:
        assert f'"{name}"' in eslint
