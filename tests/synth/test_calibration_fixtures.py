import io
import json
import re
import tomllib

import pdfplumber
import pytest

from conftest import REPO
from synth.generate import CHAIN_BREAK_COUNT, COMMITTED_FIXTURES, WRONG_SUMMARY_LABELS
from synth.layout import HEADER_LABELS, WRAP_PITCH, wrap_details
from vendor import PDFJS_VERSION

FIXTURES = REPO / "fixtures" / "synthetic"
CALIBRATION_FIXTURES = [
    "F-BASIC",
    "F-MULTILINE",
    "F-MULTIPAGE",
    "F-NOTABLE",
    "F-JITTER",
    "F-CONT-ABOVE",
    "F-SUMMARY-MISMATCH",
    "F-CHAIN-BREAK",
]
FAKE_RECEIPT = re.compile(r"ZZ[A-Z0-9]{8}")
SUMMARY_LABELS = {
    "Total Paid In",
    "Total Withdrawn",
    "Transaction Count",
    "Opening Balance",
    "Closing Balance",
}
AMOUNT_FIELDS = ["paid_in", "withdrawn", "balance"]
MINIMUM_PAGES = 3
SAME_LINE_POINTS = 1.0
PLANTED_JITTER_POINTS = 0.4
ROUNDING_POINTS = 0.02


def expected(name):
    return json.loads((FIXTURES / f"{name}.expected.json").read_text(encoding="utf-8"))


def recorded(name):
    return json.loads((FIXTURES / f"{name}.items.json").read_text(encoding="utf-8"))


def manifest():
    return tomllib.loads((FIXTURES / "MANIFEST.toml").read_text(encoding="utf-8"))


def items_with_text(name, wanted):
    return [
        text_item
        for page in recorded(name)["pages"]
        for text_item in page["items"]
        if text_item["text"] == wanted
    ]


@pytest.mark.parametrize("name", CALIBRATION_FIXTURES)
def test_fixture_is_generated_from_a_seed_and_recorded_from_pdfjs(name):
    assert name in COMMITTED_FIXTURES
    assert recorded(name)["engine"] == f"pdfjs {PDFJS_VERSION}"
    assert f"{name}.items.json" in {entry["path"] for entry in manifest()["recorded"]}
    assert f"{name}.pdf" in {entry["path"] for entry in manifest()["fixture"]}


@pytest.mark.parametrize("name", sorted(set(COMMITTED_FIXTURES) - {"F-NOTABLE"}))
def test_every_amount_column_prints_enough_values_to_calibrate(name):
    rows = expected(name)["rows"]
    for field in AMOUNT_FIELDS:
        assert sum(row[field] is not None for row in rows) >= 2, field


def test_basic_rows_all_fit_on_a_single_line():
    rows = expected("F-BASIC")["rows"]
    assert rows
    assert all(len(wrap_details(row["details"])) == 1 for row in rows)


def test_multiline_rows_mostly_wrap():
    rows = expected("F-MULTILINE")["rows"]
    wrapped = [row for row in rows if len(wrap_details(row["details"])) > 1]
    assert len(wrapped) > len(rows) / 2


def test_multipage_repeats_the_header_row_on_every_page():
    pages = recorded("F-MULTIPAGE")["pages"]
    assert len(pages) >= MINIMUM_PAGES
    for page in pages:
        texts = {text_item["text"] for text_item in page["items"]}
        assert set(HEADER_LABELS) <= texts


def test_multipage_has_rows_on_every_page():
    pages_with_rows = {row["page"] for row in expected("F-MULTIPAGE")["rows"]}
    assert pages_with_rows == {page["page_number"] for page in recorded("F-MULTIPAGE")["pages"]}


def test_notable_is_a_valid_pdf_with_text_and_no_anchor():
    content = (FIXTURES / "F-NOTABLE.pdf").read_bytes()
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        assert pdf.pages[0].extract_words()
    texts = [
        text_item["text"] for page in recorded("F-NOTABLE")["pages"] for text_item in page["items"]
    ]
    assert texts
    assert not any(FAKE_RECEIPT.fullmatch(text) for text in texts)
    assert expected("F-NOTABLE")["row_count"] == 0


