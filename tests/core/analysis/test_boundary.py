import importlib.util

from analysis_rows import F_RECORDS, row

from mpesa_core.analysis import analyze_transactions
from mpesa_core.classification.classify import classify_transactions
from mpesa_core.classification.taxonomy import CashFlowDirection, FinancialEvent

REPORT_SECTIONS = ["cash_flow", "spending", "bills", "investments", "transfers", "fees"]


def test_cash_flow_totals_are_correct_with_pyarrow_absent():
    # D-01: the old comparison against an enum member silently gave 0.0 without pyarrow.
    assert importlib.util.find_spec("pyarrow") is None
    cash_flow = analyze_transactions(F_RECORDS)["cash_flow"]
    assert cash_flow["total_inflow"] == 5000.0
    assert cash_flow["total_outflow"] == 4092.0
    assert cash_flow["net_cash_flow"] == 908.0


def test_rows_holding_enum_members_give_the_same_report_as_plain_text():
    with_members = [
        {
            **source,
            "event_type": FinancialEvent(source["event_type"]),
            "cash_flow_direction": CashFlowDirection(source["cash_flow_direction"]),
        }
        for source in F_RECORDS
    ]
    assert analyze_transactions(with_members) == analyze_transactions(F_RECORDS)


def test_classified_rows_from_the_classifier_reach_cash_flow():
    canonical = [
        {
            "receipt_no": "ZZ" + "BND00001",
            "completion_time": "2026-01-05 10:00:00",
            "details": "Funds received from 2547" + "*****" + "012 Example Person 12",
            "status": "Completed",
            "paid_in": 250.0,
            "withdrawn": 0.0,
            "paid_out": 0.0,
            "balance": 250.0,
        }
    ]
    classified, _ = classify_transactions(canonical)
    assert analyze_transactions(classified)["cash_flow"]["total_inflow"] == 250.0


def test_missing_purchase_date_does_not_stop_the_report():
    # A-4: the old report raised on a purchase without a readable time.
    rows = [
        row(0, "MERCHANT_PAYMENT", 100.0, entity="Example Cafe"),
        row(1, "MERCHANT_PAYMENT", 300.0, when="not a time", entity="Example Shop"),
    ]
    largest = analyze_transactions(rows)["spending"]["largest_purchases"]
    assert largest[0]["date"] is None
    assert largest[0]["amount"] == 300.0
    assert largest[1]["date"] == "2026-01-05 10:00:00"


def test_every_class_enters_the_frame_as_plain_text():
    from mpesa_core.analysis.frame import CLASS_FIELDS, prepared_frame

    members = [
        {**source, "event_type": FinancialEvent(source["event_type"])} for source in F_RECORDS
    ]
    frame = prepared_frame(members)
    for field in CLASS_FIELDS:
        assert {type(value) for value in frame[field]} == {str}


def test_empty_input_gives_zero_totals():
    # A-5: the old code raised a missing-column error with no rows.
    report = analyze_transactions([])
    assert list(report) == REPORT_SECTIONS
    assert report["cash_flow"] == {
        "total_inflow": 0.0,
        "total_outflow": 0.0,
        "net_cash_flow": 0.0,
        "closing_balance": 0.0,
    }
    assert report["spending"]["largest_purchases"] == []
    assert report["transfers"]["total_transfers"]["total_transfer_amount"] == 0
    assert report["fees"]["total_fees"]["total_fees"] == 0


def test_report_sections_and_keys_are_exactly_the_old_ones():
    report = analyze_transactions(F_RECORDS)
    assert list(report) == REPORT_SECTIONS
    assert list(report["cash_flow"]) == [
        "total_inflow",
        "total_outflow",
        "net_cash_flow",
        "closing_balance",
    ]
    assert list(report["spending"]) == [
        "monthly_expenditure",
        "top_recipients",
        "largest_purchases",
        "spending_by_entity",
        "merchant_usage_frequency",
        "recurring_purchases",
    ]
    assert list(report["bills"]) == ["recurring_bills", "bill_spending"]
    assert list(report["investments"]) == [
        "total_investment",
        "by_platform",
        "frequency",
        "monthly_investment",
    ]
    assert list(report["transfers"]) == [
        "total_transfers",
        "total_received",
        "by_recipient_count",
        "monthly_transfer_amounts",
        "largest_transfers",
    ]
    assert list(report["fees"]) == ["total_fees", "mpesa_fees", "transfer_charges"]


def test_report_is_plain_json_values():
    import json

    report = analyze_transactions(F_RECORDS)
    assert json.loads(json.dumps(report)) == report


def test_input_rows_are_not_changed():
    import copy

    before = copy.deepcopy(F_RECORDS)
    analyze_transactions(F_RECORDS)
    assert F_RECORDS == before
