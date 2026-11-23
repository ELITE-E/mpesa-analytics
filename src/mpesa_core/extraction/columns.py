"""Column calibration: derive column positions from a statement's anchor rows.

Positions come from anchor rows only, because a header label can sit up to 38 points from its
data. Header labels confirm the order of the columns and nothing else. See ADR 0009.
"""

import re
from dataclasses import dataclass

from mpesa_core.contracts import TextItem
from mpesa_core.errors import ErrorCode, ExtractionError

RECEIPT_PATTERN = re.compile(r"[A-Z0-9]{10}")
DATE_TIME_PATTERN = re.compile(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}")
DATE_PATTERN = re.compile(r"\d{4}-\d{2}-\d{2}")
CLOCK_PATTERN = re.compile(r"\d{2}:\d{2}:\d{2}")
AMOUNT_PATTERN = re.compile(r"-?\d[\d,]*(\.\d+)?")
LINE_TOLERANCE_POINTS = 1.0
CLUSTER_TOLERANCE_POINTS = 0.5
MINIMUM_AMOUNT_VALUES = 2
AMOUNT_COLUMN_COUNT = 3
# A money column printed once or never is placed by the header's label spacing (D-10): an amount
# cluster's distance from balance must match a label's distance from the balance label within this
# share of the smaller spacing. Header labels are offset from their data, but the same way for each.
SPACING_TOLERANCE_SHARE = 0.25
MONEY_LABELS = (("paid_in", "paid"), ("withdrawn", "withdrawn"))
BALANCE_WORD = "balance"
# First word of each header label, in print order.
HEADER_FIRST_WORDS = (
    "receipt",
    "completion",
    "details",
    "transaction",
    "paid",
    "withdrawn",
    "balance",
)


@dataclass(frozen=True)
class PrintedLine:
    """One printed line of a page: its visible items, and the whitespace kept for assembly."""

    top: float
    bottom: float
    items: tuple[TextItem, ...]
    spaces: tuple[TextItem, ...]


@dataclass(frozen=True)
class Anchor:
    """The cells that make a printed line an anchor row."""

    receipt_item: TextItem
    time_items: tuple[TextItem, ...]
    completion_time: str
    trailing_text: str


@dataclass(frozen=True)
class ColumnLayout:
    """Calibrated positions: left edges for text columns, right edges for amount columns."""

    receipt: float
    time: float
    details: float
    status: float
    paid_in: float
    withdrawn: float
    balance: float


def calibrate_columns(statement_pages):
    """Derive the column positions of one statement from its anchor rows.

    Args:
        statement_pages: Pages of positioned text items from the PDF reader.

    Returns:
        The calibrated positions, shared by every page of the statement.

    Raises:
        ExtractionError: ``LAYOUT_UNRECOGNIZED`` if there is no anchor row, a printed header row
            has its labels out of order, or a column cannot be calibrated; ``TOO_FEW_AMOUNTS``
            if no money column printed, or one printed fewer than twice and no header row can
            place it (D-10).

    Side Effects:
        None.
    """
    lines = [line for page in statement_pages["pages"] for line in group_lines(page)]
    anchored = [(line, anchor) for line in lines if (anchor := find_anchor(line))]
    if not anchored:
        raise ExtractionError(ErrorCode.LAYOUT_UNRECOGNIZED)
    _confirm_header_order(lines)
    other_cells = [other_items(line, anchor) for line, anchor in anchored]
    text_cells = [
        [text_item for text_item in items if not is_amount_text(text_item["text"])]
        for items in other_cells
    ]
    status = _position_of([cells[-1]["x0"] for cells in text_cells if cells])
    layout = ColumnLayout(
        _position_of([anchor.receipt_item["x0"] for _, anchor in anchored]),
        _position_of([anchor.time_items[0]["x0"] for _, anchor in anchored]),
        _position_of([cells[0]["x0"] for cells in text_cells if len(cells) > 1]),
        status,
        *_amount_positions(other_cells, status, _header_spacing(lines)),
    )
    _confirm_left_to_right(layout)
    return layout


