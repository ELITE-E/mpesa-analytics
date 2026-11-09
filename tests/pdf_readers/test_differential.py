import json
from functools import lru_cache

import pytest

from conftest import REPO
from mpesa_core.errors import ErrorCode, ExtractionError
from mpesa_core.extraction.rows import assemble_rows, build_rows
from mpesa_core.reconciliation.reconcile import NEWEST_FIRST, reconcile
from pdf_readers.pdfplumber_reader import extract_statement_pages
from synth.generate import COMMITTED_FIXTURES, FAKE_PASSWORD

FIXTURES = REPO / "tests" / "fixtures" / "synthetic"
NO_ANCHORS = "F-NOTABLE"
WITH_ROWS = sorted(set(COMMITTED_FIXTURES) - {NO_ANCHORS})
ENCRYPTED = "F-ENCRYPTED"


def expected(name):
    return json.loads((FIXTURES / f"{name}.expected.json").read_text(encoding="utf-8"))


def pdfjs_pages(name):
    return json.loads((FIXTURES / f"{name}.items.json").read_text(encoding="utf-8"))


@lru_cache(maxsize=None)
def pdfplumber_pages_as_json(name):
    password = FAKE_PASSWORD if name == ENCRYPTED else None
    content = (FIXTURES / f"{name}.pdf").read_bytes()
    return json.dumps(extract_statement_pages(content, password=password))


def pdfplumber_pages(name):
    return json.loads(pdfplumber_pages_as_json(name))


@pytest.mark.parametrize("name", WITH_ROWS)
def test_rows_from_pdfjs_pages_equal_the_ledger(name):
    assert build_rows(pdfjs_pages(name)) == expected(name)["rows"]


@pytest.mark.parametrize("name", WITH_ROWS)
def test_rows_from_pdfplumber_pages_equal_the_ledger(name):
    assert build_rows(pdfplumber_pages(name)) == expected(name)["rows"]


@pytest.mark.parametrize("name", WITH_ROWS)
def test_rows_from_both_readers_are_equal(name):
    assert build_rows(pdfjs_pages(name)) == build_rows(pdfplumber_pages(name))


@pytest.mark.parametrize("pages_of", [pdfjs_pages, pdfplumber_pages], ids=["pdfjs", "pdfplumber"])
def test_statement_with_no_anchor_raises_from_both_readers(pages_of):
    with pytest.raises(ExtractionError) as caught:
        build_rows(pages_of(NO_ANCHORS))
    assert caught.value.code is ErrorCode.LAYOUT_UNRECOGNIZED


@pytest.mark.parametrize("pages_of", [pdfjs_pages, pdfplumber_pages], ids=["pdfjs", "pdfplumber"])
@pytest.mark.parametrize("name", WITH_ROWS)
def test_quality_equals_the_ledger(pages_of, name):
    pages = pages_of(name)
    ledger = expected(name)
    quality = reconcile(pages, build_rows(pages))
    assert quality["row_count"] == ledger["row_count"]
    assert quality["status_counts"] == ledger["status_counts"]
    assert quality["chain_breaks"] == ledger["chain_breaks"]
    assert quality["chain_break_counts"][NEWEST_FIRST] == ledger["chain_break_kinds"]
    assert quality["unparsed_amounts"] == 0
    for label, agrees in ledger["summary_reconciliation"].items():
        assert quality["summary_reconciliation"][label] is agrees, label


@pytest.mark.parametrize("name", WITH_ROWS)
def test_receipt_histogram_sees_only_ten_character_receipts(name):
    quality = reconcile(pdfjs_pages(name), build_rows(pdfjs_pages(name)))
    assert quality["receipt_length_histogram"] == {10: expected(name)["row_count"]}


@pytest.mark.parametrize("pages_of", [pdfjs_pages, pdfplumber_pages], ids=["pdfjs", "pdfplumber"])
def test_continuation_above_is_counted_on_its_fixture(pages_of):
    counts = assemble_rows(pages_of("F-CONT-ABOVE"))["layout_counts"]
    assert counts["continuation_lines_above"] > 0
    assert counts["continuation_lines_below"] == 0


@pytest.mark.parametrize("pages_of", [pdfjs_pages, pdfplumber_pages], ids=["pdfjs", "pdfplumber"])
def test_continuation_below_is_counted_on_its_fixture(pages_of):
    counts = assemble_rows(pages_of("F-MULTILINE"))["layout_counts"]
    assert counts["continuation_lines_below"] > 0
    assert counts["continuation_lines_above"] == 0


@pytest.mark.parametrize("name", WITH_ROWS)
def test_nothing_on_a_fixture_needs_a_guess(name):
    counts = assemble_rows(pdfjs_pages(name))["layout_counts"]
    assert counts["unassigned_items"] == 0
    assert counts["anchor_cells_off_column"] == 0
    assert counts["ambiguous_continuation_lines"] == 0
    assert counts["status_from_non_anchor_line"] == 0


@pytest.mark.parametrize("pages_of", [pdfjs_pages, pdfplumber_pages], ids=["pdfjs", "pdfplumber"])
@pytest.mark.parametrize("name", WITH_ROWS)
def test_every_line_outside_rows_is_a_header_footer_or_summary(pages_of, name):
    counts = assemble_rows(pages_of(name))["layout_counts"]
    assert counts["unattached_other_lines"] == 0
    assert counts["unattached_header_lines"] > 0
    assert counts["unattached_footer_lines"] > 0
