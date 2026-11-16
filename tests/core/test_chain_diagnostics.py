"""Chain diagnostics (CP7a-2): the balance identity, break residuals and reordering inside groups.

Counts and truth values only. The identity compares to half a cent (A-08), never with float ==.
"""

import pytest

from mpesa_core.reconciliation.reconcile import (
    GROUP_RULES,
    MAX_REORDER_GROUP,
    NEWEST_FIRST,
    OLDEST_FIRST,
    RECEIPT_OR_TIME,
    SAME_RECEIPT,
    SAME_TIME,
    chain_break_residuals,
    count_breaks_resolvable_by_reorder,
    count_residuals_matching_nearby_amounts,
    find_chain_breaks,
    measure_identity_gap,
    reconcile,
    reorder_group_sizes,
    reorder_within_groups,
)


def row(balance, *, paid_in=None, withdrawn=None, time="2026-01-05 10:00:00", position=0, **fields):
    return {
        "receipt_no": fields.pop("receipt_no", f"ZZ{position:08d}"),
        "completion_time": time,
        "details": "Some details",
        "status": "Completed",
        "paid_in": paid_in,
        "withdrawn": withdrawn,
        "balance": balance,
        "page": 1,
        "line": position,
    }


def clean_newest_first():
    return [
        row("875.00", withdrawn="5.00", time="2026-01-03 09:00:00", position=1),
        row("880.00", withdrawn="120.00", time="2026-01-02 09:00:00", position=2),
        row("1,000.00", paid_in="1,000.00", time="2026-01-01 08:00:00", position=3),
    ]


def fee_pair_printed_in_the_wrong_order():
    """A parent and its fee share a receipt and a second, but print in the order that breaks."""
    shared = {"receipt_no": "ZZ" + "PAIR0001", "time": "2026-01-03 09:00:00"}
    return [
        row("880.00", withdrawn="120.00", **shared),
        row("875.00", withdrawn="5.00", **shared),
        row("1,000.00", paid_in="1,000.00", time="2026-01-01 08:00:00", position=3),
    ]


def test_a_clean_chain_has_no_identity_gap():
    assert measure_identity_gap(clean_newest_first(), NEWEST_FIRST) == pytest.approx(0.0)


def test_the_gap_is_what_the_closing_balance_misses_by():
    rows = clean_newest_first()
    rows[0]["balance"] = "870.00"
    assert measure_identity_gap(rows, NEWEST_FIRST) == pytest.approx(-5.0)


def test_the_gap_reads_the_print_orientation():
    rows = list(reversed(clean_newest_first()))
    assert measure_identity_gap(rows, OLDEST_FIRST) == pytest.approx(0.0)


def test_no_rows_or_an_unreadable_balance_gives_no_gap():
    assert measure_identity_gap([], NEWEST_FIRST) is None
    rows = clean_newest_first()
    rows[0]["balance"] = "not an amount"
    assert measure_identity_gap(rows, NEWEST_FIRST) is None


@pytest.mark.parametrize(("shift", "holds"), [("0.004", True), ("0.006", False)])
def test_identity_holds_to_half_a_cent_not_to_float_equality(printed, shift, holds):
    rows = clean_newest_first()
    rows[0]["balance"] = f"{875 + float(shift):.3f}"
    assert reconcile(printed.statement_of(), rows)["identity_holds"] is holds


def test_identity_is_unknown_without_rows(printed):
    assert reconcile(printed.statement_of(), [])["identity_holds"] is None


def test_each_break_has_a_residual_at_its_print_position():
    rows = clean_newest_first()
    rows[0]["balance"] = "870.00"
    assert chain_break_residuals(rows, NEWEST_FIRST) == [(0, pytest.approx(-5.0))]


def test_residuals_add_up_to_the_identity_gap():
    rows = clean_newest_first()
    rows[0]["balance"] = "870.00"
    rows[1]["balance"] = "890.00"
    residuals = [residual for _, residual in chain_break_residuals(rows, NEWEST_FIRST)]
    assert len(residuals) == 2
    assert sum(residuals) == pytest.approx(measure_identity_gap(rows, NEWEST_FIRST))