def group_lines(page):
    """Group a page's text items into printed lines, top to bottom.

    Whitespace-only items never start a line. pdf.js gives them no height, so their top sits on the
    text's baseline, about where the next wrapped line would be.

    Args:
        page: One page of positioned text items.

    Returns:
        The lines in print order, each with its visible items read left to right. A whitespace
        item is kept on the line whose top or baseline it matches, for text assembly only.

    Side Effects:
        None.
    """
    visible = [text_item for text_item in page["items"] if text_item["text"].strip()]
    groups = []
    for text_item in sorted(visible, key=lambda text_item: text_item["top"]):
        if groups and text_item["top"] - groups[-1][0]["top"] <= LINE_TOLERANCE_POINTS:
            groups[-1].append(text_item)
        else:
            groups.append([text_item])
    spaces = [text_item for text_item in page["items"] if not text_item["text"].strip()]
    return [_printed_line(group, spaces) for group in groups]


def find_anchor(line):
    """Recognize an anchor row: a full receipt number and a completion time on one line.

    Args:
        line: The printed line.

    Returns:
        The anchor's cells, or None if the line is not an anchor row.

    Side Effects:
        None.
    """
    receipt_item = next(
        (
            text_item
            for text_item in line.items
            if RECEIPT_PATTERN.fullmatch(text_item["text"].strip())
        ),
        None,
    )
    time_cell = find_time_cell(line.items)
    if receipt_item is None or time_cell is None:
        return None
    return Anchor(receipt_item, *time_cell)


def is_header_row(line):
    """Tell whether a line holds the printed column titles.

    Args:
        line: The printed line.

    Returns:
        True if every column's first word is on the line, in any order.

    Side Effects:
        None.
    """
    words = _line_words(line)
    return all(word in words for word in HEADER_FIRST_WORDS)


def other_items(line, anchor):
    """List an anchor line's visible items other than its receipt number and time.

    Args:
        line: The anchor line.
        anchor: Its anchor cells.

    Returns:
        The remaining items, left to right.

    Side Effects:
        None.
    """
    used = (anchor.receipt_item, *anchor.time_items)
    return [text_item for text_item in line.items if not any(text_item is cell for cell in used)]


def is_amount_text(text):
    """Tell whether text reads as a printed amount.

    Args:
        text: The printed text.

    Returns:
        True for digits with optional sign, thousands commas and decimals.

    Side Effects:
        None.
    """
    return AMOUNT_PATTERN.fullmatch(text.strip()) is not None


def _printed_line(group, spaces):
    """Build one printed line from its visible items.

    Args:
        group: The line's visible items.
        spaces: Every whitespace-only item on the page.

    Returns:
        The line, with the whitespace items that match its top or baseline.

    Side Effects:
        None.
    """
    top = group[0]["top"]
    bottom = max(text_item["bottom"] for text_item in group)
    return PrintedLine(
        top,
        bottom,
        tuple(sorted(group, key=lambda text_item: text_item["x0"])),
        tuple(
            space
            for space in spaces
            if abs(space["top"] - top) <= LINE_TOLERANCE_POINTS
            or abs(space["top"] - bottom) <= LINE_TOLERANCE_POINTS
        ),
    )


def find_time_cell(items):
    """Find a completion time printed as one item or as a date item and a clock item.

    Args:
        items: A line's visible items, left to right.

    Returns:
        Tuple of the items used, the completion time, and any text after it in the same item; or
        None if the line holds no completion time.

    Side Effects:
        None.
    """
    for position, text_item in enumerate(items):
        text = text_item["text"].strip()
        whole = DATE_TIME_PATTERN.match(text)
        if whole:
            return (text_item,), whole.group(), text[whole.end() :].strip()
        following = items[position + 1 :]
        if DATE_PATTERN.fullmatch(text) and following:
            clock = following[0]["text"].strip()
            if CLOCK_PATTERN.fullmatch(clock):
                return (text_item, following[0]), f"{text} {clock}", ""
    return None


