from datetime import date

from analysis_rows import PERIOD_DATES, record, row

from mpesa_core.analysis import analyze_transactions
from mpesa_core.analysis.transfers import (
    calculate_monthly_transfer_amounts,
    calculate_total_received_transfers,
    calculate_total_transfers,
    rank_recipients_by_transfer_count,
    rank_transfers_by_amount,
)

START, END = PERIOD_DATES
JANUARY = (date(2026, 1, 1), date(2026, 1, 31))
MARCH = (date(2026, 3, 1), date(2026, 3, 31))


def transfers():
    return [
        record(9, 100.0, "Example Person 12"),
        record(10, 200.0, "Example Person 12"),
        record(15, 300.0, "Example Person 34"),
        record(20, 200.0, "Example Person 56"),
        record(21, 500.0, "Example Person 12"),
    ]


def sent_with_fee():
    return [row(0, "TRANSFER_OUT", 700.0, entity="Example Person 34", total_cost=713.0)]


def test_calculates_total_transfer_amount_for_period():
    total = calculate_total_transfers(transfers(), *JANUARY)
    assert total == {
        "period": {"start": JANUARY[0], "end": JANUARY[1]},
        "total_transfer_amount": 1300.0,
    }


def test_excludes_transfers_outside_period():
    assert calculate_total_transfers(transfers(), START, END)["total_transfer_amount"] == 700.0


def test_period_boundaries_are_inclusive_for_total_transfers():
    total = calculate_total_transfers(transfers(), date(2026, 1, 9), date(2026, 1, 10))
    assert total["total_transfer_amount"] == 300.0


def test_uses_transfer_amount_not_total_cost_for_total_transfers():
    report = analyze_transactions(sent_with_fee())
    assert report["transfers"]["total_transfers"]["total_transfer_amount"] == 700.0


def test_returns_zero_when_no_transfers_exist():
    assert calculate_total_transfers([], START, END)["total_transfer_amount"] == 0


def test_returns_zero_when_no_transfers_fall_within_period():
    assert calculate_total_transfers(transfers(), *MARCH)["total_transfer_amount"] == 0


def test_ranks_recipients_by_transaction_count():
    assert rank_recipients_by_transfer_count(transfers(), *JANUARY) == [
        {"recipient": "Example Person 12", "transaction_count": 3, "ranking": 1},
        {"recipient": "Example Person 34", "transaction_count": 1, "ranking": 2},
        {"recipient": "Example Person 56", "transaction_count": 1, "ranking": 2},
    ]


def test_transfers_outside_period_are_excluded_from_recipient_count_ranking():
    ranked = rank_recipients_by_transfer_count(transfers(), START, END)
    assert {entry["recipient"]: entry["transaction_count"] for entry in ranked} == {
        "Example Person 12": 1,
        "Example Person 34": 1,
        "Example Person 56": 1,
    }


def test_period_boundaries_are_inclusive_for_recipient_count_ranking():
    ranked = rank_recipients_by_transfer_count(transfers(), date(2026, 1, 9), date(2026, 1, 10))
    assert ranked == [{"recipient": "Example Person 12", "transaction_count": 2, "ranking": 1}]


def test_recipients_with_equal_transaction_counts_share_rank():
    ranked = rank_recipients_by_transfer_count(transfers(), START, END)
    assert [entry["ranking"] for entry in ranked] == [1, 1, 1]


def test_recipient_count_ranking_is_empty_when_no_transfers_exist():
    assert rank_recipients_by_transfer_count([], START, END) == []


def test_recipient_count_ranking_is_empty_when_no_transfers_fall_within_period():
    assert rank_recipients_by_transfer_count(transfers(), *MARCH) == []


def two_months():
    return [
        record(5, 100.0, "Example Person 12", month=3),
        record(5, 40.0, "Example Person 12", month=1),
        record(6, 60.0, "Example Person 34", month=1),
    ]


WHOLE_YEAR = (date(2026, 1, 1), date(2026, 12, 31))


def test_calculates_total_transfer_amount_for_each_month():
    assert calculate_monthly_transfer_amounts(two_months(), *WHOLE_YEAR) == [
        {"month": "2026-01", "transfer_amount": 100.0},
        {"month": "2026-03", "transfer_amount": 100.0},
    ]


