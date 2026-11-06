import pytest

from conftest import assert_fails_quietly, plant, run_guard

GUARD = "check_risky_types.py"
RISKY = [
    "a.csv",
    "a.xlsx",
    "a.xls",
    "a.db",
    "a.sqlite",
    "a.sqlite3",
    "a.log",
    ".env",
    ".env.local",
    "a.ipynb",
    "a.jsonl",
    "a.dump",
    "UPPER.CSV",
    "a.json",
]


@pytest.mark.parametrize("name", RISKY)
def test_risky_type_fails(clean_tree, name):
    rel = f"docs/{name}"
    plant(clean_tree, rel, "x")
    assert_fails_quietly(run_guard(GUARD, "--root", clean_tree), rel)


@pytest.mark.parametrize("name", ["a.csv", "a.xlsx", "a.json", "sub/a.json"])
def test_allowlisted_in_fixtures_passes(clean_tree, name):
    plant(clean_tree, f"tests/fixtures/synthetic/{name}", "x")
    guard_run = run_guard(GUARD, "--root", clean_tree)
    assert guard_run.returncode == 0, guard_run.stdout


@pytest.mark.parametrize(
    "name", [".env", "a.db", "a.log", "a.sqlite", "a.ipynb", "a.dump", "a.jsonl"]
)
def test_not_every_risky_type_is_allowed_in_fixtures(clean_tree, name):
    rel = f"tests/fixtures/synthetic/{name}"
    plant(clean_tree, rel, "x")
    assert_fails_quietly(run_guard(GUARD, "--root", clean_tree), rel)


def test_json_config_allowlist_is_exact_path(clean_tree):
    plant(clean_tree, "web/package.json", "{}")
    assert run_guard(GUARD, "--root", clean_tree).returncode == 0
    plant(clean_tree, "docs/package.json", "{}")
    assert_fails_quietly(run_guard(GUARD, "--root", clean_tree), "docs/package.json")


def test_clean_tree_passes(clean_tree):
    assert run_guard(GUARD, "--root", clean_tree).returncode == 0


def test_real_repo_passes():
    assert run_guard(GUARD).returncode == 0
