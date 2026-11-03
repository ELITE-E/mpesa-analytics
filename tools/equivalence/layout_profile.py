#!/usr/bin/env python3
"""Print aggregate layout measurements of a statement PDF, and never any of its text.

Used on the owner's machine to compare a real statement's layout with the synthetic generator's
(docs/CODING_STANDARDS.md, 9.5 and 12.5). Output is fixed labels and numbers. The PDF's path is
never printed either, because a statement is often named after a phone number.

If the PDF needs a password, the tool asks for it with a hidden prompt. It never takes one from
the command line or the environment, where it could end up in shell history or process listings.
"""

import argparse
import getpass
import logging
import re
import statistics
import sys
from pathlib import Path

import pdfplumber
from pdfminer.pdfdocument import PDFPasswordIncorrect
from pdfminer.pdfparser import PDFSyntaxError
from pdfplumber.utils.exceptions import PdfminerException

CANNOT_READ = 2
PASSWORD_PROMPT = "PDF password: "
# First word of each header label, in print order.
HEADER_FIRST_WORDS = (
    "Receipt",
    "Completion",
    "Details",
    "Transaction",
    "Paid",
    "Withdrawn",
    "Balance",
)
DETAILS_COLUMN = 2
DATE_WORD = re.compile(r"^\d{4}-\d{2}-\d{2}$")
RECEIPT_WORD = re.compile(r"^(?=[A-Z0-9]*\d)[A-Z0-9]{8,14}$")
SAME_LINE_POINTS = 1.0
# Tighter than the default, which merges a split date and time into one word.
WORD_GAP_POINTS = 1.5
WRAPPED_LINE_MAX_POINTS = 7.5
CLUSTER_POINTS = 1.0
CLUSTER_MIN_SHARE = 0.05
DECILES = 10
FIRST_DECILE = 0
LAST_DECILE = 8


def main():
    """Profile the PDF named on the command line.

    Returns:
        Process exit code: 0 on success, 2 if the PDF cannot be read.

    Side Effects:
        Reads the PDF and an environment variable, and writes aggregates to stdout.
    """
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("pdf_path", type=Path)
    args = parser.parse_args()
    # pdfminer can log fragments of the file it is reading.
    logging.disable(logging.CRITICAL)
    try:
        sizes, pages = _read_statement(args.pdf_path)
    except (OSError, PdfminerException, PDFSyntaxError, EOFError) as error:
        # Only the type: a message from the parser could quote the file or its path.
        print(f"layout_profile: ERROR (cannot read PDF: {type(error).__name__})")
        return CANNOT_READ
    for label, value in build_profile(sizes, pages).items():
        print(f"{label}: {value}")
    return 0


def _read_statement(pdf_path):
    """Read a PDF's page sizes and lines, asking for a password only if it needs one.

    Args:
        pdf_path: Path of the PDF.

    Returns:
        Tuple of each page's width and height, and each page's lines.

    Raises:
        PdfminerException: If the PDF is unreadable, or the password is wrong or missing.

    Side Effects:
        Reads the PDF. If it is encrypted, prompts and reads a password.
    """
    try:
        return _read_with_password(pdf_path, "")
    except PdfminerException as error:
        if not _needs_password(error):
            raise
    return _read_with_password(pdf_path, _ask_for_password())


def _read_with_password(pdf_path, password):
    """Open a PDF and extract what the profile needs.

    Args:
        pdf_path: Path of the PDF.
        password: Password to open it with; empty for none.

    Returns:
        Tuple of each page's width and height, and each page's lines.

    Side Effects:
        Reads the PDF.
    """
    with pdfplumber.open(pdf_path, password=password) as pdf:
        sizes = [(page.width, page.height) for page in pdf.pages]
        return sizes, [_page_lines(page) for page in pdf.pages]


def _needs_password(error):
    """Tell a PDF that needs a password from one that is simply unreadable.

    Args:
        error: The exception pdfplumber raised.

    Returns:
        True if the PDF rejected the empty password.

    Side Effects:
        None.
    """
    return any(isinstance(cause, PDFPasswordIncorrect) for cause in error.args)


def _ask_for_password():
    """Ask for the PDF's password, hidden when typed at a terminal.

    ``getpass`` reads from the terminal even when stdin is piped, so piped input is read directly.

    Returns:
        The password, without its line ending; empty if stdin has nothing.

    Side Effects:
        Writes a prompt to the terminal or stderr, never stdout, and reads the password.
    """
    if sys.stdin.isatty():
        return getpass.getpass(PASSWORD_PROMPT)
    sys.stderr.write(PASSWORD_PROMPT)
    sys.stderr.flush()
    return sys.stdin.readline().rstrip("\r\n")


