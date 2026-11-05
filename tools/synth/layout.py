"""Page layout model for synthetic statements. The PDF and the items file both come from this."""

import random
import string
from dataclasses import dataclass

from reportlab.pdfbase.pdfmetrics import stringWidth

PAGE_WIDTH = 595
PAGE_HEIGHT = 848
DATA_FONT = "Helvetica"
HEADER_FONT = "Helvetica-Bold"
DATA_SIZE = 5.5
HEADER_SIZE = 6.0
COLUMN_PADDING = 4.0
# pdf.js merges a date and time closer than this into one text item.
SPLIT_DATETIME_GAP = 8.0
JITTER_POINTS = 0.1
ROW_PITCH = 10.0
WRAP_PITCH = 6.0
FIRST_HEADER_TOP = 40.0
LAST_ROW_TOP = 800.0
FOOTER_X0 = 20.0
FOOTER_PAGE_TOP = 826.0
FOOTER_TOKEN_TOP = 836.0
FOOTER_TOKEN_LENGTH = 8
FOOTER_ALPHABET = string.ascii_uppercase + string.digits
TABLE_X0 = 67.5
SUMMARY_LABEL_X0 = TABLE_X0
SUMMARY_VALUE_X0 = 180.0
BLOCK_PITCH = 10.0
DIGITS_PER_ROUND = 3


@dataclass(frozen=True)
class Column:
    """One table column. Text columns align left; amount columns align right."""

    label: str
    x0: float
    x1: float
    is_amount: bool = False

    @property
    def text_x0(self):
        """Give the left edge that text columns align to.

        Returns:
            The x position in points.

        Side Effects:
            None.
        """
        return self.x0 + COLUMN_PADDING

    @property
    def text_x1(self):
        """Give the right edge that amount columns align to.

        Returns:
            The x position in points.

        Side Effects:
            None.
        """
        return self.x1 - COLUMN_PADDING


@dataclass(frozen=True)
class DrawnText:
    """One piece of text in the model: its position, and the font needed to draw it."""

    text: str
    x0: float
    x1: float
    top: float
    font: str
    size: float


@dataclass(frozen=True)
class LayoutVariant:
    """How a statement departs from the ordinary layout. The defaults change nothing."""

    minimum_pages: int = 0
    jitter_points: float = JITTER_POINTS
    jitter_tops: bool = False
    continuation_above: bool = False


def _build_columns():
    """Lay the seven columns side by side from their widths.

    The details width sets the largest header-to-data offset, which must stay within 38 points.

    Returns:
        The columns, left to right.

    Side Effects:
        None.
    """
    specs = [
        ("Receipt No", 60.0, False),
        ("Completion Time", 76.0, False),
        ("Details", 103.0, False),
        ("Transaction Status", 60.0, False),
        ("Paid In", 52.0, True),
        ("Withdrawn", 52.0, True),
        ("Balance", 56.0, True),
    ]
    columns = []
    left = TABLE_X0
    for label, width, is_amount in specs:
        columns.append(Column(label, left, left + width, is_amount))
        left += width
    return tuple(columns)


COLUMNS = _build_columns()
HEADER_LABELS = tuple(column.label for column in COLUMNS)
RECEIPT, TIME, DETAILS, STATUS, PAID_IN, WITHDRAWN, BALANCE = COLUMNS


def lay_out_statement(printed_rows, summary_lines, *, seed_text, split_datetime, variant=None):
    """Place a statement's text on pages.

    Args:
        printed_rows: Rows in print order, with text for each of the seven columns.
        summary_lines: Tuples of label and value for the block at the top of page 1.
        seed_text: Text that seeds the jitter and footer tokens.
        split_datetime: Whether to print the date and the time as two strings.
        variant: The ``LayoutVariant`` to apply; defaults to the ordinary layout.

    Returns:
        Tuple of pages, each a list of ``DrawnText``, and rows with their ``page`` and ``line``.

    Side Effects:
        None.
    """
    variant = variant or LayoutVariant()
    placer = _Placer(random.Random(seed_text), split_datetime=split_datetime, variant=variant)
    placer.place_summary(summary_lines)
    placed_rows = [placer.place_row(row) for row in printed_rows]
    placer.pad_to(variant.minimum_pages)
    placer.place_footers()
    return placer.pages, placed_rows


