"""Build raw transaction rows from statement pages, in print order.

An anchor row starts each row. Other lines attach to details by the printed wrap gap, above or below
the anchor (OQ-03 is open, so both are supported and counted). See ADR 0009.
"""

from dataclasses import dataclass

from mpesa_core.extraction.columns import (
    CLUSTER_TOLERANCE_POINTS,
    LINE_TOLERANCE_POINTS,
    Anchor,
    PrintedLine,
    calibrate_columns,
    find_anchor,
    group_lines,
    is_header_row,
    other_items,
)

WRAP_GAP_POINTS = 6.0
LARGEST_WRAP_GAP_POINTS = WRAP_GAP_POINTS + LINE_TOLERANCE_POINTS
# Items further apart than this read as separate words even with no whitespace item between them.
WORD_GAP_POINTS = 1.0
AMOUNT_FIELDS = ("paid_in", "withdrawn", "balance")


@dataclass(frozen=True)
class _Reading:
    """What every step of reading one page needs."""

    layout: object
    counts: dict
    page_number: int


@dataclass(frozen=True)
class _RowLines:
    """The printed lines of one row, and where its anchor sits on the page."""

    line_index: int
    anchor_line: PrintedLine
    anchor: Anchor
    above: tuple[PrintedLine, ...]
    below: tuple[PrintedLine, ...]


def build_rows(statement_pages):
    """Build raw rows from statement pages.

    Args:
        statement_pages: Pages of positioned text items from the PDF reader.

    Returns:
        One ``RawRow`` per anchor row, in print order. Every field is present; a blank cell is None.
        Never empty: ``calibrate_columns`` raises ``LAYOUT_UNRECOGNIZED`` for a statement with no
        anchor row or a column it cannot calibrate.

    Side Effects:
        None.
    """
    return assemble_rows(statement_pages)["rows"]


def assemble_rows(statement_pages):
    """Build raw rows and count everything met along the way.

    Args:
        statement_pages: Pages of positioned text items from the PDF reader.

    Returns:
        A ``RowAssembly``: the rows, how many printed lines each used, and the layout counts.
        Never empty: ``calibrate_columns`` raises ``LAYOUT_UNRECOGNIZED`` when it cannot read one.

    Side Effects:
        None.
    """
    layout = calibrate_columns(statement_pages)
    counts = {
        "continuation_lines_above": 0,
        "continuation_lines_below": 0,
        "ambiguous_continuation_lines": 0,
        "status_from_non_anchor_line": 0,
        "unassigned_items": 0,
        "unattached_lines": 0,
        "unattached_header_lines": 0,
        "unattached_footer_lines": 0,
        "unattached_summary_lines": 0,
        "unattached_other_lines": 0,
        "anchor_cells_off_column": 0,
    }
    rows = []
    printed_line_counts = []
    for position, page in enumerate(statement_pages["pages"]):
        reading = _Reading(layout, counts, page["page_number"])
        for row_lines in _row_lines_on_page(page, reading, is_first_page=position == 0):
            rows.append(_read_row(row_lines, reading))
            printed_line_counts.append(1 + len(row_lines.above) + len(row_lines.below))
    return {"rows": rows, "printed_line_counts": printed_line_counts, "layout_counts": counts}


def _row_lines_on_page(page, reading, *, is_first_page):
    """Divide one page's lines into rows, leaving out everything that belongs to no row.

    Args:
        page: One page of positioned text items.
        reading: The page's calibration and counts.
        is_first_page: Whether this page holds the statement summary.

    Returns:
        The ``_RowLines`` of each row on the page, in print order.

    Side Effects:
        Adds to the unattached and ambiguous counts.
    """
    numbered_lines = _numbered_lines(page)
    segments = _segments_between_headers(numbered_lines)
    if is_first_page:
        segments = _without_summary(segments)
    found = []
    used_indexes = set()
    for segment in segments:
        for block in _blocks_of_touching_lines(segment):
            block_rows = _rows_in_block(block, reading.counts)
            found += block_rows
            used_indexes.update(index for index, _ in block if block_rows)
    _count_lines_outside_rows(numbered_lines, used_indexes, reading.counts, is_first_page)
    return found


def _count_lines_outside_rows(numbered_lines, used_indexes, counts, is_first_page):
    """Count the lines that belong to no row, by what they most likely are.

    A header row is a header. On page 1, a line above the first anchor is summary, or above the
    first header row when the page has no anchor. A line below the page's last row, or below its
    last header row when it has no rows, is a footer. Anything else is other, which a statement
    of the expected layout never has.

    Args:
        numbered_lines: Tuples of line index and line for the whole page.
        used_indexes: Indexes of the lines that belong to a row.
        counts: Layout counts to add to.
        is_first_page: Whether this page holds the statement summary.

    Side Effects:
        Adds to the unattached counts; ``unattached_lines`` is the sum of the four kinds.
    """
    headers = [line.top for _, line in numbered_lines if is_header_row(line)]
    row_tops = [line.top for index, line in numbered_lines if index in used_indexes]
    summary_end = _first_anchor_top(numbered_lines, default=min(headers, default=None))
    footer_start = max(row_tops, default=max(headers, default=None))
    for index, line in numbered_lines:
        if index in used_indexes:
            continue
        kind = _kind_of_line_outside_rows(line, is_first_page, summary_end, footer_start)
        counts[f"unattached_{kind}_lines"] += 1
        counts["unattached_lines"] += 1


