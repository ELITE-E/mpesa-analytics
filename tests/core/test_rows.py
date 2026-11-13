import pytest

from mpesa_core.errors import ErrorCode, ExtractionError
from mpesa_core.extraction.rows import assemble_rows, build_rows

SEVEN_FIELDS = [
    "receipt_no",
    "completion_time",
    "details",
    "status",
    "paid_in",
    "withdrawn",
    "balance",
]
HEADER_TOP = 80.0


def one_page(printed, items):
    return printed.statement_of(printed.page_of(items))


def wrap_line(printed, text, top):
    return printed.left_item(text, printed.DETAILS_X0, top)


def rows_with_wrap_at(printed, top_of_wrap, text="wrapped text"):
    return printed.calibrating_rows(count=4) + [wrap_line(printed, text, top_of_wrap)]


def test_removes_header_rows(printed):
    items = printed.header_items(HEADER_TOP) + printed.calibrating_rows()
    rows = build_rows(one_page(printed, items))
    assert len(rows) == 4
    assert not any(row["details"] and "Details" in row["details"] for row in rows)


def test_removes_header_rows_repeated_on_later_pages(printed):
    first = printed.header_items(HEADER_TOP) + printed.calibrating_rows()
    later = printed.header_items(40.0) + printed.calibrating_rows(50.0, first_position=10)
    rows = build_rows(
        printed.statement_of(printed.page_of(first), printed.page_of(later, number=2))
    )
    assert len(rows) == 8
    assert not any(row["receipt_no"] == "Receipt No" for row in rows)


def test_header_row_is_removed_even_six_points_above_a_row(printed):
    items = printed.header_items(94.0) + printed.calibrating_rows()
    rows = build_rows(one_page(printed, items))
    assert rows[0]["details"] == "Airtime Purchase"


def test_wrapped_lines_join_into_details_with_a_single_space(printed):
    items = rows_with_wrap_at(printed, 106.0)
    assert build_rows(one_page(printed, items))[0]["details"] == "Airtime Purchase wrapped text"


def test_several_wrapped_lines_keep_their_order(printed):
    items = printed.calibrating_rows(count=1)
    items += [wrap_line(printed, "second", 112.0), wrap_line(printed, "first", 106.0)]
    items += printed.calibrating_rows(130.0, first_position=20)
    rows = build_rows(one_page(printed, items))
    assert rows[0]["details"] == "Airtime Purchase first second"


def test_details_have_no_embedded_newlines(printed):
    items = rows_with_wrap_at(printed, 106.0, text="with\nbreak")
    assert "\n" not in build_rows(one_page(printed, items))[0]["details"]


def test_surrounding_whitespace_is_stripped_from_every_cell(printed):
    cells = {
        "details": "  padded details ",
        "status": " Completed  ",
        "withdrawn": " 5.00",
        "balance": "100.00 ",
    }
    items = printed.row_items(9, 90.0, cells=cells) + printed.calibrating_rows()
    row = build_rows(one_page(printed, items))[0]
    assert row["details"] == "padded details"
    assert row["status"] == "Completed"
    assert row["withdrawn"] == "5.00"
    assert row["balance"] == "100.00"


def test_empty_cells_stay_empty(printed):
    cells = {"details": None, "status": None, "withdrawn": None, "balance": None}
    items = printed.row_items(9, 90.0, cells=cells) + printed.calibrating_rows()
    row = build_rows(one_page(printed, items))[0]
    for field in ("details", "status", "paid_in", "withdrawn", "balance"):
        assert row[field] is None, field


def test_every_row_always_has_all_seven_fields_and_its_position(printed):
    cells = {"details": None, "status": None, "withdrawn": None}
    items = printed.row_items(9, 90.0, cells=cells) + printed.calibrating_rows()
    for row in build_rows(one_page(printed, items)):
        assert set(row) == {*SEVEN_FIELDS, "page", "line"}


def test_original_row_order_is_preserved(printed):
    items = printed.calibrating_rows(count=6)
    receipts = [row["receipt_no"] for row in build_rows(one_page(printed, items))]
    assert receipts == [printed.receipt_number(position) for position in range(6)]


