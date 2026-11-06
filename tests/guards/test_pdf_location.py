import pytest

from conftest import assert_fails_quietly, plant, run_guard

GUARD = "check_pdf_location.py"


@pytest.mark.parametrize(
    "rel",
    [
        "stray.pdf",
        "docs/a.pdf",
        "tests/fixtures/other/a.pdf",
        "fixtures/synthetic/a.pdf",
        "UPPER.PDF",
    ],
)
def test_pdf_outside_fixtures_fails(clean_tree, rel):
    plant(clean_tree, rel, b"not really a pdf")
    assert_fails_quietly(run_guard(GUARD, "--root", clean_tree), rel)


def test_pdf_in_fixtures_passes(clean_tree):
    plant(clean_tree, "tests/fixtures/synthetic/sub/a.pdf", b"synthetic")
    assert run_guard(GUARD, "--root", clean_tree).returncode == 0


def test_clean_tree_passes(clean_tree):
    assert run_guard(GUARD, "--root", clean_tree).returncode == 0


def test_output_redacts_phone_in_file_name(clean_tree):
    token = "2547" + "12345678"
    plant(clean_tree, f"statement_{token}.pdf", b"x")
    assert_fails_quietly(run_guard(GUARD, "--root", clean_tree), "statement_", token)


def test_real_repo_passes():
    assert run_guard(GUARD).returncode == 0
