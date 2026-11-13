from analysis_rows import F_RECORDS, PAY_BILL_CHARGE, TRANSFER_CHARGE, fake_receipt, row

from mpesa_core.analysis import analyze_transactions
from mpesa_core.analysis.cash_flow import calculate_total_inflow
from mpesa_core.analysis.fees import calculate_total_fees
from mpesa_core.analysis.frame import prepared_frame, resolve_period
from mpesa_core.analysis.spending import calculate_monthly_expenditure

CALCULATION_COUNT = 24


def with_fees():
    return [
        row(0, "TRANSFER_OUT", 700.0, entity="Example Person 34", total_cost=713.0),
        row(1, "FEE", 13.0, details=TRANSFER_CHARGE, total_cost=0.0, receipt_no=fake_receipt(0)),
        row(2, "BILL_PAYMENT", 400.0, entity="Example Power", total_cost=425.0),
        row(3, "FEE", 25.0, details=PAY_BILL_CHARGE, total_cost=0.0, receipt_no=fake_receipt(2)),
    ]


def test_orchestrator_builds_expected_public_result_shape():
    report = analyze_transactions(F_RECORDS)
    assert report["cash_flow"]["closing_balance"] == 1000.0
    assert report["spending"]["largest_purchases"][0] == {
        "transaction": fake_receipt(4),
        "recipient": "Example Power",
        "amount": 1200.0,
        "date": "2026-01-06 10:00:00",
        "ranking": 1,
    }
    assert report["investments"]["total_investment"] == {
        "period": {"start": "2026-01-01", "end": "2026-02-01"},
        "investment_amount": 1000.0,
    }
    assert report["fees"]["total_fees"]["period"] == {"start": "2026-01-01", "end": "2026-02-01"}
    assert report["investments"]["frequency"]["dates"] == ["2026-01-08"]


def test_orchestrator_excludes_heavy_hitters_and_keeps_calc_count():
    # Read from the old test's name alone: no heavy-hitters figure, and a fixed number of figures.
    report = analyze_transactions(F_RECORDS)
    assert "heavy_hitters" not in {key for section in report.values() for key in section}
    assert sum(len(section) for section in report.values()) == CALCULATION_COUNT


def test_orchestrator_calls_existing_calculations_without_recalculation():
    frame = prepared_frame(F_RECORDS)
    report = analyze_transactions(F_RECORDS)
    assert report["cash_flow"]["total_inflow"] == calculate_total_inflow(frame)
    assert report["spending"]["monthly_expenditure"] == calculate_monthly_expenditure(
        frame
    ).to_dict(orient="records")
    period = resolve_period(frame)
    assert (
        report["fees"]["total_fees"]["total_fees"]
        == calculate_total_fees(frame, *period)["total_fees"]
    )


def test_transfer_charges_and_total_fees_are_included():
    fees = analyze_transactions(with_fees())["fees"]
    assert fees["total_fees"]["total_fees"] == 38.0
    assert fees["mpesa_fees"]["fee_amount"] == 38.0
    assert fees["transfer_charges"]["transfer_charge_amount"] == 13.0


def test_orchestrator_reports_transfer_amount_excluding_attributable_fee():
    transfers = analyze_transactions(with_fees())["transfers"]
    assert transfers["total_transfers"]["total_transfer_amount"] == 700.0
    assert transfers["largest_transfers"][0]["amount"] == 700.0


def test_orchestrator_keeps_fee_paid_economic_cost_and_transfer_amount_distinct():
    report = analyze_transactions(with_fees())
    assert report["fees"]["total_fees"]["total_fees"] == 38.0
    assert report["bills"]["bill_spending"][0]["amount"] == 425.0
    assert report["spending"]["spending_by_entity"] == [
        {"entity": "Example Power", "amount": 425.0}
    ]
    assert report["transfers"]["total_transfers"]["total_transfer_amount"] == 700.0


def test_unclassified_rows_reach_cash_flow_and_nothing_else():
    rows = [row(0, "UNCLASSIFIED", 80.0, entity="Example Unknown")]
    report = analyze_transactions(rows)
    assert report["cash_flow"]["total_outflow"] == 80.0
    assert report["spending"]["spending_by_entity"] == []
    assert report["transfers"]["largest_transfers"] == []
    assert report["fees"]["total_fees"]["total_fees"] == 0


def test_rows_without_an_entity_appear_under_the_old_marker_where_the_old_report_kept_them():
    rows = [row(0, "TRANSFER_OUT", 50.0, entity=None)]
    transfers = analyze_transactions(rows)["transfers"]
    assert transfers["by_recipient_count"][0]["recipient"] == "NO_ENTITY_IDENTIFIED"


def test_a_period_limits_the_period_analyses():
    from datetime import datetime

    period = (datetime(2026, 1, 7), datetime(2026, 1, 7, 23, 59, 59))
    report = analyze_transactions(F_RECORDS, period=period)
    assert report["transfers"]["total_transfers"]["total_transfer_amount"] == 700.0
    assert report["investments"]["total_investment"]["investment_amount"] == 0
    assert report["fees"]["total_fees"]["period"] == {"start": "2026-01-07", "end": "2026-01-07"}
