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
    ("Customer Name:", "Example Person 00"),
    ("SUMMARY",),
    ("SEND MONEY:", "0.00", "120.00"),
    ("RECEIVED MONEY:", "1,000.00", "0.00"),
    ("AGENT DEPOSIT:", "0.00", "0.00"),
    ("AGENT WITHDRAWAL:", "0.00", "0.00"),
    ("LIPA NA M-PESA (PAYBILL):", "0.00", "0.00"),
    ("LIPA NA M-PESA (BUY GOODS):", "0.00", "0.00"),
    ("OTHERS:", "0.00", "5.00"),
    ("TOTAL:", "1,000.00", "125.00"),
    ("DETAILED STATEMENT",),
)


def with_total(paid_in, paid_out):
    return tuple(("TOTAL:", paid_in, paid_out) if line[0] == "TOTAL:" else line for line in SUMMARY)


def test_summary_total_keeps_only_the_total_row():
    expected = compute_expected(PRINT_ORDER, SUMMARY)
    assert expected["summary_total"] == {"paid_in": "1,000.00", "paid_out": "125.00"}
    assert "summary_totals" not in expected
    assert "summary_reconciliation" not in expected


def test_summary_that_agrees_with_the_rows_matches_on_both_totals():
    expected = compute_expected(PRINT_ORDER, SUMMARY)
    assert expected["summary_total_paid_in_matches"] is True
    assert expected["summary_total_paid_out_matches"] is True
    assert expected["summary_type_rows_parsed"] == 7


@pytest.mark.parametrize(
    ("paid_in", "paid_out", "matches"),
    [("1,000.01", "125.00", (False, True)), ("1,000.00", "1.00", (True, False))],
)
def test_summary_that_disagrees_is_false_for_that_total_only(paid_in, paid_out, matches):
    expected = compute_expected(PRINT_ORDER, with_total(paid_in, paid_out))
    found = (expected["summary_total_paid_in_matches"], expected["summary_total_paid_out_matches"])
    assert found == matches


def test_a_missing_type_row_is_not_counted():
    summary = tuple(line for line in SUMMARY if line[0] != "OTHERS:")
    assert compute_expected(PRINT_ORDER, summary)["summary_type_rows_parsed"] == 6


def test_no_summary_gives_no_total_and_no_type_rows():
    expected = compute_expected(PRINT_ORDER)
    assert expected["summary_total"] == {}
    assert expected["summary_total_paid_in_matches"] is None
    assert expected["summary_total_paid_out_matches"] is None
    assert expected["summary_type_rows_parsed"] == 0


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


def test_cash_flow_totals_come_from_the_printed_amounts():
    expected = compute_expected(PRINT_ORDER)
    assert expected["total_inflow"] == "1000.00"
    assert expected["total_outflow"] == "125.00"
    assert expected["net_cash_flow"] == "875.00"


def test_net_cash_flow_can_be_negative():
    spent = [row("0.00", withdrawn="50.00")]
    assert compute_expected(spent)["net_cash_flow"] == "-50.00"


def test_cash_flow_totals_are_zero_for_an_empty_statement():
    expected = compute_expected([])
    assert (expected["total_inflow"], expected["total_outflow"], expected["net_cash_flow"]) == (
        "0.00",
        "0.00",
        "0.00",
    )


def test_closing_balance_is_the_newest_row_in_print_order_when_printed_oldest_first():
    oldest_first = list(reversed(PRINT_ORDER))
    assert compute_expected(oldest_first)["closing_balance"] == "875.00"


def test_opening_balance_is_the_oldest_row_in_print_order_when_printed_oldest_first():
    oldest_first = list(reversed(PRINT_ORDER))
    assert compute_expected(oldest_first)["opening_balance"] == "0.00"


def test_opening_balance_on_a_tied_oldest_time_follows_print_order():
    tied_oldest = [
        row("880.00", withdrawn="120.00", time="2026-01-03 09:00:00"),
        row("1,000.00", paid_in="1,000.00", time="2026-01-01 08:00:00"),
        row("0.00", withdrawn="5.00", time="2026-01-01 08:00:00"),
    ]
    assert compute_expected(tied_oldest)["opening_balance"] == "5.00"


def test_event_types_the_generator_built_are_counted():
    tagged = [
        {**PRINT_ORDER[0], "event_type": "FEE"},
        {**PRINT_ORDER[1], "event_type": "BILL_PAYMENT"},
        {**PRINT_ORDER[2], "event_type": "TRANSFER_IN"},
    ]
    assert compute_expected(tagged)["event_type_counts"] == {
        "FEE": 1,
        "BILL_PAYMENT": 1,
        "TRANSFER_IN": 1,
    }


def test_untagged_rows_count_no_event_types():
    assert compute_expected(PRINT_ORDER)["event_type_counts"] == {}