def test_jitter_moves_columns_by_more_than_ordinary_noise_and_stays_on_the_line():
    status_items = items_with_text("F-JITTER", "Completed")
    lefts = [text_item["x0"] for text_item in status_items]
    assert PLANTED_JITTER_POINTS < max(lefts) - min(lefts)
    assert max(lefts) - min(lefts) <= 2 * PLANTED_JITTER_POINTS + ROUNDING_POINTS
    tops = [text_item["top"] for text_item in status_items]
    gaps = {round(lower - upper, 2) for upper, lower in zip(tops, tops[1:], strict=False)}
    assert len(gaps) > 2


def test_jitter_never_pushes_a_row_past_the_line_tolerance():
    page = recorded("F-JITTER")["pages"][0]
    receipts = [
        text_item for text_item in page["items"] if FAKE_RECEIPT.fullmatch(text_item["text"])
    ]
    statuses = [text_item for text_item in page["items"] if text_item["text"] == "Completed"]
    for receipt, status in zip(receipts, statuses, strict=True):
        assert abs(receipt["top"] - status["top"]) <= SAME_LINE_POINTS


def test_continuation_lines_print_above_the_anchor():
    fixture = expected("F-CONT-ABOVE")
    wrapped = [row for row in fixture["rows"] if len(wrap_details(row["details"])) > 1]
    assert wrapped
    page_items = recorded("F-CONT-ABOVE")["pages"]
    for row in wrapped:
        fragments = wrap_details(row["details"])
        items = page_items[row["page"] - 1]["items"]
        receipt_tops = [
            text_item["top"] for text_item in items if text_item["text"] == row["receipt_no"]
        ]
        first_tops = [text_item["top"] for text_item in items if text_item["text"] == fragments[0]]
        drop = WRAP_PITCH * (len(fragments) - 1)
        assert any(
            abs(receipt_top - first_top - drop) <= ROUNDING_POINTS
            for receipt_top in receipt_tops
            for first_top in first_tops
        )


def test_summary_mismatch_is_deliberately_wrong_for_named_labels_only():
    reconciliation = expected("F-SUMMARY-MISMATCH")["summary_reconciliation"]
    assert set(reconciliation) == SUMMARY_LABELS
    assert {label for label, agrees in reconciliation.items() if not agrees} == set(
        WRONG_SUMMARY_LABELS
    )
    assert WRONG_SUMMARY_LABELS


@pytest.mark.parametrize("name", ["F-GOLDEN", "F-CHAIN-BREAK", "F-MULTIPAGE"])
def test_ordinary_summaries_reconcile_on_every_label(name):
    reconciliation = expected(name)["summary_reconciliation"]
    assert set(reconciliation) == SUMMARY_LABELS
    assert all(reconciliation.values())


def test_chain_break_has_the_planted_number_of_breaks():
    fixture = expected("F-CHAIN-BREAK")
    assert CHAIN_BREAK_COUNT > 0
    assert fixture["chain_breaks"] == CHAIN_BREAK_COUNT
    assert sum(fixture["chain_break_kinds"].values()) == CHAIN_BREAK_COUNT


def test_chain_break_includes_a_parent_and_fee_break():
    assert expected("F-CHAIN-BREAK")["chain_break_kinds"]["same_receipt"] >= 1


@pytest.mark.parametrize("name", ["F-GOLDEN", "F-BASIC", "F-MULTIPAGE"])
def test_other_fixtures_have_no_chain_breaks(name):
    fixture = expected(name)
    assert fixture["chain_breaks"] == 0
    assert sum(fixture["chain_break_kinds"].values()) == 0


def test_ties_fixture_holds_money_in_pairs_so_its_columns_calibrate():
    rows = expected("F-TIES")["rows"]
    assert sum(row["paid_in"] is not None for row in rows) >= 2