def test_order_does_not_depend_on_the_order_items_arrive_in(printed):
    items = list(reversed(printed.calibrating_rows(count=6)))
    receipts = [row["receipt_no"] for row in build_rows(one_page(printed, items))]
    assert receipts == [printed.receipt_number(position) for position in range(6)]


def test_every_page_is_read_and_rows_from_multiple_pages_merge(printed):
    pages = [
        printed.page_of(printed.calibrating_rows(first_position=10 * index), number=index + 1)
        for index in range(3)
    ]
    rows = build_rows(printed.statement_of(*pages))
    assert len(rows) == 12
    assert [row["page"] for row in rows] == [1] * 4 + [2] * 4 + [3] * 4


def test_pages_without_rows_are_ignored(printed):
    blank = printed.page_of([], number=2)
    notice = printed.page_of([printed.left_item("Notice", 70.0, 100.0)], number=3)
    last = printed.page_of(printed.calibrating_rows(first_position=20), number=4)
    first = printed.page_of(printed.calibrating_rows(), number=1)
    rows = build_rows(printed.statement_of(first, blank, notice, last))
    assert {row["page"] for row in rows} == {1, 4}


def test_no_anchor_rows_raises_rather_than_returning_nothing(printed):
    with pytest.raises(ExtractionError) as caught:
        build_rows(one_page(printed, [printed.left_item("Notice", 70.0, 100.0)]))
    assert caught.value.code is ErrorCode.LAYOUT_UNRECOGNIZED


def test_line_provenance_counts_printed_lines_from_the_top_of_the_page(printed):
    items = printed.header_items(HEADER_TOP) + printed.calibrating_rows(count=2)
    items += [wrap_line(printed, "wrapped", 106.0)]
    items += printed.calibrating_rows(120.0, count=2, first_position=5)
    rows = build_rows(one_page(printed, items))
    assert [row["line"] for row in rows] == [1, 3, 4, 5]


def test_whitespace_only_items_do_not_shift_line_provenance(printed):
    items = printed.header_items(HEADER_TOP) + printed.calibrating_rows()
    clean = build_rows(one_page(printed, items))
    noisy = items + [printed.space_item(100.0, 95.0), printed.space_item(100.0, 105.5)]
    assert build_rows(one_page(printed, noisy)) == clean


def test_status_never_absorbs_details_wrap(printed):
    long_wrap = printed.left_item("a long wrapped line reaching past the status", 205.0, 106.0)
    assert long_wrap["x1"] > printed.STATUS_X0
    items = printed.calibrating_rows() + [long_wrap]
    assembly = assemble_rows(one_page(printed, items))
    assert assembly["rows"][0]["status"] == printed.COMPLETED
    assert assembly["rows"][0]["details"].endswith("past the status")
    assert assembly["layout_counts"]["status_from_non_anchor_line"] == 0


def test_status_stays_empty_when_only_a_details_wrap_follows(printed):
    items = printed.row_items(9, 90.0, cells={"status": None}) + printed.calibrating_rows()
    items.append(wrap_line(printed, "wrapped", 96.0))
    assembly = assemble_rows(one_page(printed, items))
    assert assembly["rows"][0]["status"] is None
    assert assembly["rows"][0]["details"] == "Airtime Purchase wrapped"
    assert assembly["layout_counts"]["status_from_non_anchor_line"] == 0


def test_status_from_a_non_anchor_line_is_counted(printed):
    items = printed.row_items(9, 90.0, cells={"status": None}) + printed.calibrating_rows()
    items.append(printed.left_item(printed.COMPLETED, printed.STATUS_X0, 96.0))
    assembly = assemble_rows(one_page(printed, items))
    assert assembly["rows"][0]["status"] == printed.COMPLETED
    assert assembly["layout_counts"]["status_from_non_anchor_line"] == 1