def test_a_clean_chain_has_no_residuals():
    assert chain_break_residuals(clean_newest_first(), NEWEST_FIRST) == []


def test_breaks_inside_a_same_receipt_group_are_resolved_by_reordering_it():
    counts = count_breaks_resolvable_by_reorder(fee_pair_printed_in_the_wrong_order(), NEWEST_FIRST)
    assert counts == {"resolved": 2, "remaining": 0, "groups_too_large": 0}


def test_a_tied_timestamp_group_is_reordered_too():
    rows = fee_pair_printed_in_the_wrong_order()
    rows[1]["receipt_no"] = "ZZ" + "OTHER001"
    assert count_breaks_resolvable_by_reorder(rows, NEWEST_FIRST)["resolved"] == 2


def test_a_break_between_rows_with_nothing_in_common_remains():
    rows = clean_newest_first()
    rows[0]["balance"] = "870.00"
    counts = count_breaks_resolvable_by_reorder(rows, NEWEST_FIRST)
    assert counts == {"resolved": 0, "remaining": 1, "groups_too_large": 0}


def test_a_clean_chain_has_nothing_to_resolve():
    counts = count_breaks_resolvable_by_reorder(clean_newest_first(), NEWEST_FIRST)
    assert counts == {"resolved": 0, "remaining": 0, "groups_too_large": 0}


def test_a_group_larger_than_the_limit_is_counted_and_left_as_printed():
    size = MAX_REORDER_GROUP + 1
    rows = [row(f"{100 + index}.00", withdrawn="1.00", position=index) for index in range(size)]
    counts = count_breaks_resolvable_by_reorder(rows, NEWEST_FIRST)
    assert counts["groups_too_large"] == 1
    assert counts["resolved"] == 0


def test_reordering_does_not_change_the_rows():
    rows = fee_pair_printed_in_the_wrong_order()
    before = [dict(each) for each in rows]
    count_breaks_resolvable_by_reorder(rows, NEWEST_FIRST)
    assert rows == before


def test_quality_counts_breaks_resolvable_by_reorder_in_the_recorded_orientation(printed):
    quality = reconcile(printed.statement_of(), clean_newest_first())
    assert quality["chain_breaks_resolvable_by_reorder"] == 0
    assert quality["chain_breaks"] == 0
    assert quality["identity_holds"] is True


def test_quality_counts_breaks_before_and_after_reordering(printed):
    rows = fee_pair_printed_in_the_wrong_order()[:2] + [
        row("1,000.00", paid_in="500.00", time="2026-01-02 08:00:00", position=3),
        row("500.00", paid_in="300.00", time="2026-01-01 09:00:00", position=4),
        row("200.00", paid_in="200.00", time="2026-01-01 08:00:00", position=5),
    ]
    quality = reconcile(printed.statement_of(), rows)
    assert quality["chain_orientation"] == NEWEST_FIRST
    assert quality["chain_breaks_raw"] == quality["chain_breaks"] == 2
    assert quality["chain_breaks_after_reorder"] == 0


def test_quality_keeps_breaks_reordering_cannot_remove(printed):
    rows = clean_newest_first()
    rows[0]["balance"] = "870.00"
    quality = reconcile(printed.statement_of(), rows)
    assert quality["chain_breaks_raw"] == 1
    assert quality["chain_breaks_after_reorder"] == 1


def test_the_group_rules_are_receipt_time_and_either():
    assert GROUP_RULES == (SAME_RECEIPT, SAME_TIME, RECEIPT_OR_TIME)


def test_a_same_receipt_pair_with_different_times_is_a_receipt_group_only():
    rows = fee_pair_printed_in_the_wrong_order()
    rows[1]["completion_time"] = "2026-01-03 09:00:01"
    resolved = {
        rule: count_breaks_resolvable_by_reorder(rows, NEWEST_FIRST, rule)["resolved"]
        for rule in GROUP_RULES
    }
    assert resolved == {SAME_RECEIPT: 2, SAME_TIME: 0, RECEIPT_OR_TIME: 2}


