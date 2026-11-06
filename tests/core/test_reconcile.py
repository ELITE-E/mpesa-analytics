import pytest

from mpesa_core.reconciliation.reconcile import (
    NEWEST_FIRST,
    OLDEST_FIRST,
    find_chain_breaks,
    reconcile,
)

COUNT_LABEL = "Transaction Count"
PAID_IN_LABEL = "Total Paid In"
WITHDRAWN_LABEL = "Total Withdrawn"
OPENING_LABEL = "Opening Balance"
CLOSING_LABEL = "Closing Balance"
ALL_LABELS = {COUNT_LABEL, PAID_IN_LABEL, WITHDRAWN_LABEL, OPENING_LABEL, CLOSING_LABEL}
NO_BREAKS = {"same_receipt": 0, "tied_timestamp": 0, "page_boundary": 0, "other": 0}


def row(balance, *, paid_in=None, withdrawn=None, time="2026-01-05 10:00:00", page=1, **fields):
    position = fields.pop("position", 0)
    return {
        "receipt_no": fields.pop("receipt_no", f"ZZ{position:08d}"),
        "completion_time": time,
        "details": "Some details",
        "status": fields.pop("status", "Completed"),
        "paid_in": paid_in,
        "withdrawn": withdrawn,
        "balance": balance,
        "page": page,
        "line": position,
    }


def newest_first_rows():
    return [
        row("875.00", withdrawn="5.00", time="2026-01-03 09:00:00", position=1),
        row("880.00", withdrawn="120.00", time="2026-01-02 09:00:00", position=2),
        row("1,000.00", paid_in="1,000.00", time="2026-01-01 08:00:00", position=3),
    ]


def summary_lines(printed, values):
    items = []
    for position, (label, value) in enumerate(values.items()):
        top = 40.0 + 10.0 * position
        items.append(printed.left_item(label, 70.0, top))
        items.append(printed.left_item(value, 180.0, top))
    return items


def statement_with_summary(printed, values):
    return printed.statement_of(printed.page_of(summary_lines(printed, values)))


AGREEING_SUMMARY = {
    COUNT_LABEL: "3",
    PAID_IN_LABEL: "1,000.00",
    WITHDRAWN_LABEL: "125.00",
    OPENING_LABEL: "0.00",
    CLOSING_LABEL: "875.00",
}


def test_summary_that_agrees_reconciles_true_on_every_label(printed):
    quality = reconcile(statement_with_summary(printed, AGREEING_SUMMARY), newest_first_rows())
    assert quality["summary_reconciliation"] == dict.fromkeys(ALL_LABELS, True)


@pytest.mark.parametrize(
    ("label", "wrong"),
    [
        (COUNT_LABEL, "4"),
        (PAID_IN_LABEL, "1,000.01"),
        (WITHDRAWN_LABEL, "125.50"),
        (OPENING_LABEL, "1.00"),
        (CLOSING_LABEL, "880.00"),
    ],
)
def test_summary_that_disagrees_reconciles_false_for_that_label_only(printed, label, wrong):
    values = {**AGREEING_SUMMARY, label: wrong}
    reconciliation = reconcile(statement_with_summary(printed, values), newest_first_rows())[
        "summary_reconciliation"
    ]
    assert reconciliation == {name: name != label for name in ALL_LABELS}


def test_summary_label_not_printed_is_not_found(printed):
    values = {key: value for key, value in AGREEING_SUMMARY.items() if key != PAID_IN_LABEL}
    reconciliation = reconcile(statement_with_summary(printed, values), newest_first_rows())[
        "summary_reconciliation"
    ]
    assert reconciliation[PAID_IN_LABEL] is None
    assert reconciliation[CLOSING_LABEL] is True


def test_summary_with_no_labels_is_not_found_everywhere(printed):
    reconciliation = reconcile(printed.statement_of(), newest_first_rows())[
        "summary_reconciliation"
    ]
    assert reconciliation == dict.fromkeys(ALL_LABELS)


def test_summary_value_that_is_not_a_number_is_not_found(printed):
    values = {**AGREEING_SUMMARY, PAID_IN_LABEL: "not printed"}
    reconciliation = reconcile(statement_with_summary(printed, values), newest_first_rows())[
        "summary_reconciliation"
    ]
    assert reconciliation[PAID_IN_LABEL] is None


