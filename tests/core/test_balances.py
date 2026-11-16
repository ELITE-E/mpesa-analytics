"""D-06: opening and closing balance follow print order, in the orientation reconcile reads."""

import pytest

from mpesa_core.reconciliation.reconcile import NEWEST_FIRST, OLDEST_FIRST, measure_balances


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


# Newest first, the latest time tied between a fee and its parent.
TIED_NEWEST_FIRST = [
    row("875.00", withdrawn="5.00", time="2026-01-03 09:00:00", position=1),
    row("880.00", withdrawn="120.00", time="2026-01-03 09:00:00", position=2),
    row("1,000.00", paid_in="1,000.00", time="2026-01-01 08:00:00", position=3),
]


def test_closing_balance_is_the_first_printed_row_when_newest_first():
    balances = measure_balances(TIED_NEWEST_FIRST, NEWEST_FIRST)
    assert balances["closing_balance"] == 875.0


def test_closing_balance_on_a_tied_latest_time_follows_print_order_not_the_clock():
    swapped = [TIED_NEWEST_FIRST[1], TIED_NEWEST_FIRST[0], TIED_NEWEST_FIRST[2]]
    assert measure_balances(swapped, NEWEST_FIRST)["closing_balance"] == 880.0


def test_closing_balance_is_the_last_printed_row_when_oldest_first():
    oldest_first = list(reversed(TIED_NEWEST_FIRST))
    assert measure_balances(oldest_first, OLDEST_FIRST)["closing_balance"] == 875.0


def test_opening_balance_is_the_balance_before_the_oldest_row():
    balances = measure_balances(TIED_NEWEST_FIRST, NEWEST_FIRST)
    assert balances["opening_balance"] == 0.0


def test_opening_balance_adds_back_what_the_oldest_row_paid_out():
    rows = [row("880.00", withdrawn="120.00", time="2026-01-02 09:00:00")]
    assert measure_balances(rows, NEWEST_FIRST)["opening_balance"] == 1000.0


def test_opening_balance_reads_the_first_printed_row_when_oldest_first():
    oldest_first = list(reversed(TIED_NEWEST_FIRST))
    assert measure_balances(oldest_first, OLDEST_FIRST)["opening_balance"] == 0.0


def test_a_negative_printed_withdrawn_counts_as_a_size():
    rows = [row("880.00", withdrawn="-120.00")]
    assert measure_balances(rows, NEWEST_FIRST)["opening_balance"] == 1000.0


def test_thousands_separators_are_read():
    rows = [row("1,880.00", paid_in="1,000.00")]
    balances = measure_balances(rows, NEWEST_FIRST)
    assert balances == {"opening_balance": 880.0, "closing_balance": 1880.0}


def test_no_rows_gives_no_balances():
    assert measure_balances([], NEWEST_FIRST) == {"opening_balance": None, "closing_balance": None}


@pytest.mark.parametrize("field", ["balance", "paid_in", "withdrawn"])
def test_an_unreadable_amount_gives_no_opening_balance(field):
    rows = [{**row("880.00", withdrawn="120.00"), field: "not an amount"}]
    assert measure_balances(rows, NEWEST_FIRST)["opening_balance"] is None


def test_an_unreadable_newest_balance_gives_no_closing_balance():
    rows = [row("not an amount", withdrawn="120.00"), row("1,000.00", paid_in="1,000.00")]
    assert measure_balances(rows, NEWEST_FIRST)["closing_balance"] is None


def test_balances_hold_numbers_only():
    balances = measure_balances(TIED_NEWEST_FIRST, NEWEST_FIRST)
    assert set(balances) == {"opening_balance", "closing_balance"}
    assert all(type(value) is float for value in balances.values())


def test_an_unknown_orientation_is_rejected_without_repeating_it():
    planted = "ZZ" + "AB12CD34"
    with pytest.raises(ValueError) as caught:
        measure_balances(TIED_NEWEST_FIRST, planted)
    assert planted not in str(caught.value)
