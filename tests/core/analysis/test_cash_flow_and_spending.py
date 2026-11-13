import pytest
from analysis_rows import F_RECORDS, row

from mpesa_core.analysis import analyze_transactions
from mpesa_core.analysis.cash_flow import (
    calculate_closing_balance,
    calculate_net_cash_flow,
    calculate_total_inflow,
    calculate_total_outflow,
)
from mpesa_core.analysis.frame import prepared_frame
from mpesa_core.analysis.spending import (
    calculate_largest_purchases,
    calculate_merchant_usage_frequency,
    calculate_monthly_expenditure,
    calculate_spending_by_entity,
    get_top_spending_recipients,
)


def frame():
    return prepared_frame(F_RECORDS)


def test_total_inflow_amount_sums_inflow_transactions():
    assert calculate_total_inflow(frame()) == 5000.0


def test_total_outflow_amount_sums_outflow_transactions():
    assert calculate_total_outflow(frame()) == 4092.0


def test_net_cash_flow_is_inflow_minus_outflow():
    assert calculate_net_cash_flow(frame()) == 5000.0 - 4092.0


def test_calculate_closing_balance_returns_ending_balance():
    rows = [
        row(0, "MERCHANT_PAYMENT", 10.0, when="2026-01-09 10:00:00", balance=500.0),
        row(1, "MERCHANT_PAYMENT", 10.0, when="2026-01-01 10:00:00", balance=900.0),
        row(2, "MERCHANT_PAYMENT", 10.0, when="2026-01-05 10:00:00", balance=700.0),
    ]
    assert calculate_closing_balance(prepared_frame(rows)) == 500.0


def malformed_dates():
    return [
        row(0, "MERCHANT_PAYMENT", 100.0, when="garbage", entity="Example Shop"),
        row(1, "MERCHANT_PAYMENT", 50.0, when="", entity="Example Cafe"),
        row(2, "MERCHANT_PAYMENT", 25.0, when="2026-01-05 10:00:00", entity="Example Shop"),
    ]


def test_analytics_handles_malformed_and_missing_dates():
    monthly = calculate_monthly_expenditure(prepared_frame(malformed_dates()))
    assert monthly.to_dict(orient="records") == [
        {"month": "2026-01", "expenditure": 25.0},
        {"month": "Unknown", "expenditure": 150.0},
    ]


def test_rows_with_unreadable_dates_still_count_in_cash_flow_and_the_report():
    report = analyze_transactions(malformed_dates())
    assert report["cash_flow"]["total_outflow"] == 175.0
    assert [entry["date"] for entry in report["spending"]["largest_purchases"]] == [
        None,
        None,
        "2026-01-05 10:00:00",
    ]


def test_unreadable_date_in_a_date_based_analysis_raises_as_the_old_code_does():
    # A-3, deferred: under the pinned pandas a missing date cannot be compared, so it raises
    # instead of being dropped. Kept until the owner decides with data.
    rows = [
        row(0, "TRANSFER_OUT", 10.0, when="2026-01-05 10:00:00", entity="Example Person 12"),
        row(1, "TRANSFER_OUT", 10.0, when="garbage", entity="Example Person 12"),
    ]
    with pytest.raises(TypeError):
        analyze_transactions(rows)


def test_calculate_spending_by_entity_sums_qualifying_spending_by_entity():
    spending = calculate_spending_by_entity(frame()).to_dict(orient="records")
    assert spending == [
        {"entity": "Example Bundle", "amount": 99.0},
        {"entity": "Example Cafe", "amount": 450.0},
        {"entity": "Example Power", "amount": 1200.0},
        {"entity": "Example Shop", "amount": 500.0},
    ]


def test_calculate_merchant_usage_frequency_ranks_merchants_by_transaction_count():
    frequency = calculate_merchant_usage_frequency(frame()).to_dict(orient="records")
    assert frequency == [
        {"merchant": "Example Shop", "transaction_count": 2, "ranking": 1},
        {"merchant": "Example Cafe", "transaction_count": 1, "ranking": 2},
    ]


def test_calculate_monthly_expenditure_sums_spending_by_month():
    monthly = calculate_monthly_expenditure(frame()).to_dict(orient="records")
    assert monthly == [
        {"month": "2026-01", "expenditure": 2150.0},
        {"month": "2026-02", "expenditure": 99.0},
    ]


def test_ranks_recipients_by_total_qualifying_spending():
    ranked = get_top_spending_recipients(frame(), top_n=3).to_dict(orient="records")
    assert ranked == [
        {"recipient": "Example Power", "amount_received": 1200.0, "ranking": 1},
        {"recipient": "Example Shop", "amount_received": 500.0, "ranking": 2},
        {"recipient": "Example Cafe", "amount_received": 450.0, "ranking": 3},
    ]


def test_calculate_largest_purchases_ranks_qualifying_transactions():
    largest = calculate_largest_purchases(frame(), top_n=2).to_dict(orient="records")
    assert [entry["amount"] for entry in largest] == [1200.0, 450.0]
    assert [entry["recipient"] for entry in largest] == ["Example Power", "Example Cafe"]
    assert [entry["ranking"] for entry in largest] == [1, 2]
