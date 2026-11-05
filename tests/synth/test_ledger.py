import pytest

from synth.ledger import compute_expected


def row(balance, *, paid_in=None, withdrawn=None, details="Airtime Purchase", time=None):
    return {
        "receipt_no": "ZZ" + "AB12CD34",
        "completion_time": time or "2026-01-05 10:00:00",
        "details": details,
        "status": "Completed",
        "paid_in": paid_in,
        "withdrawn": withdrawn,
        "balance": balance,
        "page": 1,
        "line": 0,
    }


PRINT_ORDER = [
    row("875.00", withdrawn="5.00", details="Pay Bill Charge", time="2026-01-03 09:00:00"),
    row("880.00", withdrawn="120.00", details="Pay Bill Online", time="2026-01-03 09:00:00"),
    row("1,000.00", paid_in="1,000.00", details="Funds received", time="2026-01-01 08:00:00"),
]


def test_totals_are_summed_from_the_printed_rows():
    expected = compute_expected(PRINT_ORDER)
    assert expected["row_count"] == 3
    assert expected["total_paid_in"] == "1000.00"
    assert expected["total_withdrawn"] == "125.00"
    assert expected["total_fees"] == "5.00"


def test_opening_balance_is_worked_back_from_the_oldest_row():
    assert compute_expected(PRINT_ORDER)["opening_balance"] == "0.00"


def test_closing_balance_follows_print_order_when_the_latest_time_is_tied():
    assert compute_expected(PRINT_ORDER)["closing_balance"] == "875.00"
    swapped = [PRINT_ORDER[1], PRINT_ORDER[0], PRINT_ORDER[2]]
    assert compute_expected(swapped)["closing_balance"] == "880.00"


def test_closing_balance_uses_the_latest_time_not_the_first_printed_row():
    ascending = list(reversed(PRINT_ORDER[1:]))
    assert compute_expected(ascending)["closing_balance"] == "880.00"


def test_clean_chain_has_no_breaks():
    assert compute_expected(PRINT_ORDER)["chain_breaks"] == 0


def test_a_broken_balance_is_counted():
    broken = [row("999.00", withdrawn="120.00"), PRINT_ORDER[2]]
    assert compute_expected(broken)["chain_breaks"] == 1


def test_status_counts_are_reported():
    assert compute_expected(PRINT_ORDER)["status_counts"] == {"Completed": 3}


def test_same_second_pairs_are_reported_with_their_print_order():
    assert compute_expected(PRINT_ORDER)["same_second_pairs"] == ["fee_first"]
    swapped = [PRINT_ORDER[1], PRINT_ORDER[0], PRINT_ORDER[2]]
    assert compute_expected(swapped)["same_second_pairs"] == ["parent_first"]


def test_empty_input_gives_zero_totals():
    expected = compute_expected([])
    assert expected["row_count"] == 0
    assert expected["total_paid_in"] == "0.00"
    assert expected["closing_balance"] is None


def test_unparsable_amount_raises_without_repeating_the_value():
    planted = "not-an-amount"
    with pytest.raises(ValueError, match="row 0") as caught:
        compute_expected([row("1.00", paid_in=planted)])
    assert planted not in str(caught.value)


SUMMARY = (
    ("Customer Name", "Example Person 00"),
    ("Transaction Count", "3"),
    ("Total Paid In", "1,000.00"),
    ("Total Withdrawn", "125.00"),
    ("Opening Balance", "0.00"),
    ("Closing Balance", "875.00"),
)


def test_summary_totals_keep_only_the_labels_the_ledger_checks():
    totals = compute_expected(PRINT_ORDER, SUMMARY)["summary_totals"]
    assert "Customer Name" not in totals
    assert totals["Total Paid In"] == "1,000.00"


def test_summary_that_agrees_with_the_rows_reconciles_on_every_label():
    reconciliation = compute_expected(PRINT_ORDER, SUMMARY)["summary_reconciliation"]
    assert len(reconciliation) == 5
    assert all(reconciliation.values())


@pytest.mark.parametrize(
    ("label", "wrong"),
    [
        ("Transaction Count", "4"),
        ("Total Paid In", "1,000.01"),
        ("Total Withdrawn", "1.00"),
        ("Opening Balance", "9.00"),
        ("Closing Balance", "880.00"),
    ],
)
def test_summary_that_disagrees_is_false_for_that_label_only(label, wrong):
    summary = tuple((name, wrong if name == label else value) for name, value in SUMMARY)
    reconciliation = compute_expected(PRINT_ORDER, summary)["summary_reconciliation"]
    assert [name for name, agrees in reconciliation.items() if not agrees] == [label]


def test_no_summary_gives_no_reconciliation():
    assert compute_expected(PRINT_ORDER)["summary_reconciliation"] == {}


def broken_pair(upper_changes, lower_changes):
    upper = {**row("999.00", withdrawn="120.00"), **upper_changes}
    lower = {**row("1,000.00", paid_in="1,000.00"), **lower_changes}
    return [upper, lower]


@pytest.mark.parametrize(
    ("upper_changes", "lower_changes", "kind"),
    [
        ({}, {}, "same_receipt"),
        ({"receipt_no": "other-one"}, {}, "tied_timestamp"),
        (
            {"receipt_no": "other-one", "completion_time": "2026-01-06 10:00:00"},
            {"page": 2},
            "page_boundary",
        ),
        ({"receipt_no": "other-one", "completion_time": "2026-01-06 10:00:00"}, {}, "other"),
    ],
)
def test_a_chain_break_is_counted_under_one_kind(upper_changes, lower_changes, kind):
    kinds = compute_expected(broken_pair(upper_changes, lower_changes))["chain_break_kinds"]
    assert kinds[kind] == 1
    assert sum(kinds.values()) == 1