def test_summary_label_is_read_with_a_colon_and_in_any_case(printed):
    values = {"TOTAL PAID IN:": "1,000.00"}
    reconciliation = reconcile(statement_with_summary(printed, values), newest_first_rows())[
        "summary_reconciliation"
    ]
    assert reconciliation[PAID_IN_LABEL] is True


def test_summary_is_read_only_before_the_first_anchor_on_page_one(printed):
    after_rows = printed.calibrating_rows() + summary_lines(printed, {})
    after_rows.append(printed.left_item(PAID_IN_LABEL, 70.0, 300.0))
    after_rows.append(printed.left_item("1,000.00", 180.0, 300.0))
    later_page = printed.page_of(summary_lines(printed, AGREEING_SUMMARY), number=2)
    statement = printed.statement_of(printed.page_of(after_rows), later_page)
    assert reconcile(statement, newest_first_rows())["summary_reconciliation"] == dict.fromkeys(
        ALL_LABELS
    )


def test_summary_uses_printed_withdrawn_as_a_size_when_it_is_negative(printed):
    rows = [
        row("875.00", withdrawn="-5.00", time="2026-01-03 09:00:00", position=1),
        row("880.00", withdrawn="-120.00", time="2026-01-02 09:00:00", position=2),
        row("1,000.00", paid_in="1,000.00", time="2026-01-01 08:00:00", position=3),
    ]
    quality = reconcile(statement_with_summary(printed, AGREEING_SUMMARY), rows)
    assert quality["summary_reconciliation"] == dict.fromkeys(ALL_LABELS, True)
    assert quality["chain_breaks"] == 0


def test_closing_balance_with_a_tied_latest_time_follows_print_order(printed):
    rows = [
        row("875.00", withdrawn="5.00", time="2026-01-03 09:00:00", position=1),
        row("880.00", withdrawn="120.00", time="2026-01-03 09:00:00", position=2),
    ]
    values = {CLOSING_LABEL: "875.00", OPENING_LABEL: "1,000.00"}
    reconciliation = reconcile(statement_with_summary(printed, values), rows)[
        "summary_reconciliation"
    ]
    assert reconciliation[CLOSING_LABEL] is True
    assert reconciliation[OPENING_LABEL] is True


def test_balance_chain_breaks_counted(printed):
    rows = newest_first_rows()
    rows[0]["balance"] = "870.00"
    quality = reconcile(printed.statement_of(), rows)
    assert quality["chain_breaks"] == 1
    assert quality["chain_orientation"] == NEWEST_FIRST
    assert quality["chain_break_counts"][NEWEST_FIRST] == {**NO_BREAKS, "other": 1}


def test_clean_chain_has_no_breaks(printed):
    quality = reconcile(printed.statement_of(), newest_first_rows())
    assert quality["chain_breaks"] == 0
    assert quality["chain_break_counts"][NEWEST_FIRST] == NO_BREAKS


def test_both_orientations_are_counted_and_the_one_with_fewer_is_recorded(printed):
    rows = list(reversed(newest_first_rows()))
    quality = reconcile(printed.statement_of(), rows)
    assert quality["chain_orientation"] == OLDEST_FIRST
    assert quality["chain_breaks"] == 0
    assert sum(quality["chain_break_counts"][OLDEST_FIRST].values()) == 0
    assert sum(quality["chain_break_counts"][NEWEST_FIRST].values()) == 2


def test_equal_breaks_in_both_orientations_record_newest_first(printed):
    rows = [row("1.00", paid_in="9.00", position=1), row("500.00", paid_in="9.00", position=2)]
    quality = reconcile(printed.statement_of(), rows)
    assert quality["chain_orientation"] == NEWEST_FIRST
    assert quality["chain_breaks"] == 1


@pytest.mark.parametrize(
    ("gap", "breaks"),
    [("100.00", 0), ("100.004", 0), ("100.01", 1), ("99.99", 1)],
)
def test_chain_compares_at_half_a_cent(gap, breaks):
    rows = [row(gap, withdrawn="1.00", position=1), row("101.00", paid_in="1.00", position=2)]
    assert len(find_chain_breaks(rows, NEWEST_FIRST)) == breaks


