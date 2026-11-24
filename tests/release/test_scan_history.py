"""CP10b item 4: tools/release/scan_history.py scans every commit on every ref.

Violations are planted in temporary repos, in a commit that a later commit removes, so only the
history holds them. The scan prints file name, commit and category only, never the matched text.
"""

import subprocess
import sys

import pytest

from conftest import REPO, git, plant

SCRIPT = REPO / "tools" / "release" / "scan_history.py"
# Assembled at runtime so this file holds no token of its own.
RECEIPT = "QGH" + "1234ABC"
PHONE = "07" + "12345678"
EMAIL = "someone" + "@" + "provider.co.ke"
NATIONAL_ID = "ID Number: " + "2" + "7654321"
SECRET = "ghp_" + "Zr8vQ2mXk4TnLw7Yb1PdHs9Gc3Jf6Ea0Ru5N"
FAKE_PHONE = "254700000" + "123"
LARGE_BINARY = b"\0\1\2\3" * (768 * 1024)


@pytest.fixture
def repo(tmp_path):
    git(tmp_path, "init", "-q", "-b", "main")
    plant(tmp_path, "README.md", "clean\n")
    commit(tmp_path, "first")
    return tmp_path


def commit(repo, message="change"):
    git(repo, "add", "-A")
    git(repo, "-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", message)
    return git(repo, "rev-parse", "--short=12", "HEAD").stdout.strip()


def plant_then_remove(repo, rel, content):
    plant(repo, rel, content)
    introduced = commit(repo, "add")
    (repo / rel).unlink()
    commit(repo, "remove")
    return introduced


def scan(repo):
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--root", str(repo)],
        capture_output=True,
        text=True,
        cwd=REPO,
    )


def assert_found(run, name, commit_id, category, *never_printed):
    output = run.stdout + run.stderr
    assert run.returncode == 1, output
    assert any(
        name in line and commit_id in line and category in line for line in run.stdout.splitlines()
    ), output
    for text in never_printed:
        assert text not in output


def test_a_clean_history_passes(repo):
    run = scan(repo)
    assert run.returncode == 0, run.stdout + run.stderr
    assert "scan_history: PASS" in run.stdout


@pytest.mark.parametrize(
    ("category", "content"),
    [
        ("receipt", f"paid {RECEIPT} today\n"),
        ("phone", f"call {PHONE}\n"),
        ("email", f"mail {EMAIL}\n"),
        ("id", f"{NATIONAL_ID}\n"),
    ],
)
def test_text_in_a_removed_file_is_found_with_its_commit(repo, category, content):
    introduced = plant_then_remove(repo, "notes/old.txt", content)
    token = content.split(" ", 1)[1].strip() if category != "id" else NATIONAL_ID
    assert_found(scan(repo), "notes/old.txt", introduced, category, token)


def test_a_pdf_outside_the_synthetic_fixtures_is_found(repo):
    introduced = plant_then_remove(repo, "docs/statement.pdf", b"%PDF-1.4\n%%EOF\n")
    assert_found(scan(repo), "docs/statement.pdf", introduced, "pdf")


def test_a_large_binary_is_found(repo):
    introduced = plant_then_remove(repo, "assets/blob.bin", LARGE_BINARY)
    assert_found(scan(repo), "assets/blob.bin", introduced, "large-binary")


def test_a_secret_is_found_by_gitleaks(repo):
    introduced = plant_then_remove(repo, "config/leak.txt", f"token: {SECRET}\n")
    assert_found(scan(repo), "config/leak.txt", introduced, "secret", SECRET)


def test_a_commit_on_another_branch_is_scanned(repo):
    git(repo, "checkout", "-q", "-b", "side")
    plant(repo, "side.txt", f"{PHONE}\n")
    introduced = commit(repo, "side")
    git(repo, "checkout", "-q", "main")
    assert_found(scan(repo), "side.txt", introduced, "phone", PHONE)


def test_a_token_in_a_file_name_is_redacted(repo):
    introduced = plant_then_remove(repo, f"exports/{PHONE}.txt", "nothing\n")
    assert_found(scan(repo), "exports/[redacted].txt", introduced, "phone", PHONE)


def test_a_token_in_a_commit_message_is_found(repo):
    plant(repo, "a.txt", "fine\n")
    introduced = commit(repo, f"note {PHONE}")
    assert_found(scan(repo), "(commit message)", introduced, "phone", PHONE)


def test_each_file_is_reported_once_at_the_commit_that_introduced_it(repo):
    plant(repo, "notes/old.txt", f"{RECEIPT}\n")
    introduced = commit(repo, "add")
    plant(repo, "other.txt", "more\n")
    commit(repo, "more")
    run = scan(repo)
    lines = [line for line in run.stdout.splitlines() if "notes/old.txt" in line]
    assert len(lines) == 1, run.stdout
    assert introduced in lines[0]


def test_synthetic_fixtures_keep_their_allowances(repo):
    plant(repo, "tests/fixtures/synthetic/F-X.pdf", b"%PDF-1.4\n%%EOF\n")
    plant(repo, "tests/fixtures/synthetic/F-X.txt", f"{FAKE_PHONE}\n")
    plant(repo, "tests/fixtures/synthetic/F-BIG.pdf", b"%PDF-1.4\n" + LARGE_BINARY)
    commit(repo, "fixtures")
    run = scan(repo)
    assert run.returncode == 0, run.stdout


def test_reserved_example_addresses_and_hex_digests_are_not_findings(repo):
    plant(repo, "docs/a.md", "user" + "@" + "example.com and " + "a1b2c3d4e5" * 4 + "\n")
    commit(repo, "docs")
    run = scan(repo)
    assert run.returncode == 0, run.stdout


def test_the_verdict_counts_findings_and_commits(repo):
    plant_then_remove(repo, "a.txt", f"{PHONE}\n")
    plant_then_remove(repo, "b.txt", f"{RECEIPT}\n")
    run = scan(repo)
    assert "scan_history: FAIL (2 finding(s) in 2 commit(s))" in run.stdout