def test_second_status_on_a_non_anchor_line_is_counted_and_not_merged(printed):
    items = printed.calibrating_rows()
    items.append(printed.left_item("Extra", printed.STATUS_X0, 106.0))
    assembly = assemble_rows(one_page(printed, items))
    assert assembly["rows"][0]["status"] == printed.COMPLETED
    assert "Extra" not in assembly["rows"][0]["details"]
    assert assembly["layout_counts"]["unassigned_items"] == 1


def test_continuation_below_is_counted(printed):
    assembly = assemble_rows(one_page(printed, rows_with_wrap_at(printed, 106.0)))
    assert assembly["layout_counts"]["continuation_lines_below"] == 1
    assert assembly["layout_counts"]["continuation_lines_above"] == 0


def test_continuation_above_joins_before_the_anchor_details_and_is_counted(printed):
    items = printed.calibrating_rows(count=1)
    items += printed.row_items(7, 116.0, cells={"details": "tail"})
    items += [wrap_line(printed, "head", 110.0)]
    items += printed.calibrating_rows(130.0, first_position=20)
    assembly = assemble_rows(one_page(printed, items))
    row = next(row for row in assembly["rows"] if row["receipt_no"] == printed.receipt_number(7))
    assert row["details"] == "head tail"
    assert assembly["layout_counts"]["continuation_lines_above"] == 1
    assert assembly["layout_counts"]["continuation_lines_below"] == 0


def test_continuation_on_both_sides_of_the_anchor_keeps_reading_order(printed):
    items = printed.calibrating_rows(count=4)
    items += printed.row_items(7, 156.0, cells={"details": "middle"})
    items += [wrap_line(printed, "head", 150.0), wrap_line(printed, "tail", 162.0)]
    assembly = assemble_rows(one_page(printed, items))
    assert assembly["rows"][-1]["details"] == "head middle tail"
    assert assembly["layout_counts"]["continuation_lines_above"] == 1
    assert assembly["layout_counts"]["continuation_lines_below"] == 1


def test_line_between_two_close_anchors_goes_below_and_is_counted_ambiguous(printed):
    items = printed.calibrating_rows(count=4)
    items += printed.row_items(7, 150.0)
    items += printed.row_items(8, 162.0)
    items += [wrap_line(printed, "between", 156.0)]
    assembly = assemble_rows(one_page(printed, items))
    assert assembly["rows"][-2]["details"] == "Airtime Purchase between"
    assert assembly["rows"][-1]["details"] == "Airtime Purchase"
    assert assembly["layout_counts"]["ambiguous_continuation_lines"] == 1


def test_line_beyond_the_wrap_gap_is_not_attached(printed):
    items = rows_with_wrap_at(printed, 147.0)
    assembly = assemble_rows(one_page(printed, items))
    assert all("wrapped" not in row["details"] for row in assembly["rows"])
    assert assembly["layout_counts"]["unattached_lines"] == 1


def test_wrap_gap_tolerates_vertical_jitter(printed):
    items = rows_with_wrap_at(printed, 106.8)
    assert build_rows(one_page(printed, items))[0]["details"].endswith("wrapped text")


def test_everything_before_the_first_anchor_on_page_one_is_excluded(printed):
    summary = [
        printed.left_item("Total Paid In", 70.0, 40.0),
        printed.left_item("1,000.00", 205.0, 40.0),
        printed.left_item("Closing Balance", 205.0, 94.0),
    ]
    assembly = assemble_rows(one_page(printed, summary + printed.calibrating_rows()))
    assert assembly["rows"][0]["details"] == "Airtime Purchase"
    assert assembly["layout_counts"]["continuation_lines_above"] == 0


def test_lines_before_the_header_on_page_one_are_excluded_even_when_close(printed):
    items = [printed.left_item("Opening text", 205.0, 74.0)]
    items += printed.header_items(HEADER_TOP) + printed.calibrating_rows()
    assert build_rows(one_page(printed, items))[0]["details"] == "Airtime Purchase"


def test_first_row_keeps_a_continuation_above_it_when_a_header_separates_the_summary(printed):
    items = printed.header_items(80.0) + [wrap_line(printed, "head", 94.0)]
    items += printed.calibrating_rows()
    assert build_rows(one_page(printed, items))[0]["details"] == "head Airtime Purchase"


