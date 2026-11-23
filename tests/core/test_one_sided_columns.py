"""Amount columns printed once or never (CP10a item 1, behaviour change D-10).

A money column seen once is accepted only if it sits further than the cluster tolerance from
every other calibrated column and the header labels place it where it stands. A statement with
no paid-in rows, or no withdrawn rows, is valid: the header row's label spacing says which column
the money column printed is, and places the missing one where no amount prints. A stray item, or
a statement whose money columns are both empty, is still refused. Invented values only.
"""

import pytest

from mpesa_core.errors import ErrorCode, ExtractionError
from mpesa_core.extraction.columns import calibrate_columns
from mpesa_core.extraction.rows import build_rows

HEADER_TOP = 80.0


def with_header(printed, items):
    """A one-page statement: the header row above the given rows."""
    return printed.statement_of(printed.page_of([*printed.header_items(HEADER_TOP), *items]))


def rows_printing(printed, cells_by_row):
    """One anchor row per cells map, ten points apart."""
    items = []
    for position, cells in enumerate(cells_by_row):
        items += printed.row_items(
            position, printed.FIRST_ROW_TOP + position * printed.ROW_POINTS, cells=cells
        )
    return items


def amounts(statement_pages):
    """Each row's paid in, withdrawn and balance, as read."""
    rows = build_rows(statement_pages)
    return [(row["paid_in"], row["withdrawn"], row["balance"]) for row in rows]


def assert_refused(statement_pages, code):
    with pytest.raises(ExtractionError) as caught:
        calibrate_columns(statement_pages)
    assert caught.value.code is code


WITHDRAWN_ONLY = [
    {"paid_in": None, "withdrawn": f"{index + 5}.00", "balance": f"{100 - index}.00"}
    for index in range(4)
]
PAID_IN_ONLY = [
    {"paid_in": f"{index + 5}.00", "withdrawn": None, "balance": f"{100 + index}.00"}
    for index in range(4)
]


def test_a_statement_with_no_paid_in_rows_calibrates_and_reads_every_amount(printed):
    statement = with_header(printed, rows_printing(printed, WITHDRAWN_ONLY))
    layout = calibrate_columns(statement)
    assert layout.withdrawn == pytest.approx(printed.WITHDRAWN_X1)
    assert layout.balance == pytest.approx(printed.BALANCE_X1)
    assert amounts(statement) == [
        (None, cells["withdrawn"], cells["balance"]) for cells in WITHDRAWN_ONLY
    ]


def test_a_statement_with_no_withdrawn_rows_calibrates_and_reads_every_amount(printed):
    statement = with_header(printed, rows_printing(printed, PAID_IN_ONLY))
    layout = calibrate_columns(statement)
    assert layout.paid_in == pytest.approx(printed.PAID_IN_X1)
    assert amounts(statement) == [
        (cells["paid_in"], None, cells["balance"]) for cells in PAID_IN_ONLY
    ]


def test_one_paid_in_row_calibrates_its_column(printed):
    cells_by_row = [*WITHDRAWN_ONLY, {"paid_in": "40.00", "withdrawn": None, "balance": "137.00"}]
    statement = with_header(printed, rows_printing(printed, cells_by_row))
    assert calibrate_columns(statement).paid_in == pytest.approx(printed.PAID_IN_X1)
    assert amounts(statement)[-1] == ("40.00", None, "137.00")


def test_one_withdrawn_row_calibrates_its_column(printed):
    cells_by_row = [*PAID_IN_ONLY, {"paid_in": None, "withdrawn": "12.00", "balance": "91.00"}]
    statement = with_header(printed, rows_printing(printed, cells_by_row))
    assert calibrate_columns(statement).withdrawn == pytest.approx(printed.WITHDRAWN_X1)
    assert amounts(statement)[-1] == (None, "12.00", "91.00")


def test_a_stray_number_between_the_columns_is_not_taken_for_the_missing_column(printed):
    items = rows_printing(printed, WITHDRAWN_ONLY)
    items.append(printed.right_item("7.00", 440.0, printed.FIRST_ROW_TOP))
    assert_refused(with_header(printed, items), ErrorCode.LAYOUT_UNRECOGNIZED)


def test_a_stray_number_beside_three_full_columns_is_left_out_not_taken_for_a_column(printed):
    items = printed.calibrating_rows(count=4)
    items.append(printed.right_item("7.00", 440.0, printed.FIRST_ROW_TOP))
    layout = calibrate_columns(with_header(printed, items))
    assert (layout.paid_in, layout.withdrawn, layout.balance) == pytest.approx(
        (printed.PAID_IN_X1, printed.WITHDRAWN_X1, printed.BALANCE_X1)
    )


def test_a_column_seen_once_where_the_header_places_a_column_already_taken_is_refused(printed):
    cells_by_row = [*WITHDRAWN_ONLY, {"paid_in": None, "withdrawn": None, "balance": "137.00"}]
    items = rows_printing(printed, cells_by_row)
    # A lone value 1.8 points right of the withdrawn column: the header places it on withdrawn.
    items.append(
        printed.right_item(
            "40.00",
            printed.WITHDRAWN_X1 + 0.8 + 1.0,
            printed.FIRST_ROW_TOP + 4 * printed.ROW_POINTS,
        )
    )
    assert_refused(with_header(printed, items), ErrorCode.LAYOUT_UNRECOGNIZED)


def test_both_money_columns_empty_is_refused(printed):
    balance_only = [
        {"paid_in": None, "withdrawn": None, "balance": f"{100 + index}.00"} for index in range(4)
    ]
    assert_refused(
        with_header(printed, rows_printing(printed, balance_only)), ErrorCode.TOO_FEW_AMOUNTS
    )


def test_without_a_header_row_a_missing_column_cannot_be_placed(printed):
    assert_refused(
        printed.statement_of(printed.page_of(rows_printing(printed, WITHDRAWN_ONLY))),
        ErrorCode.TOO_FEW_AMOUNTS,
    )


def test_three_full_columns_calibrate_exactly_as_before(printed):
    statement = with_header(printed, printed.calibrating_rows(count=4))
    layout = calibrate_columns(statement)
    assert (layout.paid_in, layout.withdrawn, layout.balance) == pytest.approx(
        (printed.PAID_IN_X1, printed.WITHDRAWN_X1, printed.BALANCE_X1)
    )
