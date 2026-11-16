"""Read the page 1 summary block: seven transaction type rows and a TOTAL row (CP7a-3).

The block runs from a line reading only ``SUMMARY`` up to one reading only ``DETAILED STATEMENT``.
Lines above it hold the customer's name, number and email, so nothing outside it is read. Each row
prints as ``LABEL: paid_in paid_out``. A row that is missing or cannot be read is counted, never
guessed. The type rows are not used to check row types (v1.1).
"""

from mpesa_core.extraction.columns import group_lines, is_amount_text

SUMMARY_MARKER = "SUMMARY"
DETAIL_MARKER = "DETAILED STATEMENT"
TYPE_LABELS = (
    "SEND MONEY",
    "RECEIVED MONEY",
    "AGENT DEPOSIT",
    "AGENT WITHDRAWAL",
    "LIPA NA M-PESA (PAYBILL)",
    "LIPA NA M-PESA (BUY GOODS)",
    "OTHERS",
)
TOTAL_LABEL = "TOTAL"
LABEL_END = ":"
AMOUNTS_PER_ROW = 2


def summary_block_lines(statement_pages):
    """Give the text of page 1's summary block, from its first marker up to its second.

    Args:
        statement_pages: The statement's positioned text.

    Returns:
        Each line's items joined by a space, top to bottom, starting with the ``SUMMARY`` line and
        stopping before the ``DETAILED STATEMENT`` line; None if either marker is missing.

    Side Effects:
        None.
    """
    if not statement_pages["pages"]:
        return None
    texts = [_line_text(line) for line in group_lines(statement_pages["pages"][0])]
    folded = [text.casefold() for text in texts]
    if SUMMARY_MARKER.casefold() not in folded:
        return None
    start = folded.index(SUMMARY_MARKER.casefold())
    if DETAIL_MARKER.casefold() not in folded[start:]:
        return None
    return texts[start : folded.index(DETAIL_MARKER.casefold(), start)]


def read_summary_block(statement_pages):
    """Read the TOTAL row and count the type rows that can be read.

    Args:
        statement_pages: The statement's positioned text.

    Returns:
        ``total_paid_in`` and ``total_paid_out``, each None if the TOTAL row is missing or cannot
        be read, and ``type_rows_parsed``: how many of the seven type rows were read.

    Side Effects:
        None.
    """
    found = {}
    for text in summary_block_lines(statement_pages) or []:
        label, amounts = _read_row(text)
        if label is not None:
            found.setdefault(label, amounts)
    total = found.get(TOTAL_LABEL, (None, None))
    return {
        "total_paid_in": total[0],
        "total_paid_out": total[1],
        "type_rows_parsed": sum(label in found for label in TYPE_LABELS),
    }


def _line_text(line):
    """Join a line's items, with runs of spaces made single.

    Args:
        line: A printed line.

    Returns:
        The line's text.

    Side Effects:
        None.
    """
    return " ".join(" ".join(text_item["text"] for text_item in line.items).split())


def _read_row(text):
    """Read one summary row: a known label, an optional colon, then exactly two amounts.

    Args:
        text: The line's text.

    Returns:
        Tuple of the label and its two amounts, or of None and None if the line is not a row that
        can be read.

    Side Effects:
        None.
    """
    for label in (*TYPE_LABELS, TOTAL_LABEL):
        if not text.casefold().startswith(label.casefold()):
            continue
        rest = text[len(label) :]
        if rest[:1] not in (LABEL_END, " "):
            continue
        cells = rest.removeprefix(LABEL_END).split()
        if len(cells) == AMOUNTS_PER_ROW and all(is_amount_text(cell) for cell in cells):
            return label, tuple(float(cell.replace(",", "")) for cell in cells)
        return None, None
    return None, None