def _first_anchor_top(numbered_lines, default):
    """Find the top of the first anchor row on a page.

    Args:
        numbered_lines: Tuples of line index and line.
        default: What to return when the page has no anchor row.

    Returns:
        The top, in points, or the default.

    Side Effects:
        None.
    """
    return next((line.top for _, line in numbered_lines if find_anchor(line)), default)


def _kind_of_line_outside_rows(line, is_first_page, summary_end, footer_start):
    """Name what a line outside every row most likely is.

    Args:
        line: The printed line.
        is_first_page: Whether this page holds the statement summary.
        summary_end: Top of the first anchor, or of the first header row; None if neither.
        footer_start: Top of the last row line, or of the last header row; None if neither.

    Returns:
        ``header``, ``summary``, ``footer`` or ``other``.

    Side Effects:
        None.
    """
    if is_header_row(line):
        return "header"
    if is_first_page and (summary_end is None or line.top < summary_end):
        return "summary"
    if footer_start is not None and line.top > footer_start:
        return "footer"
    return "other"


def _numbered_lines(page):
    """Number a page's printed lines from the top.

    Args:
        page: One page of positioned text items.

    Returns:
        Tuples of zero-based line index and line.

    Side Effects:
        None.
    """
    return list(enumerate(group_lines(page)))


def _segments_between_headers(numbered_lines):
    """Split a page at its header rows, which are dropped.

    A header row is a barrier: nothing above it can continue a row below it.

    Args:
        numbered_lines: Tuples of line index and line.

    Returns:
        Lists of numbered lines. The first holds what is above any header row, and may be empty.

    Side Effects:
        None.
    """
    segments = [[]]
    for numbered in numbered_lines:
        if is_header_row(numbered[1]):
            segments.append([])
        else:
            segments[-1].append(numbered)
    return segments


def _without_summary(segments):
    """Remove the statement summary from the first page.

    Everything before the first anchor is summary, except lines between a header row and that
    anchor: with a header as the barrier they can only be a continuation above it.

    Args:
        segments: The first page's segments.

    Returns:
        The segments from the one holding the first anchor onwards, or nothing if none holds one.

    Side Effects:
        None.
    """
    for position, segment in enumerate(segments):
        first_anchor = next(
            (index for index, (_, line) in enumerate(segment) if find_anchor(line)), None
        )
        if first_anchor is not None:
            kept = segment if position > 0 else segment[first_anchor:]
            return [kept, *segments[position + 1 :]]
    return []


def _blocks_of_touching_lines(segment):
    """Group lines that sit within the wrap gap of the line above.

    Args:
        segment: Numbered lines with no header row among them.

    Returns:
        Lists of numbered lines.

    Side Effects:
        None.
    """
    blocks = []
    for numbered in segment:
        if blocks and numbered[1].top - blocks[-1][-1][1].top <= LARGEST_WRAP_GAP_POINTS:
            blocks[-1].append(numbered)
        else:
            blocks.append([numbered])
    return blocks


def _rows_in_block(block, counts):
    """Share a block's lines among its anchors.

    Args:
        block: Numbered lines, each touching the next.
        counts: Layout counts to add to.

    Returns:
        The ``_RowLines`` of each anchor in the block. A block with no anchor gives none.

    Side Effects:
        Adds to the ambiguous count for a line between two anchors, which goes below the upper
        anchor as the plan's default. A block with no anchor is counted by the caller.
    """
    anchor_positions = [
        position for position, (_, line) in enumerate(block) if find_anchor(line) is not None
    ]
    if not anchor_positions:
        return []
    found = []
    for rank, position in enumerate(anchor_positions):
        line_index, line = block[position]
        next_anchor = anchor_positions[rank + 1] if rank + 1 < len(anchor_positions) else len(block)
        counts["ambiguous_continuation_lines"] += (
            next_anchor - position - 1 if rank + 1 < len(anchor_positions) else 0
        )
        above = block[:position] if rank == 0 else []
        found.append(
            _RowLines(
                line_index,
                line,
                find_anchor(line),
                tuple(entry[1] for entry in above),
                tuple(entry[1] for entry in block[position + 1 : next_anchor]),
            )
        )
    return found


