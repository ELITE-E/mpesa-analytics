"""The page 1 summary block (CP7a-3): seven type rows and a TOTAL row, between two marker lines.

Each row prints as ``LABEL: paid_in paid_out``. A row that is missing or cannot be read is
counted, never guessed. Only TOTAL is checked against the rows; the type rows are not used to
check row types (v1.1).
"""

import pytest

from mpesa_core.reconciliation.reconcile import reconcile
from mpesa_core.reconciliation.summary import (
    DETAIL_MARKER,
    SUMMARY_MARKER,
    TOTAL_LABEL,
    TYPE_LABELS,
    read_summary_block,
    summary_block_lines,
)

IDENTITY = (
    ("Customer Name:", "Example Person 00"),
    ("Mobile Number:", "07000000" + "00"),
    ("Email Address:", "example.person@example.invalid"),
)
TYPE_ROWS = (
    ("SEND MONEY:", "0.00", "120.00"),
    ("RECEIVED MONEY:", "1,000.00", "0.00"),
    ("AGENT DEPOSIT:", "0.00", "0.00"),
    ("AGENT WITHDRAWAL:", "0.00", "0.00"),
    ("LIPA NA M-PESA (PAYBILL):", "0.00", "0.00"),
    ("LIPA NA M-PESA (BUY GOODS):", "0.00", "0.00"),
    ("OTHERS:", "0.00", "5.00"),
)
TOTAL_ROW = ("TOTAL:", "1,000.00", "125.00")
VALUE_X0S = (70.0, 180.0, 260.0, 340.0)


def row(balance, *, paid_in=None, withdrawn=None, time="2026-01-05 10:00:00", position=0):
    return {
        "receipt_no": f"ZZ{position:08d}",
        "completion_time": time,
        "details": "Some details",
        "status": "Completed",
        "paid_in": paid_in,
        "withdrawn": withdrawn,
        "balance": balance,
        "page": 1,
        "line": position,
    }


def newest_first_rows():
    return [
        row("875.00", withdrawn="5.00", time="2026-01-03 09:00:00", position=1),
        row("880.00", withdrawn="120.00", time="2026-01-02 09:00:00", position=2),
        row("1,000.00", paid_in="1,000.00", time="2026-01-01 08:00:00", position=3),
    ]


def printed_lines(printed, lines, first_top=20.0):
    items = []
    for position, cells in enumerate(lines):
        top = first_top + 8.0 * position
        items += [
            printed.left_item(text, x0, top) for text, x0 in zip(cells, VALUE_X0S, strict=False)
        ]
    return items


def block(type_rows=TYPE_ROWS, total=TOTAL_ROW, *, start=(SUMMARY_MARKER,), end=(DETAIL_MARKER,)):
    lines = [*IDENTITY]
    lines += [start] if start else []
    lines += [*type_rows]
    lines += [total] if total else []
    lines += [end] if end else []
    return lines


def pages_with(printed, lines):
    return printed.statement_of(printed.page_of(printed_lines(printed, lines)))


def test_the_block_runs_from_the_summary_marker_up_to_the_detail_marker(printed):
    texts = summary_block_lines(pages_with(printed, block()))
    assert texts[0] == SUMMARY_MARKER
    assert len(texts) == 1 + len(TYPE_ROWS) + 1
    assert texts[-1] == "TOTAL: 1,000.00 125.00"
    assert DETAIL_MARKER not in texts


def test_nothing_before_the_summary_marker_is_in_the_block(printed):
    texts = summary_block_lines(pages_with(printed, block()))
    joined = "\n".join(texts)
    for word in ("@", "Customer", "Mobile", "Email", "Name", "Example Person"):
        assert word not in joined


@pytest.mark.parametrize("missing", ["start", "end"])
def test_a_missing_marker_gives_no_block(printed, missing):
    lines = block(**{missing: None})
    assert summary_block_lines(pages_with(printed, lines)) is None


def test_markers_must_be_the_whole_line(printed):
    lines = block(start=("SUMMARY", "Example Person 00"))
    assert summary_block_lines(pages_with(printed, lines)) is None


def test_the_block_is_read_from_page_one_only(printed):
    later = printed.page_of(printed_lines(printed, block()), number=2)
    statement = printed.statement_of(printed.page_of([]), later)
    assert summary_block_lines(statement) is None
    assert summary_block_lines(printed.statement_of()) is None