def test_transfers_outside_period_are_excluded_from_monthly_transfer_amounts():
    monthly = calculate_monthly_transfer_amounts(two_months(), *JANUARY)
    assert monthly == [{"month": "2026-01", "transfer_amount": 100.0}]


def test_period_boundaries_are_inclusive_for_monthly_transfer_amounts():
    monthly = calculate_monthly_transfer_amounts(two_months(), date(2026, 1, 5), date(2026, 1, 6))
    assert monthly == [{"month": "2026-01", "transfer_amount": 100.0}]


def test_uses_transfer_amount_not_total_cost_for_monthly_transfer_amounts():
    monthly = analyze_transactions(sent_with_fee())["transfers"]["monthly_transfer_amounts"]
    assert monthly == [{"month": "2026-01", "transfer_amount": 700.0}]


def test_returns_months_in_chronological_order():
    months = calculate_monthly_transfer_amounts(two_months(), *WHOLE_YEAR)
    assert [entry["month"] for entry in months] == ["2026-01", "2026-03"]


def test_does_not_create_entries_for_months_without_transfers():
    months = calculate_monthly_transfer_amounts(two_months(), *WHOLE_YEAR)
    assert "2026-02" not in [entry["month"] for entry in months]


def test_monthly_transfer_amounts_are_empty_when_no_transfers_exist():
    assert calculate_monthly_transfer_amounts([], START, END) == []


def test_monthly_transfer_amounts_are_empty_when_no_transfers_fall_within_period():
    assert (
        calculate_monthly_transfer_amounts(two_months(), date(2026, 2, 1), date(2026, 2, 28)) == []
    )


def test_ranks_individual_transfers_by_amount():
    ranked = rank_transfers_by_amount(transfers(), *JANUARY)
    assert [entry["amount"] for entry in ranked] == [500.0, 300.0, 200.0, 200.0, 100.0]
    assert ranked[0] == {
        "recipient": "Example Person 12",
        "amount": 500.0,
        "date": date(2026, 1, 21),
        "ranking": 1,
    }


def test_each_transfer_is_ranked_individually():
    ranked = rank_transfers_by_amount(transfers(), *JANUARY)
    assert len(ranked) == 5
    assert [entry["recipient"] for entry in ranked].count("Example Person 12") == 3


def test_transfers_outside_period_are_excluded_from_transfer_amount_ranking():
    ranked = rank_transfers_by_amount(transfers(), START, END)
    assert [entry["amount"] for entry in ranked] == [300.0, 200.0, 200.0]


def test_period_boundaries_are_inclusive_for_transfer_amount_ranking():
    ranked = rank_transfers_by_amount(transfers(), date(2026, 1, 20), date(2026, 1, 21))
    assert [entry["amount"] for entry in ranked] == [500.0, 200.0]


def test_equal_transfer_amounts_share_the_same_rank():
    ranked = rank_transfers_by_amount(transfers(), *JANUARY)
    assert [entry["ranking"] for entry in ranked] == [1, 2, 3, 3, 5]


def test_uses_transfer_amount_not_total_cost_for_transfer_amount_ranking():
    largest = analyze_transactions(sent_with_fee())["transfers"]["largest_transfers"]
    assert largest[0]["amount"] == 700.0


def test_transfer_amount_ranking_is_empty_when_no_transfers_exist():
    assert rank_transfers_by_amount([], START, END) == []


def test_transfer_amount_ranking_is_empty_when_no_transfers_fall_within_period():
    assert rank_transfers_by_amount(transfers(), *MARCH) == []


def test_calculate_total_received_transfers_sums_incoming_transfers():
    total = calculate_total_received_transfers(transfers(), *JANUARY)
    assert total == {"period": {"start": JANUARY[0], "end": JANUARY[1]}, "total_received": 1300.0}


def test_calculate_total_received_transfers_includes_period_boundaries():
    total = calculate_total_received_transfers(transfers(), date(2026, 1, 20), date(2026, 1, 21))
    assert total["total_received"] == 700.0


def test_calculate_total_received_transfers_excludes_transfers_outside_period():
    assert calculate_total_received_transfers(transfers(), START, END)["total_received"] == 700.0


def test_calculate_total_received_transfers_returns_zero_when_none_qualify():
    assert calculate_total_received_transfers(transfers(), *MARCH)["total_received"] == 0