def build_profile(sizes, pages):
    """Reduce a statement's lines to aggregate measurements.

    Args:
        sizes: Width and height of each page.
        pages: For each page, its lines; a line is a list of word maps.

    Returns:
        Map of fixed label to a string of numbers.

    Side Effects:
        None.
    """
    pitches = _line_pitches(pages)
    anchors = [line for lines in pages for line in lines if _is_anchor_row(line)]
    header_x0s = _header_x0s(pages)
    bounds = _column_bounds(header_x0s)
    offsets = _header_offsets(anchors, header_x0s, bounds)
    return {
        "page_count": str(len(sizes)),
        "page_size": _page_size_text(sizes),
        "line_pitch_median": _number(statistics.median(pitches)) if pitches else "0",
        "line_pitch_spread": _number(_spread(pitches)),
        "header_to_data_x0_offset_by_column": ", ".join(_number(offset) for offset in offsets),
        "header_to_data_x0_offset_max": _number(max(map(abs, offsets), default=0.0)),
        "column_x0_clusters": _cluster_text(_column_edges(anchors, bounds, "x0")),
        "column_x1_clusters": _cluster_text(_column_edges(anchors, bounds, "x1")),
        "receipt_length_histogram": _receipt_histogram(anchors),
        "anchor_row_count": str(len(anchors)),
        "multi_line_row_share": _number(_multi_line_share(pages, len(anchors))),
    }


def _page_lines(page):
    """Group a page's words into lines by their vertical position.

    Args:
        page: A pdfplumber page.

    Returns:
        Lines from top to bottom; each is a list of word maps from left to right.

    Side Effects:
        Reads the page content.
    """
    lines = []
    for word in sorted(
        page.extract_words(x_tolerance=WORD_GAP_POINTS),
        key=lambda entry: (entry["top"], entry["x0"]),
    ):
        if lines and abs(lines[-1][0]["top"] - word["top"]) <= SAME_LINE_POINTS:
            lines[-1].append(word)
        else:
            lines.append([word])
    return [sorted(line, key=lambda word: word["x0"]) for line in lines]


def _is_anchor_row(line):
    """Recognize a line holding both a receipt number and a date.

    Args:
        line: Word maps of one line.

    Returns:
        True if this line starts a transaction row.

    Side Effects:
        None.
    """
    texts = [word["text"] for word in line]
    has_date = any(DATE_WORD.match(text) for text in texts)
    return has_date and any(RECEIPT_WORD.match(text) for text in texts)


def _is_header_row(line):
    """Recognize the row of column labels.

    Args:
        line: Word maps of one line.

    Returns:
        True if every header label's first word is on this line.

    Side Effects:
        None.
    """
    texts = {word["text"] for word in line}
    return all(first_word in texts for first_word in HEADER_FIRST_WORDS)


def _line_pitches(pages):
    """Measure the vertical distance between neighbouring lines.

    Args:
        pages: For each page, its lines.

    Returns:
        Distances in points, across all pages.

    Side Effects:
        None.
    """
    pitches = []
    for lines in pages:
        tops = [line[0]["top"] for line in lines]
        pitches += [lower - upper for upper, lower in zip(tops, tops[1:], strict=False)]
    return pitches


def _spread(values):
    """Measure the distance between the first and last deciles.

    Args:
        values: The measurements.

    Returns:
        The spread in points, or zero with too few values.

    Side Effects:
        None.
    """
    if len(values) < DECILES:
        return 0.0
    cuts = statistics.quantiles(values, n=DECILES)
    return cuts[LAST_DECILE] - cuts[FIRST_DECILE]


def _header_x0s(pages):
    """Find the left edge of each header label.

    Args:
        pages: For each page, its lines.

    Returns:
        One position per column, or an empty list if no header row was found.

    Side Effects:
        None.
    """
    header = next((line for lines in pages for line in lines if _is_header_row(line)), None)
    if header is None:
        return []
    return [
        next(word["x0"] for word in header if word["text"] == first_word)
        for first_word in HEADER_FIRST_WORDS
    ]


def _column_bounds(header_x0s):
    """Work out where each column starts, as midway between neighbouring header labels.

    Args:
        header_x0s: Left edge of each header label; may be empty.

    Returns:
        Left boundary of each column; the first is unbounded.

    Side Effects:
        None.
    """
    pairs = zip(header_x0s, header_x0s[1:], strict=False)
    return [float("-inf"), *((left + right) / 2 for left, right in pairs)]