def wrap_details(details):
    """Break details text at spaces so it fits its column.

    Args:
        details: Details text.

    Returns:
        One or more lines, none wider than the column unless a single word is.

    Side Effects:
        None.
    """
    limit = DETAILS.text_x1 - DETAILS.text_x0 - 2 * JITTER_POINTS
    lines = []
    current = ""
    for word in details.split(" "):
        candidate = f"{current} {word}" if current else word
        if current and stringWidth(candidate, DATA_FONT, DATA_SIZE) > limit:
            lines.append(current)
            current = word
        else:
            current = candidate
    lines.append(current)
    return lines


class _Placer:
    """Tracks the current page and position while text is placed."""

    def __init__(self, rng, *, split_datetime, variant):
        """Start on an empty first page.

        Args:
            rng: Seeded random source for jitter and footers.
            split_datetime: Whether to print the date and the time as two strings.
            variant: The ``LayoutVariant`` to apply.

        Side Effects:
            None.
        """
        self.rng = rng
        self.split_datetime = split_datetime
        self.variant = variant
        self.pages = [[]]
        self.next_top = FIRST_HEADER_TOP
        self.line = 0

    def place_summary(self, summary_lines):
        """Place the page 1 summary block, then the first header row.

        Args:
            summary_lines: Tuples of label and value.

        Side Effects:
            Adds text to the first page and moves the position down.
        """
        for label, value in summary_lines:
            self._place_left(label, SUMMARY_LABEL_X0, DATA_FONT, DATA_SIZE)
            self._place_left(value, SUMMARY_VALUE_X0, DATA_FONT, DATA_SIZE)
            self.next_top += BLOCK_PITCH
            self.line += 1
        self.next_top += BLOCK_PITCH
        self._place_header()

    def place_row(self, row):
        """Place one row, moving to a new page first if it would not fit.

        Args:
            row: Map holding the text for each column under its label.

        Returns:
            The same map plus the ``page`` and ``line`` it landed on.

        Side Effects:
            Adds text to the current page and moves the position down.
        """
        wrapped = wrap_details(row[DETAILS.label])
        if self.next_top + WRAP_PITCH * (len(wrapped) - 1) > LAST_ROW_TOP:
            self._start_page()
        anchor_offset = len(wrapped) - 1 if self.variant.continuation_above else 0
        placed = {**row, "page": len(self.pages), "line": self.line + anchor_offset}
        first_top = self.next_top
        self.next_top = first_top + WRAP_PITCH * anchor_offset
        self._place_row_columns(row)
        self.next_top = first_top
        for index, text in enumerate(wrapped):
            top = self.next_top + WRAP_PITCH * index
            self._place_left(text, DETAILS.text_x0, DATA_FONT, DATA_SIZE, top=top)
        self.next_top += WRAP_PITCH * (len(wrapped) - 1) + ROW_PITCH
        self.line += len(wrapped)
        return placed

    def pad_to(self, minimum_pages):
        """Add header-only pages until the statement has enough of them.

        Args:
            minimum_pages: The page count to reach.

        Side Effects:
            Adds pages.
        """
        while len(self.pages) < minimum_pages:
            self._start_page()

    def place_footers(self):
        """Add the page number and an 8-character token to every page.

        Side Effects:
            Adds text to every page.
        """
        for number, page in enumerate(self.pages, start=1):
            token = "".join(self._pick_footer_char() for _ in range(FOOTER_TOKEN_LENGTH))
            label = f"Page {number} of {len(self.pages)}"
            page.append(self._left_text(label, FOOTER_X0, FOOTER_PAGE_TOP))
            page.append(self._left_text(token, FOOTER_X0, FOOTER_TOKEN_TOP))

    def _start_page(self):
        """Begin a new page with its header row.

        Side Effects:
            Adds a page and resets the position.
        """
        self.pages.append([])
        self.next_top = FIRST_HEADER_TOP
        self.line = 0
        self._place_header()

    def _place_header(self):
        """Place the seven column labels, each centered over its column.

        Side Effects:
            Adds text to the current page and moves the position down.
        """
        for column in COLUMNS:
            width = stringWidth(column.label, HEADER_FONT, HEADER_SIZE)
            left = (column.x0 + column.x1 - width) / 2
            self._place_left(column.label, left, HEADER_FONT, HEADER_SIZE)
        self.next_top += ROW_PITCH
        self.line += 1

    def _place_row_columns(self, row):
        """Place the single-line columns of a row.

        Args:
            row: Map holding the text for each column under its label.

        Side Effects:
            Adds text to the current page.
        """
        self._place_left(row[RECEIPT.label], RECEIPT.text_x0, DATA_FONT, DATA_SIZE)
        self._place_time(row[TIME.label])
        self._place_left(row[STATUS.label], STATUS.text_x0, DATA_FONT, DATA_SIZE)
        for column in (PAID_IN, WITHDRAWN, BALANCE):
            if row[column.label] is not None:
                self._place_right(row[column.label], column.text_x1)

    def _place_time(self, completion_time):
        """Place the completion time as one string, or two in the split variant.

        Args:
            completion_time: Date and time separated by a space.

        Side Effects:
            Adds text to the current page.
        """
        if self.split_datetime:
            date, clock = completion_time.split(" ")
            date_width = stringWidth(date, DATA_FONT, DATA_SIZE)
            self._place_left(date, TIME.text_x0, DATA_FONT, DATA_SIZE)
            clock_x0 = TIME.text_x0 + date_width + SPLIT_DATETIME_GAP
            self._place_left(clock, clock_x0, DATA_FONT, DATA_SIZE)
        else:
            self._place_left(completion_time, TIME.text_x0, DATA_FONT, DATA_SIZE)

    def _place_left(self, text, x0, font, size, *, top=None):
        """Place text by its left edge, with seeded jitter.

        Args:
            text: Text to place.
            x0: Left edge in points, before jitter.
            font: Font name.
            size: Font size.
            top: Top position in points; defaults to the current position.

        Side Effects:
            Adds text to the current page.
        """
        top = (self.next_top if top is None else top) + self._top_jitter()
        left = round(x0 + self._jitter(), DIGITS_PER_ROUND)
        right = round(left + stringWidth(text, font, size), DIGITS_PER_ROUND)
        self.pages[-1].append(DrawnText(text, left, right, top, font, size))

    def _place_right(self, text, x1):
        """Place an amount by its right edge, with seeded jitter.

        Args:
            text: Text to place.
            x1: Right edge in points, before jitter.

        Side Effects:
            Adds text to the current page.
        """
        right = round(x1 + self._jitter(), DIGITS_PER_ROUND)
        left = round(right - stringWidth(text, DATA_FONT, DATA_SIZE), DIGITS_PER_ROUND)
        top = self.next_top + self._top_jitter()
        self.pages[-1].append(DrawnText(text, left, right, top, DATA_FONT, DATA_SIZE))

    def _left_text(self, text, x0, top):
        """Make footer text, which has no jitter.

        Args:
            text: Text to place.
            x0: Left edge in points.
            top: Top position in points.

        Returns:
            The placed text.

        Side Effects:
            None.
        """
        right = round(x0 + stringWidth(text, DATA_FONT, DATA_SIZE), DIGITS_PER_ROUND)
        return DrawnText(text, x0, right, top, DATA_FONT, DATA_SIZE)

    def _jitter(self):
        """Pick a seeded offset, so positions are never perfectly regular.

        Returns:
            An offset of at most the variant's jitter either way.

        Side Effects:
            None.
        """
        return (self.rng.random() * 2 - 1) * self.variant.jitter_points

    def _top_jitter(self):
        """Pick a seeded vertical offset, only for variants that ask for one.

        Ordinary statements draw no random number here, so their bytes stay as they were.

        Returns:
            An offset in points, rounded for the model; 0.0 for ordinary statements.

        Side Effects:
            None.
        """
        return round(self._jitter(), DIGITS_PER_ROUND) if self.variant.jitter_tops else 0.0

    def _pick_footer_char(self):
        """Pick one footer token character.

        Returns:
            One character.

        Side Effects:
            None.
        """
        return FOOTER_ALPHABET[int(self.rng.random() * len(FOOTER_ALPHABET))]