def _confirm_header_order(lines):
    """Check that every printed header row lists the columns in the expected order.

    A statement with no recognizable header row passes: the labels only ever confirm the order.

    Args:
        lines: Every printed line of the statement.

    Raises:
        ExtractionError: ``LAYOUT_UNRECOGNIZED`` if a header row's labels are out of order.

    Side Effects:
        None.
    """
    for line in filter(is_header_row, lines):
        words = _line_words(line)
        positions = [words.index(word) for word in HEADER_FIRST_WORDS]
        if positions != sorted(positions):
            raise ExtractionError(ErrorCode.LAYOUT_UNRECOGNIZED)


def _line_words(line):
    """Read a line as lowercase words, left to right.

    Args:
        line: The printed line.

    Returns:
        Its words.

    Side Effects:
        None.
    """
    return " ".join(text_item["text"] for text_item in line.items).casefold().split()


def _amount_positions(other_cells, status, header_spacing):
    """Calibrate the three right-aligned amount columns from their right edges.

    Three columns each printed at least twice are read left to right as paid in, withdrawn and
    balance, as before; a lone value elsewhere is left out of every column. Otherwise (D-10) the
    rightmost is balance, and the header row's label spacing names each other column printed and
    places a column never printed where no amount lies. A column printed once must be clear of
    every other column and placed by the header where it stands, so a stray number is never taken
    for a column.

    Args:
        other_cells: For each anchor row, its items other than the receipt number and time.
        status: Calibrated left edge of the status column; amounts sit to its right.
        header_spacing: Each money column's label distance from the balance label, or None
            without a header row.

    Returns:
        The right edges of paid in, withdrawn and balance.

    Raises:
        ExtractionError: ``LAYOUT_UNRECOGNIZED`` if no amount prints, more than three positions
            print twice or more, fewer than three do and more than three positions print at all, or
            a column printed once or never cannot be placed consistently.
            ``TOO_FEW_AMOUNTS`` if only the balance prints, or a money column printed fewer than
            twice and there is no header row to place it.

    Side Effects:
        None.
    """
    right_edges = [
        text_item["x1"]
        for items in other_cells
        for text_item in items
        if is_amount_text(text_item["text"]) and text_item["x0"] >= status
    ]
    clusters = _cluster(right_edges)
    full = [cluster for cluster in clusters if len(cluster) >= MINIMUM_AMOUNT_VALUES]
    # Three columns printed at least twice read as before: a lone value elsewhere stays out of
    # every column and is counted when rows are built (ADR 0009), never taken for a column.
    if len(full) == AMOUNT_COLUMN_COUNT:
        return tuple(_middle(cluster) for cluster in full)
    if not clusters or len(clusters) > AMOUNT_COLUMN_COUNT:
        raise ExtractionError(ErrorCode.LAYOUT_UNRECOGNIZED)
    if len(clusters) == 1 or header_spacing is None:
        raise ExtractionError(ErrorCode.TOO_FEW_AMOUNTS)
    placed = _placed_money_columns(clusters, header_spacing, status)
    if placed is None:
        raise ExtractionError(ErrorCode.LAYOUT_UNRECOGNIZED)
    return placed


def _placed_money_columns(clusters, header_spacing, status):
    """Name the money columns by the header's spacing and place any column never printed.

    Args:
        clusters: Amount right-edge clusters, left to right; the last is balance.
        header_spacing: Each money column's label distance from the balance label.
        status: The status column's left edge, which no amount column may touch.

    Returns:
        Paid in, withdrawn and balance right edges, or None if a cluster matches no label, two
        match the same one, they stand out of the labels' order, or a column printed once is
        within the tolerance of another column.

    Side Effects:
        None.
    """
    balance = _middle(clusters[-1])
    named = {}
    for cluster in clusters[:-1]:
        column = _column_at(balance - _middle(cluster), header_spacing)
        if column is None or column in named:
            return None
        named[column] = _middle(cluster)
    if list(named) not in ([], ["paid_in"], ["withdrawn"], ["paid_in", "withdrawn"]):
        return None
    positions = [*named.values(), balance, status]
    for cluster in clusters:
        middle = _middle(cluster)
        others = [position for position in positions if position != middle]
        if len(cluster) < MINIMUM_AMOUNT_VALUES and not all(
            abs(middle - other) > CLUSTER_TOLERANCE_POINTS for other in others
        ):
            return None
    paid_in = named.get("paid_in", balance - header_spacing["paid_in"])
    withdrawn = named.get("withdrawn", balance - header_spacing["withdrawn"])
    return paid_in, withdrawn, balance


