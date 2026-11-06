import pytest

from mpesa_core.errors import ErrorCode, ExtractionError
from mpesa_core.extraction.columns import calibrate_columns, find_anchor, group_lines, is_header_row

HEADER_OFFSET = 38.0
JITTERS = (-0.4, 0.4, 0.13, -0.27)
CLOSE_POINTS = 0.01


def assert_layout_unrecognized(statement_pages):
    with pytest.raises(ExtractionError) as caught:
        calibrate_columns(statement_pages)
    assert caught.value.code is ErrorCode.LAYOUT_UNRECOGNIZED
    return caught.value


def assert_positions_match(layout, printed):
    expected = {
        "receipt": printed.RECEIPT_X0,
        "time": printed.TIME_X0,
        "details": printed.DETAILS_X0,
        "status": printed.STATUS_X0,
        "paid_in": printed.PAID_IN_X1,
        "withdrawn": printed.WITHDRAWN_X1,
        "balance": printed.BALANCE_X1,
    }
    for name, position in expected.items():
        assert getattr(layout, name) == pytest.approx(position, abs=CLOSE_POINTS), name


def test_columns_calibrate_from_data_not_headers(printed):
    items = printed.header_items(80.0, offset=HEADER_OFFSET) + printed.calibrating_rows()
    layout = calibrate_columns(printed.statement_of(printed.page_of(items)))
    assert_positions_match(layout, printed)


def test_jitter_tolerated(printed):
    items = printed.calibrating_rows(count=8, jitter=JITTERS)
    layout = calibrate_columns(printed.statement_of(printed.page_of(items)))
    assert layout.receipt == pytest.approx(printed.RECEIPT_X0, abs=0.41)
    assert layout.balance == pytest.approx(printed.BALANCE_X1, abs=0.41)


def test_jitter_tolerated_with_only_two_values_at_the_widest_spread(printed):
    items = printed.calibrating_rows(count=4, jitter=(-0.4, -0.4, 0.4, 0.4))
    assert calibrate_columns(printed.statement_of(printed.page_of(items)))


def test_zero_anchors_raises(printed):
    items = printed.header_items(80.0) + [printed.left_item("Some notice text", 70.0, 100.0)]
    assert_layout_unrecognized(printed.statement_of(printed.page_of(items)))


def test_empty_statement_raises(printed):
    assert_layout_unrecognized(printed.statement_of())
    assert_layout_unrecognized(printed.statement_of(printed.page_of([])))


@pytest.mark.parametrize(
    "cells",
    [
        {"receipt": "ZZ0000001"},
        {"receipt": "ZZ000000001"},
        {"receipt": "zz00000001"},
        {"receipt": "ZZ-0000001"},
        {"receipt": None},
        {"time": None},
        {"time": "2026-01-05"},
        {"time": "05-01-2026 10:00:00"},
    ],
    ids=["short", "long", "lower", "punctuated", "no-receipt", "no-time", "no-clock", "day-first"],
)
def test_line_without_a_full_receipt_and_date_is_not_an_anchor(printed, cells):
    items = printed.row_items(1, 100.0, cells=cells)
    assert_layout_unrecognized(printed.statement_of(printed.page_of(items)))


def test_column_seen_only_once_cannot_calibrate(printed):
    items = printed.calibrating_rows(count=2)
    items += printed.row_items(5, 200.0)
    assert_layout_unrecognized(printed.statement_of(printed.page_of(items)))


def test_column_never_seen_cannot_calibrate(printed):
    items = printed.row_items(1, 100.0) + printed.row_items(2, 110.0) + printed.row_items(3, 120.0)
    assert_layout_unrecognized(printed.statement_of(printed.page_of(items)))


def test_more_amount_columns_than_expected_cannot_calibrate(printed):
    items = printed.calibrating_rows()
    items += [printed.right_item("1.00", 560.0, 100.0), printed.right_item("1.00", 560.0, 110.0)]
    assert_layout_unrecognized(printed.statement_of(printed.page_of(items)))


def test_status_never_printed_cannot_calibrate(printed):
    items = []
    for position in range(4):
        cells = {"details": None, "status": None}
        cells |= {"paid_in": "9.00", "withdrawn": None} if position % 2 else {}
        items += printed.row_items(position, 100.0 + position * 10.0, cells=cells)
    assert_layout_unrecognized(printed.statement_of(printed.page_of(items)))


def test_details_never_beside_the_status_cannot_calibrate(printed):
    items = []
    for position in range(4):
        cells = {"details": None}
        cells |= {"paid_in": "9.00", "withdrawn": None} if position % 2 else {}
        items += printed.row_items(position, 100.0 + position * 10.0, cells=cells)
    assert_layout_unrecognized(printed.statement_of(printed.page_of(items)))


def test_header_order_mismatch_raises(printed):
    swapped = list(printed.HEADER_LABELS)
    swapped[4], swapped[5] = swapped[5], swapped[4]
    items = printed.header_items(80.0, labels=swapped) + printed.calibrating_rows()
    assert_layout_unrecognized(printed.statement_of(printed.page_of(items)))