def test_the_total_and_all_seven_type_rows_are_read(printed):
    summary = read_summary_block(pages_with(printed, block()))
    assert summary == {"total_paid_in": 1000.0, "total_paid_out": 125.0, "type_rows_parsed": 7}


def test_the_labels_are_the_real_ones():
    assert TYPE_LABELS == (
        "SEND MONEY",
        "RECEIVED MONEY",
        "AGENT DEPOSIT",
        "AGENT WITHDRAWAL",
        "LIPA NA M-PESA (PAYBILL)",
        "LIPA NA M-PESA (BUY GOODS)",
        "OTHERS",
    )
    assert TOTAL_LABEL == "TOTAL"


def test_a_missing_type_row_is_counted_not_guessed(printed):
    summary = read_summary_block(pages_with(printed, block(TYPE_ROWS[1:])))
    assert summary["type_rows_parsed"] == 6


@pytest.mark.parametrize(
    "broken",
    [
        ("SEND MONEY:", "0.00"),
        ("SEND MONEY:", "0.00", "not an amount"),
        ("SEND MONEY:", "0.00", "1.00", "2.00"),
        ("SEND MONEYS:", "0.00", "1.00"),
    ],
)
def test_a_type_row_that_cannot_be_read_is_not_counted(printed, broken):
    summary = read_summary_block(pages_with(printed, block((broken, *TYPE_ROWS[1:]))))
    assert summary["type_rows_parsed"] == 6


def test_a_type_row_is_read_without_its_colon_and_in_any_case(printed):
    rows = (("send money", "0.00", "120.00"), *TYPE_ROWS[1:])
    assert read_summary_block(pages_with(printed, block(rows)))["type_rows_parsed"] == 7


def test_a_missing_total_reads_as_none(printed):
    summary = read_summary_block(pages_with(printed, block(total=None)))
    assert summary["total_paid_in"] is None
    assert summary["total_paid_out"] is None
    assert summary["type_rows_parsed"] == 7


def test_an_unreadable_total_reads_as_none(printed):
    summary = read_summary_block(pages_with(printed, block(total=("TOTAL:", "1,000.00", "?"))))
    assert summary["total_paid_in"] is None


def test_rows_outside_the_block_are_not_read(printed):
    lines = [*IDENTITY, TOTAL_ROW, *TYPE_ROWS, (SUMMARY_MARKER,), (DETAIL_MARKER,)]
    summary = read_summary_block(pages_with(printed, lines))
    assert summary == {"total_paid_in": None, "total_paid_out": None, "type_rows_parsed": 0}


def test_without_markers_nothing_is_read(printed):
    summary = read_summary_block(pages_with(printed, block(start=None)))
    assert summary == {"total_paid_in": None, "total_paid_out": None, "type_rows_parsed": 0}


def test_quality_says_the_totals_match_to_half_a_cent(printed):
    quality = reconcile(pages_with(printed, block()), newest_first_rows())
    assert quality["summary_total_paid_in_matches"] is True
    assert quality["summary_total_paid_out_matches"] is True
    assert quality["summary_type_rows_parsed"] == 7


@pytest.mark.parametrize(
    ("total", "paid_in", "paid_out"),
    [
        (("TOTAL:", "1,000.004", "125.00"), True, True),
        (("TOTAL:", "1,000.01", "125.00"), False, True),
        (("TOTAL:", "1,000.00", "125.50"), True, False),
    ],
)
def test_quality_says_which_total_disagrees(printed, total, paid_in, paid_out):
    quality = reconcile(pages_with(printed, block(total=total)), newest_first_rows())
    assert quality["summary_total_paid_in_matches"] is paid_in
    assert quality["summary_total_paid_out_matches"] is paid_out


def test_negative_withdrawn_counts_as_paid_out(printed):
    rows = newest_first_rows()
    rows[0]["withdrawn"] = "-5.00"
    rows[1]["withdrawn"] = "-120.00"
    quality = reconcile(pages_with(printed, block()), rows)
    assert quality["summary_total_paid_out_matches"] is True


def test_quality_without_a_total_is_unknown(printed):
    quality = reconcile(printed.statement_of(), newest_first_rows())
    assert quality["summary_total_paid_in_matches"] is None
    assert quality["summary_total_paid_out_matches"] is None
    assert quality["summary_type_rows_parsed"] == 0


def test_the_invented_summary_labels_are_gone(printed):
    quality = reconcile(pages_with(printed, block()), newest_first_rows())
    assert "summary_reconciliation" not in quality