def test_a_tied_time_pair_with_different_receipts_is_a_time_group_only():
    rows = fee_pair_printed_in_the_wrong_order()
    rows[1]["receipt_no"] = "ZZ" + "OTHER001"
    resolved = {
        rule: count_breaks_resolvable_by_reorder(rows, NEWEST_FIRST, rule)["resolved"]
        for rule in GROUP_RULES
    }
    assert resolved == {SAME_RECEIPT: 0, SAME_TIME: 2, RECEIPT_OR_TIME: 2}


def test_the_rule_defaults_to_either():
    rows = fee_pair_printed_in_the_wrong_order()
    assert count_breaks_resolvable_by_reorder(rows, NEWEST_FIRST) == (
        count_breaks_resolvable_by_reorder(rows, NEWEST_FIRST, RECEIPT_OR_TIME)
    )


def test_an_unknown_rule_is_refused_without_repeating_it():
    with pytest.raises(ValueError) as caught:
        count_breaks_resolvable_by_reorder(clean_newest_first(), NEWEST_FIRST, "planted-rule")
    assert "planted-rule" not in str(caught.value)


def test_reordering_gives_the_rows_in_their_best_order_and_leaves_the_input_alone():
    rows = fee_pair_printed_in_the_wrong_order()
    reordered = reorder_within_groups(rows, NEWEST_FIRST)
    assert reordered["rows"] == [rows[1], rows[0], rows[2]]
    assert reordered["groups_too_large"] == 0
    assert find_chain_breaks(reordered["rows"], NEWEST_FIRST) == []


def test_group_sizes_are_counted_per_rule():
    rows = [
        row("10.00", time="2026-01-05 10:00:00", position=1, receipt_no="ZZ" + "SHARED01"),
        row("10.00", time="2026-01-05 10:00:01", position=2, receipt_no="ZZ" + "SHARED01"),
        row("10.00", time="2026-01-05 10:00:01", position=3),
        row("10.00", time="2026-01-05 11:00:00", position=4),
        row("10.00", time="2026-01-05 12:00:00", position=5),
        row("10.00", time="2026-01-05 12:00:00", position=6),
    ]
    assert reorder_group_sizes(rows, SAME_RECEIPT) == {2: 1}
    assert reorder_group_sizes(rows, SAME_TIME) == {2: 2}
    assert reorder_group_sizes(rows) == {3: 1, 2: 1}


def test_no_groups_gives_an_empty_histogram():
    assert reorder_group_sizes(clean_newest_first()) == {}


def off_by_a_nearby_amount():
    """Newest first; the newest balance is short by 30.00, the amount two rows further down."""
    return [
        row("970.00", withdrawn="10.00", time="2026-01-09 09:00:00", position=1),
        row("1,010.00", withdrawn="20.00", time="2026-01-08 09:00:00", position=2),
        row("1,030.00", withdrawn="30.00", time="2026-01-07 09:00:00", position=3),
        row("1,060.00", withdrawn="40.00", time="2026-01-06 09:00:00", position=4),
        row("1,100.00", paid_in="1,100.00", time="2026-01-05 09:00:00", position=5),
    ]


def test_a_residual_equal_to_a_nearby_amount_is_counted():
    rows = off_by_a_nearby_amount()
    assert len(find_chain_breaks(rows, NEWEST_FIRST)) == 1
    assert count_residuals_matching_nearby_amounts(rows, NEWEST_FIRST) == 1


def test_a_residual_matching_nothing_nearby_is_not_counted():
    rows = clean_newest_first()
    rows[0]["balance"] = "870.01"
    assert count_residuals_matching_nearby_amounts(rows, NEWEST_FIRST) == 0


def test_the_window_counts_rows_beyond_the_two_rows_of_the_break():
    rows = off_by_a_nearby_amount()
    assert count_residuals_matching_nearby_amounts(rows, NEWEST_FIRST, window=0) == 0
    assert count_residuals_matching_nearby_amounts(rows, NEWEST_FIRST, window=1) == 1


def test_a_clean_chain_has_no_matching_residuals():
    assert count_residuals_matching_nearby_amounts(clean_newest_first(), NEWEST_FIRST) == 0
