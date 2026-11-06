import shutil
import subprocess
import tomllib

import pytest

from conftest import GUARDS, REPO, git


@pytest.fixture
def repo(tmp_path):
    shutil.copy(REPO / ".gitignore", tmp_path / ".gitignore")
    git(tmp_path, "init", "-q")
    return tmp_path


def ignored(repo, rel):
    return subprocess.run(["git", "check-ignore", "-q", rel], cwd=repo).returncode == 0


@pytest.mark.parametrize(
    "rel",
    ["a.pdf", "d/a.csv", "a.xlsx", "a.db", "a.sqlite3", "a.log", ".env", ".env.local"],
)
def test_denied_everywhere_else(repo, rel):
    assert ignored(repo, rel)


@pytest.mark.parametrize("rel", ["a.pdf", "a.csv", "sub/a.xlsx", "sub/a.db"])
def test_excepted_in_fixtures(repo, rel):
    assert not ignored(repo, f"tests/fixtures/synthetic/{rel}")


def test_every_pruned_location_is_gitignored(repo):
    config = tomllib.loads((GUARDS / "guards.toml").read_text())
    for name in config["walk"]["prune_names"] + config["walk"]["prune_paths"]:
        assert ignored(repo, f"{name}/file.txt"), name