def _read_row(row_lines, reading):
    """Read one row's cells.

    Args:
        row_lines: The row's printed lines.
        reading: The page's calibration and counts.

    Returns:
        The ``RawRow``.

    Side Effects:
        Adds to the layout counts.
    """
    cells = _read_anchor_cells(row_lines, reading)
    above = [_read_continuation(line, cells, reading) for line in row_lines.above]
    below = [_read_continuation(line, cells, reading) for line in row_lines.below]
    reading.counts["continuation_lines_above"] += sum(bool(text) for text in above)
    reading.counts["continuation_lines_below"] += sum(bool(text) for text in below)
    leading_text = row_lines.anchor.trailing_text
    anchor_details = _join_items(cells["details"], row_lines.anchor_line.spaces)
    details = " ".join(part for part in (*above, leading_text, anchor_details, *below) if part)
    return {
        "receipt_no": row_lines.anchor.receipt_item["text"].strip(),
        "completion_time": row_lines.anchor.completion_time,
        "details": details or None,
        "status": _join_items(cells["status"], row_lines.anchor_line.spaces) or None,
        **{
            field: _join_items(cells[field], row_lines.anchor_line.spaces) or None
            for field in AMOUNT_FIELDS
        },
        "page": reading.page_number,
        "line": row_lines.line_index,
    }


def _read_anchor_cells(row_lines, reading):
    """Sort an anchor line's items into their columns.

    Args:
        row_lines: The row's printed lines.
        reading: The page's calibration and counts.

    Returns:
        Map of field name to the items in that cell.

    Side Effects:
        Adds to the off-column and unassigned counts: an item that fits no column stays out of the
        row, and the count is what reports it.
    """
    layout, counts = reading.layout, reading.counts
    anchor = row_lines.anchor
    counts["anchor_cells_off_column"] += _is_off(anchor.receipt_item["x0"], layout.receipt)
    counts["anchor_cells_off_column"] += _is_off(anchor.time_items[0]["x0"], layout.time)
    cells = {"details": [], "status": [], **{field: [] for field in AMOUNT_FIELDS}}
    for text_item in other_items(row_lines.anchor_line, anchor):
        field = _field_of_anchor_item(text_item, layout)
        if field is None or (field != "details" and cells[field]):
            counts["unassigned_items"] += 1
        else:
            cells[field].append(text_item)
    return cells


def _field_of_anchor_item(text_item, layout):
    """Find the column an anchor line's item belongs to.

    Args:
        text_item: The text item.
        layout: The calibrated positions.

    Returns:
        The field name, or None if the item fits no column.

    Side Effects:
        None.
    """
    if _is_in_details_column(text_item, layout):
        return "details"
    if not _is_off(text_item["x0"], layout.status):
        return "status"
    for field in AMOUNT_FIELDS:
        if not _is_off(text_item["x1"], getattr(layout, field)):
            return field
    return None


def _read_continuation(line, cells, reading):
    """Read a line with no anchor, which can only add to its row's details.

    A status-aligned item fills the status only when the anchor printed none, and that is counted.
    Otherwise status never takes text from a line like this, whatever its position.

    Args:
        line: The printed line.
        cells: The row's cells so far; ``status`` may be filled in.
        reading: The page's calibration and counts.

    Returns:
        The text this line adds to details; empty if it adds none.

    Side Effects:
        Adds to the status and unassigned counts, and may fill ``cells["status"]``.
    """
    layout, counts = reading.layout, reading.counts
    details_items = []
    for text_item in line.items:
        if _is_in_details_column(text_item, layout):
            details_items.append(text_item)
        elif not _is_off(text_item["x0"], layout.status) and not cells["status"]:
            cells["status"].append(text_item)
            counts["status_from_non_anchor_line"] += 1
        else:
            counts["unassigned_items"] += 1
    return _join_items(details_items, line.spaces)


def _is_in_details_column(text_item, layout):
    """Tell whether an item starts in the details column.

    Args:
        text_item: The text item.
        layout: The calibrated positions.

    Returns:
        True if it starts at or after the details column and before the status column. Where it
        ends does not matter, because long text can overrun into the next column.

    Side Effects:
        None.
    """
    left_edge = layout.details - CLUSTER_TOLERANCE_POINTS
    return left_edge <= text_item["x0"] < layout.status - CLUSTER_TOLERANCE_POINTS


def _is_off(position, column_position):
    """Tell whether a position misses a calibrated column.

    Args:
        position: The position, in points.
        column_position: The column's calibrated position.

    Returns:
        True if it is further away than the cluster tolerance.

    Side Effects:
        None.
    """
    return abs(position - column_position) > CLUSTER_TOLERANCE_POINTS


def _join_items(items, spaces):
    """Assemble one cell's text from its items.

    Args:
        items: The cell's visible items.
        spaces: Whitespace-only items printed on the same line.

    Returns:
        The text with spacing collapsed and no surrounding whitespace; empty if there is none.

    Side Effects:
        None.
    """
    ordered = sorted(items, key=lambda entry: entry["x0"])
    pieces = []
    for position, text_item in enumerate(ordered):
        if position and _has_word_gap(ordered[position - 1], text_item, spaces):
            pieces.append(" ")
        pieces.append(text_item["text"])
    return " ".join("".join(pieces).split())


def _has_word_gap(left, right, spaces):
    """Tell whether two neighbouring items are separate words.

    Args:
        left: The item on the left.
        right: The item on the right.
        spaces: Whitespace-only items printed on the same line.

    Returns:
        True if the items are far apart, or a whitespace item starts between them.

    Side Effects:
        None.
    """
    if right["x0"] - left["x1"] > WORD_GAP_POINTS:
        return True
    return any(left["x0"] < space["x0"] <= right["x0"] for space in spaces)
