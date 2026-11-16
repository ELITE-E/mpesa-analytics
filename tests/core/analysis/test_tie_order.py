"""Tie order in the analysis: stable sorts with a deterministic tie-breaker (CP8a-3).

pandas' default sort is not stable, and numpy sorts ties differently on x86 (SIMD) and in the
browser (wasm), so a tie's order was undefined. Each test feeds tied rows in the opposite order to
the tie-breaker, so input order cannot pass for it. Runs under CPython and Pyodide.
"""

from analysis_rows import fake_receipt, row

from mpesa_core.analysis.cash_flow import calculate_closing_balance
from mpesa_core.analysis.frame import prepared_frame
from mpesa_core.analysis.spending import calculate_largest_purchases, get_top_spending_recipients

TIED_COUNT = 40


def tied_purchases():
    """Purchases of one amount, newest receipt first, each at its own merchant."""
    return [
        row(position, "MERCHANT_PAYMENT", 100.0, entity=f"Example Shop {position:02d}")
        for position in reversed(range(TIED_COUNT))
    ]


def test_largest_purchases_break_ties_by_receipt_number():
    largest = calculate_largest_purchases(prepared_frame(tied_purchases()), top_n=10)
    receipts = list(largest["transaction"])
    assert receipts == [fake_receipt(position) for position in range(10)]
    assert list(largest["ranking"]) == list(range(1, 11))


def test_largest_purchases_still_put_the_largest_first():
    rows = [*tied_purchases(), row(99, "MERCHANT_PAYMENT", 500.0, entity="Example Shop 99")]
    largest = calculate_largest_purchases(prepared_frame(rows), top_n=3)
    assert list(largest["amount"]) == [500.0, 100.0, 100.0]
    assert list(largest["transaction"]) == [fake_receipt(99), fake_receipt(0), fake_receipt(1)]


def test_top_recipients_break_ties_by_recipient_name():
    top = get_top_spending_recipients(prepared_frame(tied_purchases()), top_n=5)
    assert list(top["recipient"]) == [f"Example Shop {position:02d}" for position in range(5)]
    assert list(top["ranking"]) == [1, 2, 3, 4, 5]


def test_top_recipients_still_rank_by_amount_first():
    rows = [*tied_purchases(), row(99, "MERCHANT_PAYMENT", 30.0, entity="Example Shop 03")]
    top = get_top_spending_recipients(prepared_frame(rows), top_n=2)
    assert list(top["recipient"]) == ["Example Shop 03", "Example Shop 00"]


def test_closing_balance_on_a_tied_latest_time_takes_the_largest_receipt_number():
    latest = "2026-01-09 10:00:00"
    rows = [
        row(7, "TRANSFER_OUT", 10.0, when=latest, balance=70.0, entity="Example Person 12"),
        row(3, "TRANSFER_OUT", 10.0, when=latest, balance=30.0, entity="Example Person 12"),
        row(9, "TRANSFER_OUT", 10.0, when=latest, balance=90.0, entity="Example Person 12"),
        row(1, "TRANSFER_OUT", 10.0, when="2026-01-02 10:00:00", balance=10.0),
    ]
    rows += [
        row(
            20 + position,
            "TRANSFER_OUT",
            1.0,
            when=latest,
            balance=5.0,
            receipt_no="A" + str(position),
        )
        for position in range(TIED_COUNT)
    ]
    assert calculate_closing_balance(prepared_frame(rows)) == 90.0