def _header_offsets(anchors, header_x0s, bounds):
    """Measure how far each column's data starts from its header label.

    Args:
        anchors: Word maps of each anchor row.
        header_x0s: Left edge of each header label; may be empty.
        bounds: Left boundary of each column.

    Returns:
        Median of data x0 minus header x0 for each column, or an empty list with no header row.

    Side Effects:
        None.
    """
    if not header_x0s:
        return []
    starts = [[] for _ in header_x0s]
    for line in anchors:
        for column, words in _words_by_column(line, bounds).items():
            starts[column].append(words[0]["x0"])
    return [
        statistics.median(column_starts) - header_x0 if column_starts else 0.0
        for column_starts, header_x0 in zip(starts, header_x0s, strict=True)
    ]


def _column_edges(anchors, bounds, edge):
    """Collect where each column's text starts or ends, ignoring words in the middle.

    Args:
        anchors: Word maps of each anchor row.
        bounds: Left boundary of each column.
        edge: ``x0`` for the first word's left edge, ``x1`` for the last word's right edge.

    Returns:
        The positions.

    Side Effects:
        None.
    """
    word_index = 0 if edge == "x0" else -1
    return [
        words[word_index][edge]
        for line in anchors
        for words in _words_by_column(line, bounds).values()
    ]


def _words_by_column(line, bounds):
    """Sort one row's words into columns.

    Args:
        line: Word maps of a row, left to right.
        bounds: Left boundary of each column.

    Returns:
        Map of column index to its words, left to right.

    Side Effects:
        None.
    """
    columns = {}
    for word in line:
        column = sum(word["x0"] >= bound for bound in bounds) - 1
        columns.setdefault(column, []).append(word)
    return columns


def _multi_line_share(pages, anchor_count):
    """Measure the share of rows whose details continue on another line.

    Args:
        pages: For each page, its lines.
        anchor_count: Number of anchor rows.

    Returns:
        A share between 0 and 1.

    Side Effects:
        None.
    """
    if not anchor_count:
        return 0.0
    wrapped = 0
    for lines in pages:
        for upper, lower in zip(lines, lines[1:], strict=False):
            close = lower[0]["top"] - upper[0]["top"] <= WRAPPED_LINE_MAX_POINTS
            wrapped += _is_anchor_row(upper) and close and not _is_anchor_row(lower)
    return wrapped / anchor_count


def _page_size_text(sizes):
    """Describe the page size, or each distinct size if they differ.

    Args:
        sizes: Width and height of each page.

    Returns:
        Text such as ``595 x 848``.

    Side Effects:
        None.
    """
    distinct = sorted(set(sizes))
    return ", ".join(f"{_number(width)} x {_number(height)}" for width, height in distinct)


def _cluster_text(positions):
    """Find the positions where columns repeatedly start or end.

    Args:
        positions: Edge positions, one per column per anchor row.

    Returns:
        Bracketed list of cluster centers, ignoring positions used by under 5% of them.

    Side Effects:
        None.
    """
    clusters = []
    for position in sorted(positions):
        if clusters and position - clusters[-1][-1] <= CLUSTER_POINTS:
            clusters[-1].append(position)
        else:
            clusters.append([position])
    minimum = max(1.0, len(positions) * CLUSTER_MIN_SHARE)
    centers = [statistics.median(group) for group in clusters if len(group) >= minimum]
    return "[" + ", ".join(_number(center) for center in centers) + "]"


def _receipt_histogram(anchors):
    """Count receipt numbers by length.

    Args:
        anchors: Word maps of each anchor row.

    Returns:
        Text such as ``{10: 60}``.

    Side Effects:
        None.
    """
    lengths = {}
    for line in anchors:
        receipt = next(word["text"] for word in line if RECEIPT_WORD.match(word["text"]))
        lengths[len(receipt)] = lengths.get(len(receipt), 0) + 1
    return "{" + ", ".join(f"{length}: {lengths[length]}" for length in sorted(lengths)) + "}"


def _number(value):
    """Format a measurement.

    Args:
        value: The number.

    Returns:
        The number rounded to two decimals, without trailing zeros.

    Side Effects:
        None.
    """
    return f"{value:.2f}".rstrip("0").rstrip(".")


if __name__ == "__main__":
    sys.exit(main())
