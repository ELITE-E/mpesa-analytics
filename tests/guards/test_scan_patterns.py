import pytest

from conftest import assert_fails_quietly, git, plant, run_guard

GUARD = "scan_patterns.py"

# Built at runtime so this file holds no phone-shaped or receipt-shaped literal.
FAKE_INTL = "254700000" + "123"
FAKE_LOCAL = "07000000" + "12"
REAL_LOOKING = {
    "2547": "2547" + "12345678",
    "2541": "2541" + "12345678",
    "07": "07" + "12345678",
    "01": "01" + "12345678",
    "plus-prefixed": "+2547" + "12345678",
    "separated-local": "0712" + " 345 " + "678",
    "separated-intl": "254 712" + " 345 " + "678",
    "masked-intl-stars": "2547" + "******" + "78",
    "masked-local-stars": "07" + "****" + "5678",
    "masked-intl-x": "2547" + "XXXXXX" + "78",
    "masked-middle": "254712" + "***" + "678",
    "masked-local-middle": "0712" + "***" + "678",
    "masked-spaced": "07XX" + " XXX " + "678",
    "masked-bullets": "2547" + "\u2022\u2022\u2022\u2022\u2022" + "678",
    "masked-01": "01" + "****" + "5678",
    "receipt": "QGH" + "1234ABC",
    "receipt-digits-last": "ABCDEFGHI" + "1",
}


@pytest.mark.parametrize("token", REAL_LOOKING.values(), ids=REAL_LOOKING.keys())
def test_planted_token_fails_without_echo(clean_tree, token):
    plant(clean_tree, "docs/note.md", f"before {token} after\n")
    assert_fails_quietly(run_guard(GUARD, "--root", clean_tree), "docs/note.md", token)


def test_clean_tree_passes(clean_tree):
    assert run_guard(GUARD, "--root", clean_tree).returncode == 0


def test_count_is_reported_once_per_token(clean_tree):
    # The local form also looks like a receipt; it must still count once.
    text = " ".join(["2547" + "12345678", "07" + "12345678", "QGH" + "1234ABC"])
    plant(clean_tree, "a.txt", text)
    guard_run = run_guard(GUARD, "--root", clean_tree)
    assert guard_run.returncode == 1
    assert "a.txt: 3 " in guard_run.stdout


@pytest.mark.parametrize(
    "text",
    [
        "9" + "2547" + "12345678",
        "2547" + "12345678" + "9",
        "9" + "07" + "12345678",
        "07" + "12345678" + "9",
        "ABCDEFGHIJ",
        "abc" + "1234def0",
        "AB" + "12345",
        "ABCDEFGHIJK" + "1",
    ],
    ids=["lead-12", "trail-12", "lead-10", "trail-10", "no-digit", "lower", "short", "long"],
)
def test_lookarounds_reject_near_misses(clean_tree, text):
    plant(clean_tree, "a.txt", f"x {text} y\n")
    guard_run = run_guard(GUARD, "--root", clean_tree)
    assert guard_run.returncode == 0, guard_run.stdout


@pytest.mark.parametrize("token", [FAKE_INTL, FAKE_LOCAL])
def test_fake_range_allowed_only_in_fixtures(clean_tree, token):
    plant(clean_tree, "fixtures/synthetic/ok.txt", f"{token}\n")
    assert run_guard(GUARD, "--root", clean_tree).returncode == 0
    plant(clean_tree, "docs/bad.md", f"{token}\n")
    assert_fails_quietly(run_guard(GUARD, "--root", clean_tree), "docs/bad.md", token)


@pytest.mark.parametrize(
    "token",
    ["254700001" + "000", "07000001" + "00", "2547" + "12345678", "QGH" + "1234ABC"],
    ids=["near-intl", "near-local", "real-intl", "receipt"],
)
def test_outside_fake_range_fails_in_fixtures(clean_tree, token):
    plant(clean_tree, "fixtures/synthetic/bad.txt", f"{token}\n")
    assert_fails_quietly(
        run_guard(GUARD, "--root", clean_tree), "fixtures/synthetic/bad.txt", token
    )


@pytest.mark.parametrize("lock", ["uv.lock", "web/package-lock.json"])
def test_lockfile_exempt_from_eight_digit_and_receipt_only(clean_tree, lock):
    plant(clean_tree, lock, " ".join(["07" + "12345678", "QGH" + "1234ABC"]))
    assert run_guard(GUARD, "--root", clean_tree).returncode == 0
    masked = "2547" + "******" + "78"
    plant(clean_tree, lock, masked)
    assert_fails_quietly(run_guard(GUARD, "--root", clean_tree), lock, masked)


def test_non_lockfile_with_lock_in_name_is_not_exempt(clean_tree):
    token = "07" + "12345678"
    plant(clean_tree, "docs/uv.lock.md", token)
    assert_fails_quietly(run_guard(GUARD, "--root", clean_tree), "docs/uv.lock.md", token)


def test_token_in_file_name_fails_and_name_is_redacted(clean_tree):
    token = "2547" + "12345678"
    plant(clean_tree, f"docs/statement_{token}.txt", "nothing\n")
    guard_run = run_guard(GUARD, "--root", clean_tree)
    assert_fails_quietly(guard_run, "docs/statement_", token)


def test_force_tracked_file_in_pruned_dir_is_scanned(clean_tree):
    token = "2547" + "12345678"
    plant(clean_tree, ".cache/hidden.txt", token)
    assert run_guard(GUARD, "--root", clean_tree).returncode == 0
    git(clean_tree, "init", "-q")
    git(clean_tree, "add", "-f", ".cache/hidden.txt")
    assert_fails_quietly(run_guard(GUARD, "--root", clean_tree), ".cache/hidden.txt", token)


DIGITS = "1234" + "567890"


@pytest.mark.parametrize("length", [40, 64], ids=["sha1", "sha256"])
def test_digit_run_inside_full_hex_digest_passes(clean_tree, length):
    digest = "a" * 16 + DIGITS + "b" * (length - 26)
    plant(clean_tree, "docs/hashes.md", f"sha256 `{digest}`\n")
    guard_run = run_guard(GUARD, "--root", clean_tree)
    assert guard_run.returncode == 0, guard_run.stdout


@pytest.mark.parametrize("length", [39, 41, 63, 65], ids=str)
def test_digest_exemption_needs_exact_digest_length(clean_tree, length):
    plant(clean_tree, "docs/hashes.md", "a" * 16 + DIGITS + "b" * (length - 26))
    assert_fails_quietly(run_guard(GUARD, "--root", clean_tree), "docs/hashes.md", DIGITS)


@pytest.mark.parametrize(
    "token",
    ["receipt" + "QGH" + "1234ABC", "tel" + "2547" + "12345678", "no" + "07" + "12345678"],
    ids=["receipt", "intl", "local"],
)
def test_token_glued_to_lowercase_still_fails(clean_tree, token):
    plant(clean_tree, "docs/note.md", f"x {token} y\n")
    assert_fails_quietly(run_guard(GUARD, "--root", clean_tree), "docs/note.md", token)


@pytest.mark.parametrize("separator", [" ", "", "-"], ids=["space", "glued", "hyphen"])
def test_receipt_like_token_next_to_a_hash_still_fails(clean_tree, separator):
    token = "QGH" + "1234ABC"
    plant(clean_tree, "docs/hashes.md", "a" * 64 + separator + token)
    assert_fails_quietly(run_guard(GUARD, "--root", clean_tree), "docs/hashes.md", token)


def test_real_repo_has_zero_findings():
    guard_run = run_guard(GUARD)
    assert guard_run.returncode == 0, guard_run.stdout