def test_footer_after_the_last_row_is_excluded_and_counted(printed):
    footer = [
        printed.left_item("Page 1 of 1", 20.0, 300.0),
        printed.left_item("TOKEN", 20.0, 310.0),
    ]
    assembly = assemble_rows(one_page(printed, printed.calibrating_rows() + footer))
    assert all("Page" not in row["details"] for row in assembly["rows"])
    assert assembly["layout_counts"]["unattached_lines"] == 2


def test_footer_close_to_the_last_row_stays_out_of_details(printed):
    footer = [printed.left_item("Page 1 of 1", 20.0, 136.0)]
    assembly = assemble_rows(one_page(printed, printed.calibrating_rows() + footer))
    assert assembly["rows"][-1]["details"] == "Airtime Purchase"
    assert assembly["layout_counts"]["unassigned_items"] == 1


def test_continuation_does_not_cross_a_page(printed):
    first = printed.page_of(printed.calibrating_rows(), number=1)
    later = printed.page_of(
        [wrap_line(printed, "next page", 40.0), *printed.calibrating_rows(100.0, first_position=5)],
        number=2,
    )
    assembly = assemble_rows(printed.statement_of(first, later))
    assert all("next page" not in row["details"] for row in assembly["rows"])
    assert assembly["layout_counts"]["unattached_lines"] == 1


def test_amount_on_a_non_anchor_line_is_counted_and_never_joins_details(printed):
    items = printed.calibrating_rows() + [printed.right_item("7.00", printed.BALANCE_X1, 106.0)]
    assembly = assemble_rows(one_page(printed, items))
    assert "7.00" not in assembly["rows"][0]["details"]
    assert assembly["layout_counts"]["unassigned_items"] == 1


def test_anchor_item_away_from_every_column_is_counted(printed):
    items = printed.calibrating_rows() + [printed.left_item("stray", 480.0, 100.0)]
    assembly = assemble_rows(one_page(printed, items))
    assert assembly["layout_counts"]["unassigned_items"] == 1
    assert "stray" not in assembly["rows"][0]["details"]


def test_page_whose_columns_moved_is_counted_not_guessed(printed):
    first = printed.page_of(printed.calibrating_rows(count=8), number=1)
    shifted = printed.page_of(
        printed.calibrating_rows(count=1, first_position=20, jitter=(3.0,)), number=2
    )
    assembly = assemble_rows(printed.statement_of(first, shifted))
    assert assembly["layout_counts"]["unassigned_items"] > 0
    assert assembly["layout_counts"]["anchor_cells_off_column"] > 0
    moved = [row for row in assembly["rows"] if row["page"] == 2]
    assert all(row["balance"] is None for row in moved)


def test_jittered_cells_still_reach_their_columns(printed):
    items = printed.calibrating_rows(count=8, jitter=(-0.4, 0.4))
    assembly = assemble_rows(one_page(printed, items))
    assert all(row["balance"] == "100.00" for row in assembly["rows"])
    assert assembly["layout_counts"]["unassigned_items"] == 0
    assert assembly["layout_counts"]["anchor_cells_off_column"] == 0


def test_split_date_and_time_join_into_the_completion_time(printed):
    items = []
    for position in range(4):
        top = 100.0 + position * 10.0
        cells = {"time": None}
        cells |= {"paid_in": "9.00", "withdrawn": None} if position % 2 else {}
        items += printed.row_items(position, top, cells=cells)
        items.append(printed.left_item("2026-01-05", printed.TIME_X0, top))
        items.append(printed.left_item("10:00:00", printed.TIME_X0 + 40.0, top))
    rows = build_rows(one_page(printed, items))
    assert all(row["completion_time"] == printed.EARLY_TIME for row in rows)


def test_text_after_the_timestamp_in_one_item_moves_to_details(printed):
    cells = {"time": f"{printed.EARLY_TIME} extra"}
    items = printed.row_items(9, 90.0, cells=cells) + printed.calibrating_rows()
    assert build_rows(one_page(printed, items))[0]["details"] == "extra Airtime Purchase"


