import pytest
from conftest import assert_fails_quietly, git, plant, run_guard

GUARD = "check_secrets.py"
# Assembled at runtime so gitleaks does not flag this source file.
SECRET = "ghp_" + "Zr8vQ2mXk4TnLw7Yb1PdHs9Gc3Jf6Ea0Ru5N"


@pytest.fixture
def repo(tmp_path):
    git(tmp_path, "init", "-q")
    plant(tmp_path, "README.md", "clean\n")
    return tmp_path


def commit(repo, message="c"):
    git(repo, "add", "-A")
    git(repo, "-c", "commit.gpgsign=false", "commit", "-q", "-m", message)


def test_staged_secret_fails(repo):
    plant(repo, "leak.txt", f"token: {SECRET}\n")
    git(repo, "add", "leak.txt")
    assert_fails_quietly(run_guard(GUARD, "--root", repo, "--mode", "staged"), "leak.txt", SECRET)


def test_clean_staged_passes(repo):
    git(repo, "add", "README.md")
    result = run_guard(GUARD, "--root", repo, "--mode", "staged")
    assert result.returncode == 0, result.stdout


def test_secret_in_old_commit_fails_history(repo):
    plant(repo, "leak.txt", f"token: {SECRET}\n")
    commit(repo)
    (repo / "leak.txt").unlink()
    commit(repo, "remove")
    assert_fails_quietly(run_guard(GUARD, "--root", repo, "--mode", "history"), "leak.txt", SECRET)


def test_clean_history_passes(repo):
    commit(repo)
    result = run_guard(GUARD, "--root", repo, "--mode", "history")
    assert result.returncode == 0, result.stdout


def test_empty_history_passes_and_says_so(repo):
    result = run_guard(GUARD, "--root", repo, "--mode", "history")
    assert result.returncode == 0, result.stdout
    assert "0 commits" in result.stdout


def test_untracked_secret_fails_tree(repo):
    plant(repo, "leak.txt", f"token: {SECRET}\n")
    assert_fails_quietly(run_guard(GUARD, "--root", repo, "--mode", "tree"), "leak.txt", SECRET)


def test_real_repo_tree_is_clean():
    result = run_guard(GUARD, "--mode", "tree")
    assert result.returncode == 0, result.stdout