@pytest.mark.parametrize(
    ("newer", "older", "kind"),
    [
        ({"receipt_no": "same-one"}, {"receipt_no": "same-one"}, "same_receipt"),
        ({"position": 1}, {"position": 2}, "tied_timestamp"),
        (
            {"position": 1, "time": "2026-01-06 10:00:00"},
            {"position": 2, "page": 2},
            "page_boundary",
        ),
        ({"position": 1, "time": "2026-01-06 10:00:00"}, {"position": 2}, "other"),
        (
            {"receipt_no": "same-one", "page": 1},
            {"receipt_no": "same-one", "page": 2},
            "same_receipt",
        ),
    ],
    ids=["same-receipt", "tied", "page", "other", "receipt-beats-page"],
)
def test_each_break_counts_under_one_kind(printed, newer, older, kind):
    rows = [row("999.00", withdrawn="1.00", **newer), row("5.00", paid_in="5.00", **older)]
    counts = reconcile(printed.statement_of(), rows)["chain_break_counts"][NEWEST_FIRST]
    assert counts == {**NO_BREAKS, kind: 1}


def test_find_chain_breaks_reports_the_upper_row_of_each_broken_link():
    rows = newest_first_rows()
    rows[0]["balance"] = "870.00"
    assert find_chain_breaks(rows, NEWEST_FIRST) == [0]


def test_rows_by_status_value_are_counted(printed):
    rows = newest_first_rows() + [row("1.00", status="Failed"), row("1.00", status=None)]
    assert reconcile(printed.statement_of(), rows)["status_counts"] == {
        "Completed": 3,
        "Failed": 1,
        "": 1,
    }


def test_row_count_is_reported(printed):
    assert reconcile(printed.statement_of(), newest_first_rows())["row_count"] == 3


def test_unparsed_amounts_are_counted_per_cell(printed):
    rows = [
        row("oops", paid_in="also oops", position=1),
        row("100.00", withdrawn="not a number", position=2),
        row("100.00", position=3),
    ]
    assert reconcile(printed.statement_of(), rows)["unparsed_amounts"] == 3


def test_blank_balance_counts_as_unparsed_and_blank_paid_in_does_not(printed):
    rows = [row(None, position=1), row("100.00", position=2)]
    assert reconcile(printed.statement_of(), rows)["unparsed_amounts"] == 1


def test_link_with_an_unparsed_amount_is_not_a_chain_break():
    rows = [row("oops", withdrawn="1.00", position=1), row("100.00", position=2)]
    assert find_chain_breaks(rows, NEWEST_FIRST) == []


def test_empty_rows_give_zero_counts(printed):
    quality = reconcile(printed.statement_of(), [])
    assert quality["row_count"] == 0
    assert quality["chain_breaks"] == 0
    assert quality["status_counts"] == {}


def test_receipt_length_histogram_counts_what_sits_left_of_each_date(printed):
    items = printed.calibrating_rows(count=2)
    items += printed.row_items(5, 200.0, cells={"receipt": "ZZ000000005"})
    items += printed.row_items(6, 210.0, cells={"receipt": "ZZ00006"})
    items += printed.row_items(7, 220.0, cells={"receipt": None})
    histogram = reconcile(printed.statement_of(printed.page_of(items)), [])[
        "receipt_length_histogram"
    ]
    assert histogram == {10: 2, 11: 1, 7: 1, 0: 1}


def test_receipt_length_histogram_reads_split_dates_too(printed):
    items = printed.row_items(5, 200.0, cells={"time": None})
    items += [
        printed.left_item("2026-01-05", printed.TIME_X0, 200.0),
        printed.left_item("10:00:00", printed.TIME_X0 + 40.0, 200.0),
    ]
    histogram = reconcile(printed.statement_of(printed.page_of(items)), [])[
        "receipt_length_histogram"
    ]
    assert histogram == {10: 1}


def test_quality_holds_only_counts_and_labels_never_row_text(printed):
    planted = "PLANTEDDETAILS"
    rows = [{**row("100.00", position=1), "details": planted, "receipt_no": planted}]
    assert planted not in repr(reconcile(printed.statement_of(), rows))


def test_unreadable_amounts_raise_nothing(printed):
    rows = [row("PLANTED", paid_in="PLANTED", withdrawn="PLANTED", position=1)]
    assert reconcile(printed.statement_of(), rows)["unparsed_amounts"] == 3