def test_details_split_into_items_join_with_one_space(printed):
    items = printed.calibrating_rows()
    items = [
        text_item
        for text_item in items
        if not (text_item["top"] == 100.0 and text_item["text"] == "Airtime Purchase")
    ]
    items += [
        printed.left_item("Part", printed.DETAILS_X0, 100.0),
        printed.left_item("two", printed.DETAILS_X0 + 30.0, 100.0),
    ]
    assert build_rows(one_page(printed, items))[0]["details"] == "Part two"


def test_touching_items_join_without_a_space(printed):
    first = printed.left_item("Air", printed.DETAILS_X0, 100.0)
    second = printed.left_item("time", first["x1"], 100.0)
    items = printed.calibrating_rows()
    items = [
        text_item
        for text_item in items
        if not (text_item["top"] == 100.0 and text_item["text"] == "Airtime Purchase")
    ]
    assert build_rows(one_page(printed, [*items, first, second]))[0]["details"] == "Airtime"


def test_whitespace_item_between_touching_items_becomes_one_space(printed):
    first = printed.left_item("Air", printed.DETAILS_X0, 100.0)
    second = printed.left_item("time", first["x1"], 100.0)
    space = {"text": "  ", "x0": first["x1"], "x1": first["x1"], "top": 105.5, "bottom": 105.5}
    items = printed.calibrating_rows()
    items = [
        text_item
        for text_item in items
        if not (text_item["top"] == 100.0 and text_item["text"] == "Airtime Purchase")
    ]
    assert build_rows(one_page(printed, [*items, first, second, space]))[0]["details"] == "Air time"


def test_line_counts_report_how_many_printed_lines_each_row_used(printed):
    assembly = assemble_rows(one_page(printed, rows_with_wrap_at(printed, 106.0)))
    assert assembly["printed_line_counts"] == [2, 1, 1, 1]


def test_build_rows_returns_only_the_rows_from_the_assembly(printed):
    statement = one_page(printed, printed.calibrating_rows())
    assert build_rows(statement) == assemble_rows(statement)["rows"]


def lines_outside_rows(assembly):
    counts = assembly["layout_counts"]
    return {
        kind: counts[f"unattached_{kind}_lines"]
        for kind in ("header", "footer", "summary", "page_heading", "other")
    }


def footer_items(printed, *tops):
    return [printed.left_item(f"Footer {top}", 20.0, top) for top in tops]


def test_lines_outside_rows_are_counted_by_kind(printed):
    summary = [
        printed.left_item("Total Paid In", 70.0, 40.0),
        printed.left_item("Closing Balance", 70.0, 50.0),
    ]
    first = summary + printed.header_items(HEADER_TOP) + printed.calibrating_rows()
    first += footer_items(printed, 300.0, 310.0)
    stray = [printed.left_item("stray between rows", 205.0, 150.0)]
    later = printed.header_items(40.0) + printed.calibrating_rows(100.0, count=2, first_position=10)
    later += stray + printed.calibrating_rows(200.0, count=2, first_position=20)
    later += footer_items(printed, 400.0)
    statement = printed.statement_of(printed.page_of(first), printed.page_of(later, number=2))
    assembly = assemble_rows(statement)
    assert lines_outside_rows(assembly) == {
        "header": 2,
        "footer": 3,
        "summary": 2,
        "page_heading": 0,
        "other": 1,
    }


def test_unattached_lines_is_the_sum_of_its_kinds(printed):
    items = printed.header_items(HEADER_TOP) + printed.calibrating_rows()
    items += footer_items(printed, 300.0)
    assembly = assemble_rows(one_page(printed, items))
    assert assembly["layout_counts"]["unattached_lines"] == sum(
        lines_outside_rows(assembly).values()
    )


def test_page_without_rows_counts_its_header_and_footer(printed):
    first = printed.page_of(printed.calibrating_rows(), number=1)
    padding = printed.page_of(printed.header_items(40.0) + footer_items(printed, 300.0), number=2)
    assembly = assemble_rows(printed.statement_of(first, padding))
    assert lines_outside_rows(assembly) == {
        "header": 1,
        "footer": 1,
        "summary": 0,
        "page_heading": 0,
        "other": 0,
    }