def test_header_order_mismatch_on_a_later_page_raises(printed):
    swapped = list(reversed(printed.HEADER_LABELS))
    first = printed.header_items(80.0) + printed.calibrating_rows()
    later = printed.header_items(40.0, labels=swapped)
    pages = (printed.page_of(first), printed.page_of(later, number=2))
    assert_layout_unrecognized(printed.statement_of(*pages))


def test_missing_header_does_not_stop_calibration(printed):
    items = printed.calibrating_rows()
    layout = calibrate_columns(printed.statement_of(printed.page_of(items)))
    assert_positions_match(layout, printed)


def test_columns_out_of_order_raises(printed):
    items = []
    for position in range(4):
        top = 100.0 + position * 10.0
        cells = {"receipt": None, "time": None}
        cells |= {"paid_in": "9.00", "withdrawn": None} if position % 2 else {}
        items += printed.row_items(position, top, cells=cells)
        items.append(printed.left_item(printed.receipt_number(position), printed.TIME_X0, top))
        items.append(printed.left_item(printed.EARLY_TIME, printed.RECEIPT_X0, top))
    assert_layout_unrecognized(printed.statement_of(printed.page_of(items)))


def test_split_date_and_time_anchor_works(printed):
    items = []
    for position in range(4):
        top = 100.0 + position * 10.0
        cells = {"time": None}
        cells |= {"paid_in": "9.00", "withdrawn": None} if position % 2 else {}
        items += printed.row_items(position, top, cells=cells)
        items.append(printed.left_item("2026-01-05", printed.TIME_X0, top))
        items.append(printed.left_item("10:00:00", printed.TIME_X0 + 40.0, top))
    layout = calibrate_columns(printed.statement_of(printed.page_of(items)))
    assert_positions_match(layout, printed)
    anchor = find_anchor(group_lines(printed.page_of(items))[0])
    assert anchor.completion_time == printed.EARLY_TIME


def test_date_item_may_only_start_with_the_timestamp(printed):
    cells = {"time": f"{printed.EARLY_TIME} extra"}
    line = group_lines(printed.page_of(printed.row_items(1, 100.0, cells=cells)))[0]
    anchor = find_anchor(line)
    assert anchor.completion_time == printed.EARLY_TIME
    assert anchor.trailing_text == "extra"


def test_whitespace_items_do_not_affect_calibration(printed):
    items = printed.calibrating_rows()
    clean = calibrate_columns(printed.statement_of(printed.page_of(items)))
    noisy_items = list(items)
    for top in (100.0, 110.0, 120.0):
        noisy_items.append({"text": "  ", "x0": 40.0, "x1": 560.0, "top": top, "bottom": top})
        noisy_items.append({"text": "\t", "x0": 45.0, "x1": 590.0, "top": top, "bottom": top})
    assert calibrate_columns(printed.statement_of(printed.page_of(noisy_items))) == clean


def test_whitespace_at_the_baseline_makes_no_line_of_its_own(printed):
    top = 100.0
    items = printed.row_items(1, top) + [printed.space_item(100.0, top + 5.5)]
    lines = group_lines(printed.page_of(items))
    assert len(lines) == 1
    assert len(lines[0].spaces) == 1


def test_line_holding_only_whitespace_is_not_a_line(printed):
    assert group_lines(printed.page_of([printed.space_item(100.0, 300.0)])) == []


def test_items_within_one_point_share_a_line(printed):
    items = [printed.left_item("left", 70.0, 100.0), printed.left_item("right", 200.0, 101.0)]
    assert len(group_lines(printed.page_of(items))) == 1


def test_items_further_than_one_point_apart_do_not_share_a_line(printed):
    items = [printed.left_item("left", 70.0, 100.0), printed.left_item("right", 200.0, 101.1)]
    assert len(group_lines(printed.page_of(items))) == 2


def test_tolerance_is_measured_from_the_line_top_so_lines_never_chain(printed):
    items = [
        printed.left_item(text, 70.0 + 50.0 * shift, 100.0 + 0.7 * shift)
        for shift, text in enumerate(["one", "two", "three"])
    ]
    assert [len(line.items) for line in group_lines(printed.page_of(items))] == [2, 1]


def test_items_on_a_line_read_left_to_right(printed):
    items = [printed.left_item("right", 200.0, 100.0), printed.left_item("left", 70.0, 100.0)]
    assert [entry["text"] for entry in group_lines(printed.page_of(items))[0].items] == [
        "left",
        "right",
    ]


def test_header_row_is_recognized_by_its_labels(printed):
    line = group_lines(printed.page_of(printed.header_items(80.0)))[0]
    assert is_header_row(line)


def test_data_row_is_not_a_header_row(printed):
    assert not is_header_row(group_lines(printed.page_of(printed.row_items(1, 100.0)))[0])


def test_error_carries_only_the_code(printed):
    planted = "PLANTED NOTICE TEXT"
    items = [printed.left_item(planted, 70.0, 100.0)]
    error = assert_layout_unrecognized(printed.statement_of(printed.page_of(items)))
    assert str(error) == "LAYOUT_UNRECOGNIZED"
