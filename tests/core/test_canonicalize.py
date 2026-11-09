import copy

import pytest
from malformed_rows import F_MALFORMED, HEADER_RECEIPT, complete_row, fake_receipt

from mpesa_core.cleaning.canonicalize import canonicalize_rows

CANONICAL_FIELDS = {
    "receipt_no",
    "completion_time",
    "details",
    "status",
    "paid_in",
    "withdrawn",
    "paid_out",
    "balance",
}
AMOUNT_FIELDS = ("paid_in", "withdrawn", "paid_out", "balance")


def malformed_rows():
    return [row for row, _ in F_MALFORMED]


def test_parser_handles_malformed_and_empty_rows():
    canonical = canonicalize_rows(malformed_rows())
    kept = [row["receipt_no"] for row, keep in F_MALFORMED if keep]
    assert [row["receipt_no"] for row in canonical] == kept
    by_receipt = {row["receipt_no"]: row for row in canonical}
    garbage = by_receipt[fake_receipt(6)]
    assert (garbage["paid_in"], garbage["withdrawn"], garbage["balance"]) == (0.0, 0.0, 0.0)
    not_a_number = by_receipt[fake_receipt(7)]
    assert (not_a_number["paid_in"], not_a_number["withdrawn"]) == (0.0, 0.0)
    assert not_a_number["balance"] == 1000.0
    for row in canonical:
        for field in AMOUNT_FIELDS:
            assert isinstance(row[field], float)


def test_cleaning_represents_missing_details_as_empty_and_keeps_the_row():
    canonical = canonicalize_rows([complete_row(1, details=None), complete_row(2, details="")])
    assert [row["details"] for row in canonical] == ["", ""]


def test_row_without_details_is_imported_as_an_unclassified_transaction():
    (row,) = canonicalize_rows([complete_row(1, details=None)])
    assert CANONICAL_FIELDS <= set(row)
    assert row["details"] == ""
    assert row["receipt_no"] == fake_receipt(1)
    assert row["withdrawn"] == 5.0


@pytest.mark.parametrize("status", ["Completed", "Failed", "Reversed", " Completed ", "", None])
def test_status_is_preserved(status):
    (row,) = canonicalize_rows([complete_row(1, status=status)])
    assert row["status"] == status


def test_empty_input_gives_no_rows():
    assert canonicalize_rows([]) == []


def test_every_row_carries_the_canonical_fields():
    for row in canonicalize_rows(malformed_rows()):
        assert CANONICAL_FIELDS <= set(row)


def test_amounts_are_parsed_from_printed_text():
    (row,) = canonicalize_rows(
        [complete_row(1, paid_in="1,234.50", withdrawn="-50.00", balance="KSh 2,000.00")]
    )
    assert (row["paid_in"], row["withdrawn"], row["balance"]) == (1234.5, -50.0, 2000.0)


def test_paid_out_is_withdrawn_under_the_name_the_classifier_reads():
    (row,) = canonicalize_rows([complete_row(1, withdrawn="-50.00")])
    assert row["paid_out"] == row["withdrawn"] == -50.0


def test_details_are_normalized():
    (row,) = canonicalize_rows([complete_row(1, details="Example | Shop\nWrapped")])
    assert row["details"] == "Example Shop Wrapped"


def test_receipt_and_completion_time_stay_as_printed():
    receipt = f" {fake_receipt(1)} "
    (row,) = canonicalize_rows([complete_row(1, receipt_no=receipt, completion_time=" 2026 ")])
    assert row["receipt_no"] == receipt
    assert row["completion_time"] == " 2026 "


def test_header_receipt_is_matched_exactly_as_before():
    padded = f" {HEADER_RECEIPT}"
    canonical = canonicalize_rows([complete_row(1, receipt_no=padded)])
    assert [row["receipt_no"] for row in canonical] == [padded]


def test_print_order_is_preserved():
    rows = [complete_row(position) for position in (5, 1, 9, 3)]
    assert [row["receipt_no"] for row in canonicalize_rows(rows)] == [
        fake_receipt(position) for position in (5, 1, 9, 3)
    ]


def test_other_fields_pass_through_unchanged():
    (row,) = canonicalize_rows([complete_row(7)])
    assert (row["page"], row["line"]) == (1, 7)


def test_input_rows_are_not_changed():
    rows = malformed_rows()
    before = copy.deepcopy(rows)
    canonicalize_rows(rows)
    assert rows == before


def test_output_rows_are_new_objects():
    rows = [complete_row(1)]
    (row,) = canonicalize_rows(rows)
    assert row is not rows[0]
