from datetime import date

from analysis_rows import PERIOD_DATES, record, row

from mpesa_core.analysis import analyze_transactions
from mpesa_core.analysis.investments import (
    calculate_investment_frequency,
    calculate_monthly_investment,
    calculate_total_investment,
    summarize_investments_by_platform,
)
from mpesa_core.analysis.spending import calculate_bill_spending

START, END = PERIOD_DATES


def investments():
    return [
        record(9, 100.0, "Example Fund"),
        record(10, 200.0, "Example Fund"),
        record(15, 300.0, "Example Saver"),
        record(20, 400.0, "Example Fund"),
        record(21, 500.0, "Example Fund"),
    ]


def test_calculates_investment_frequency():
    frequency = calculate_investment_frequency(investments(), date(2026, 1, 1), date(2026, 1, 31))
    assert frequency["investment_transactions"] == 5
    assert frequency["frequency"] == 5


def test_investment_frequency_excludes_transactions_outside_period():
    assert calculate_investment_frequency(investments(), START, END)["frequency"] == 3


def test_investment_frequency_includes_period_boundaries():
    dates = calculate_investment_frequency(investments(), START, END)["dates"]
    assert dates[0] == START and dates[-1] == END


def test_investment_frequency_returns_zero_when_no_investments_exist():
    frequency = calculate_investment_frequency([], START, END)
    assert frequency == {"investment_transactions": 0, "dates": [], "frequency": 0}


def test_calculates_monthly_investment_amount():
    assert calculate_monthly_investment([record(5, 250.0, "Example Fund")]) == [
        {"month": "2026-01", "investment_amount": 250.0}
    ]


def test_monthly_investment_groups_multiple_investments_in_same_month():
    assert calculate_monthly_investment(investments()) == [
        {"month": "2026-01", "investment_amount": 1500.0}
    ]


def test_monthly_investment_orders_months_chronologically():
    months = calculate_monthly_investment(
        [record(1, 1.0, "Example Fund", month=3), record(1, 1.0, "Example Fund", month=1)]
    )
    assert [entry["month"] for entry in months] == ["2026-01", "2026-03"]


def test_monthly_investment_uses_investment_amount_not_total_cost():
    rows = [row(0, "INVESTMENT", 1000.0, entity="Example Fund", total_cost=13.0)]
    monthly = analyze_transactions(rows)["investments"]["monthly_investment"]
    assert monthly == [{"month": "2026-01", "investment_amount": 1000.0}]


def test_monthly_investment_returns_empty_result_when_no_investments_exist():
    assert calculate_monthly_investment([]) == []


def test_calculate_total_investment_sums_inclusive_period_transactions():
    total = calculate_total_investment(investments(), START, END)
    assert total == {"period": {"start": START, "end": END}, "investment_amount": 900.0}


def test_summarize_investments_by_platform_groups_and_excludes_out_of_period_transactions():
    assert summarize_investments_by_platform(investments(), START, END) == [
        {"platform": "Example Fund", "amount_invested": 600.0},
        {"platform": "Example Saver", "amount_invested": 300.0},
    ]


def bills():
    return [
        record(9, 50.0, "Example Power"),
        record(10, 100.0, "Example Power"),
        record(15, 80.0, "Example Water"),
        record(20, 120.0, "Example Power"),
        record(21, 70.0, "Example Water"),
    ]


def test_calculates_bill_spending_by_entity():
    spending = calculate_bill_spending(bills(), date(2026, 1, 1), date(2026, 1, 31))
    assert {entry["bill"]: entry["amount"] for entry in spending} == {
        "Example Power": 270.0,
        "Example Water": 150.0,
    }


def test_excludes_bill_payments_outside_period():
    spending = calculate_bill_spending(bills(), START, END)
    assert {entry["bill"]: entry["amount"] for entry in spending} == {
        "Example Power": 220.0,
        "Example Water": 80.0,
    }


def test_period_boundaries_are_inclusive_for_bill_spending():
    spending = calculate_bill_spending(bills(), date(2026, 1, 9), date(2026, 1, 9))
    assert spending == [
        {
            "bill": "Example Power",
            "amount": 50.0,
            "period": {"start": date(2026, 1, 9), "end": date(2026, 1, 9)},
        }
    ]


def test_uses_bill_amount_not_total_cost():
    spending = calculate_bill_spending(
        [record(12, 40.0, "Example Power", total_cost=999.0)], START, END
    )
    assert spending[0]["amount"] == 40.0


def test_returns_empty_result_when_no_bill_payments_exist():
    assert calculate_bill_spending([], START, END) == []


def test_returns_empty_result_when_no_bill_payments_fall_within_period():
    assert calculate_bill_spending(bills(), date(2026, 3, 1), date(2026, 3, 31)) == []


def test_bill_entities_are_aggregated_independently():
    spending = calculate_bill_spending(bills(), START, END)
    assert [entry["bill"] for entry in spending] == ["Example Power", "Example Water"]