def test_first_page_without_rows_is_summary_above_its_header_and_footer_below(printed):
    summary_page = printed.page_of(
        [printed.left_item("Total Paid In", 70.0, 40.0)]
        + printed.header_items(80.0)
        + footer_items(printed, 300.0),
        number=1,
    )
    rows_page = printed.page_of(printed.calibrating_rows(), number=2)
    assembly = assemble_rows(printed.statement_of(summary_page, rows_page))
    assert lines_outside_rows(assembly) == {
        "header": 1,
        "footer": 1,
        "summary": 1,
        "page_heading": 0,
        "other": 0,
    }


def test_line_above_the_rows_of_a_later_page_without_a_header_is_other(printed):
    first = printed.page_of(printed.calibrating_rows(), number=1)
    later = printed.page_of(
        [printed.left_item("Running title", 70.0, 40.0)]
        + printed.calibrating_rows(100.0, first_position=5),
        number=2,
    )
    assembly = assemble_rows(printed.statement_of(first, later))
    assert lines_outside_rows(assembly)["other"] == 1


def test_other_lines_are_located_by_page_and_offset_from_the_header(printed):
    first = printed.page_of(printed.header_items(HEADER_TOP) + printed.calibrating_rows(), number=1)
    later = printed.page_of(
        printed.header_items(40.0)
        + [printed.left_item("Stray between rows", 205.0, 150.0)]
        + printed.calibrating_rows(100.0, count=2, first_position=5)
        + printed.calibrating_rows(200.0, count=2, first_position=9),
        number=2,
    )
    assembly = assemble_rows(printed.statement_of(first, later))
    assert assembly["unattached_other_positions"] == [{"page": 2, "offset_from_header": 110.0}]


def test_line_above_the_header_of_a_later_page_is_a_page_heading(printed):
    first = printed.page_of(printed.header_items(HEADER_TOP) + printed.calibrating_rows(), number=1)
    later = printed.page_of(
        [printed.left_item("Running title", 70.0, 22.0)]
        + printed.header_items(40.0)
        + printed.calibrating_rows(100.0, first_position=5),
        number=2,
    )
    assembly = assemble_rows(printed.statement_of(first, later))
    assert lines_outside_rows(assembly)["page_heading"] == 1
    assert lines_outside_rows(assembly)["other"] == 0
    assert assembly["unattached_other_positions"] == []


def test_page_heading_positions_are_recorded_without_text(printed):
    first = printed.page_of(printed.header_items(HEADER_TOP) + printed.calibrating_rows(), number=1)
    later = printed.page_of(
        [printed.left_item("PLANTED TITLE", 70.0, 22.0)]
        + printed.header_items(40.0)
        + printed.calibrating_rows(100.0, first_position=5),
        number=2,
    )
    assembly = assemble_rows(printed.statement_of(first, later))
    assert assembly["unattached_page_heading_positions"] == [
        {"page": 2, "offset_from_header": -18.0}
    ]
    assert "PLANTED" not in repr(assembly["unattached_page_heading_positions"])


def test_other_line_on_a_page_without_a_header_has_no_offset(printed):
    first = printed.page_of(printed.calibrating_rows(), number=1)
    later = printed.page_of(
        [printed.left_item("Running title", 70.0, 40.0)]
        + printed.calibrating_rows(100.0, first_position=5),
        number=2,
    )
    positions = assemble_rows(printed.statement_of(first, later))["unattached_other_positions"]
    assert positions == [{"page": 2, "offset_from_header": None}]


def test_other_positions_hold_no_text(printed):
    first = printed.page_of(printed.calibrating_rows(), number=1)
    later = printed.page_of(
        [printed.left_item("PLANTED TITLE", 70.0, 40.0)]
        + printed.calibrating_rows(100.0, first_position=5),
        number=2,
    )
    assembly = assemble_rows(printed.statement_of(first, later))
    assert "PLANTED" not in repr(assembly["unattached_other_positions"])