def _column_at(distance, header_spacing):
    """The money column whose label stands at this distance from the balance label.

    Args:
        distance: How far left of the balance column an amount cluster stands.
        header_spacing: Each money column's label distance from the balance label.

    Returns:
        ``paid_in`` or ``withdrawn``, or None if neither is within the tolerance.

    Side Effects:
        None.
    """
    tolerance = SPACING_TOLERANCE_SHARE * min(header_spacing.values())
    fits = {
        column: abs(distance - spacing)
        for column, spacing in header_spacing.items()
        if abs(distance - spacing) <= tolerance
    }
    return min(fits, key=fits.get) if fits else None


def _header_spacing(lines):
    """Measure each money column's label distance from the balance label on the first header row.

    Header labels may stand far from their data, but by the same offset, so these distances match
    the distances between the columns' amounts.

    Args:
        lines: Every printed line of the statement.

    Returns:
        ``{"paid_in": ..., "withdrawn": ...}`` in points, or None without a header row.

    Side Effects:
        None.
    """
    header = next(filter(is_header_row, lines), None)
    if header is None:
        return None
    centers = {}
    for text_item in header.items:
        words = text_item["text"].casefold().split()
        if words and words[0] not in centers:
            centers[words[0]] = (text_item["x0"] + text_item["x1"]) / 2
    if BALANCE_WORD not in centers or not all(word in centers for _, word in MONEY_LABELS):
        return None
    return {column: centers[BALANCE_WORD] - centers[word] for column, word in MONEY_LABELS}


def _position_of(values):
    """Calibrate one left-aligned column from the positions seen for it.

    Args:
        values: Positions seen, possibly including rows where the cell is elsewhere.

    Returns:
        The middle of the largest cluster.

    Raises:
        ExtractionError: ``LAYOUT_UNRECOGNIZED`` if no position was seen.

    Side Effects:
        None.
    """
    if not values:
        raise ExtractionError(ErrorCode.LAYOUT_UNRECOGNIZED)
    return _middle(max(_cluster(values), key=len))


def _cluster(values):
    """Group positions so every member is within the tolerance of its cluster's middle.

    Measuring from the middle, rather than linking neighbours, gives the same answer for two values
    at the extremes of the jitter as for many values between them.

    Args:
        values: Positions in points.

    Returns:
        Clusters in ascending order.

    Side Effects:
        None.
    """
    clusters = []
    for value in sorted(values):
        if clusters and value - clusters[-1][0] <= 2 * CLUSTER_TOLERANCE_POINTS:
            clusters[-1].append(value)
        else:
            clusters.append([value])
    return clusters


def _middle(cluster):
    """Find the middle of a cluster.

    Args:
        cluster: Positions in ascending order.

    Returns:
        The point halfway between its ends.

    Side Effects:
        None.
    """
    return (cluster[0] + cluster[-1]) / 2


def _confirm_left_to_right(layout):
    """Check that calibrated columns sit in the printed order.

    Args:
        layout: The calibrated positions.

    Raises:
        ExtractionError: ``LAYOUT_UNRECOGNIZED`` if any column is out of order.

    Side Effects:
        None.
    """
    positions = (
        layout.receipt,
        layout.time,
        layout.details,
        layout.status,
        layout.paid_in,
        layout.withdrawn,
        layout.balance,
    )
    if list(positions) != sorted(positions):
        raise ExtractionError(ErrorCode.LAYOUT_UNRECOGNIZED)
