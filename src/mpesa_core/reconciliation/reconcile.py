"""Compare parsed rows with the statement summary and the balance chain. Counts only (ADR 0004).

Whether a statement prints newest or oldest first is not assumed: the chain is checked in both
orientations and the one with fewer breaks is recorded. Blank paid in and withdrawn mean zero.
"""

from mpesa_core.extraction.columns import find_anchor, find_time_cell, group_lines, is_amount_text

NEWEST_FIRST = "newest_first"
OLDEST_FIRST = "oldest_first"
CHAIN_TOLERANCE = 0.005
EMPTY_STATUS = ""
TRANSACTION_COUNT_LABEL = "Transaction Count"
TOTAL_PAID_IN_LABEL = "Total Paid In"
TOTAL_WITHDRAWN_LABEL = "Total Withdrawn"
OPENING_BALANCE_LABEL = "Opening Balance"
CLOSING_BALANCE_LABEL = "Closing Balance"
SUMMARY_LABELS = (
    TRANSACTION_COUNT_LABEL,
    TOTAL_PAID_IN_LABEL,
    TOTAL_WITHDRAWN_LABEL,
    OPENING_BALANCE_LABEL,
    CLOSING_BALANCE_LABEL,
)
LABEL_PUNCTUATION = " :"


def reconcile(statement_pages, rows):
    """Measure the quality of a statement's rows.

    Args:
        statement_pages: The statement's positioned text, for its summary and receipt lengths.
        rows: The rows built from those pages, in print order.

    Returns:
        A ``DataQuality`` holding counts and labels only.

    Side Effects:
        None.
    """
    break_counts = {
        orientation: _count_break_kinds(rows, orientation)
        for orientation in (NEWEST_FIRST, OLDEST_FIRST)
    }
    # min keeps the first on a tie, so an undecided statement reads as the usual newest first.
    orientation = min(break_counts, key=lambda name: sum(break_counts[name].values()))
    return {
        "row_count": len(rows),
        "status_counts": _count_statuses(rows),
        "chain_breaks": sum(break_counts[orientation].values()),
        "chain_orientation": orientation,
        "chain_break_counts": break_counts,
        "unparsed_amounts": _count_unparsed_amounts(rows),
        "summary_reconciliation": _reconcile_summary(statement_pages, rows),
        "receipt_length_histogram": _receipt_length_histogram(statement_pages),
    }


def find_chain_breaks(rows, orientation):
    """Find where a balance does not follow from the previous row's.

    A link with an amount that cannot be read proves nothing, so it is not called a break; the
    unreadable amount is counted separately.

    Args:
        rows: Rows in print order.
        orientation: ``NEWEST_FIRST`` or ``OLDEST_FIRST``.

    Returns:
        For each break, the print position of the upper of its two rows.

    Side Effects:
        None.
    """
    breaks = []
    for position, (upper, lower) in enumerate(zip(rows, rows[1:], strict=False)):
        newer, older = (upper, lower) if orientation == NEWEST_FIRST else (lower, upper)
        if _is_broken_link(older, newer):
            breaks.append(position)
    return breaks


def _is_broken_link(older, newer):
    """Check one link of the balance chain.

    Args:
        older: The earlier row.
        newer: The later row.

    Returns:
        True if every amount is readable and the newer balance does not follow.

    Side Effects:
        None.
    """
    amounts = (
        _parse_amount(older["balance"]),
        _parse_cell(newer["paid_in"]),
        _parse_cell(newer["withdrawn"]),
        _parse_amount(newer["balance"]),
    )
    if None in amounts:
        return False
    previous, paid_in, withdrawn, balance = amounts
    return abs(previous + paid_in - abs(withdrawn) - balance) > CHAIN_TOLERANCE


def _count_break_kinds(rows, orientation):
    """Count one orientation's breaks by kind.

    Args:
        rows: Rows in print order.
        orientation: ``NEWEST_FIRST`` or ``OLDEST_FIRST``.

    Returns:
        A ``ChainBreakCounts``.

    Side Effects:
        None.
    """
    counts = {"same_receipt": 0, "tied_timestamp": 0, "page_boundary": 0, "other": 0}
    for position in find_chain_breaks(rows, orientation):
        counts[_break_kind(rows[position], rows[position + 1])] += 1
    return counts


def _break_kind(upper, lower):
    """Name what explains a break, most specific first, so each break counts once.

    Args:
        upper: The upper row of the link.
        lower: The lower row of the link.

    Returns:
        The kind's name.

    Side Effects:
        None.
    """
    if upper["receipt_no"] == lower["receipt_no"]:
        return "same_receipt"
    if upper["completion_time"] == lower["completion_time"]:
        return "tied_timestamp"
    return "page_boundary" if upper["page"] != lower["page"] else "other"


def _count_statuses(rows):
    """Count rows by printed status.

    Args:
        rows: Rows in print order.

    Returns:
        Map of status to count; a blank status counts under the empty string.

    Side Effects:
        None.
    """
    counts = {}
    for row in rows:
        status = row["status"] or EMPTY_STATUS
        counts[status] = counts.get(status, 0) + 1
    return counts


def _count_unparsed_amounts(rows):
    """Count amount cells that cannot be read. A statement always prints a balance.

    Args:
        rows: Rows in print order.

    Returns:
        The number of cells.

    Side Effects:
        None.
    """
    unreadable = 0
    for row in rows:
        unreadable += _parse_cell(row["paid_in"]) is None
        unreadable += _parse_cell(row["withdrawn"]) is None
        unreadable += _parse_amount(row["balance"]) is None
    return unreadable


def _parse_cell(text):
    """Read a paid in or withdrawn cell, where blank means zero.

    Args:
        text: The printed text, or None.

    Returns:
        The amount, or None if the text cannot be read.

    Side Effects:
        None.
    """
    return 0.0 if text is None else _parse_amount(text)


def _parse_amount(text):
    """Read a printed amount.

    Args:
        text: The printed text, or None.

    Returns:
        The amount, or None if the text is blank or cannot be read.

    Side Effects:
        None.
    """
    if text is None or not is_amount_text(text):
        return None
    return float(text.strip().replace(",", ""))


def _reconcile_summary(statement_pages, rows):
    """Compare each statement summary total with the rows.

    Args:
        statement_pages: The statement's positioned text.
        rows: Rows in print order.

    Returns:
        Map of label to True or False, or None if the label or its value was not found.

    Side Effects:
        None.
    """
    printed = _read_statement_summary(statement_pages)
    computed = _totals_from_rows(rows)
    return {
        label: None if printed.get(label) is None else _agrees(printed[label], computed[label])
        for label in SUMMARY_LABELS
    }


def _agrees(printed, computed):
    """Compare a printed total with the computed one.

    Args:
        printed: The printed amount.
        computed: The computed amount, or None if the rows cannot give one.

    Returns:
        True if they agree to the cent.

    Side Effects:
        None.
    """
    return computed is not None and abs(printed - computed) <= CHAIN_TOLERANCE


def _totals_from_rows(rows):
    """Work out what the statement summary should say. Unreadable amounts add nothing.

    Args:
        rows: Rows in print order.

    Returns:
        Map of label to amount. Balances are None without rows, or if unreadable.

    Side Effects:
        None.
    """
    paid_in = [_parse_cell(row["paid_in"]) or 0.0 for row in rows]
    withdrawn = [abs(_parse_cell(row["withdrawn"]) or 0.0) for row in rows]
    return {
        TRANSACTION_COUNT_LABEL: float(len(rows)),
        TOTAL_PAID_IN_LABEL: sum(paid_in),
        TOTAL_WITHDRAWN_LABEL: sum(withdrawn),
        OPENING_BALANCE_LABEL: _opening_balance(rows),
        CLOSING_BALANCE_LABEL: _closing_balance(rows),
    }


def _opening_balance(rows):
    """Work the balance before the earliest row back from that row. A tie takes the last printed.

    Args:
        rows: Rows in print order.

    Returns:
        The opening balance, or None without rows or if the row is unreadable.

    Side Effects:
        None.
    """
    if not rows:
        return None
    earliest_time = min(row["completion_time"] for row in rows)
    earliest = [row for row in rows if row["completion_time"] == earliest_time][-1]
    balance = _parse_amount(earliest["balance"])
    paid_in = _parse_cell(earliest["paid_in"])
    withdrawn = _parse_cell(earliest["withdrawn"])
    if None in (balance, paid_in, withdrawn):
        return None
    return balance - paid_in + abs(withdrawn)


def _closing_balance(rows):
    """Find the balance of the latest row. A tie takes the first printed (D-06).

    Args:
        rows: Rows in print order.

    Returns:
        The closing balance, or None without rows or if the row is unreadable.

    Side Effects:
        None.
    """
    if not rows:
        return None
    latest_time = max(row["completion_time"] for row in rows)
    latest = next(row for row in rows if row["completion_time"] == latest_time)
    return _parse_amount(latest["balance"])


def _read_statement_summary(statement_pages):
    """Read the labeled totals printed before the first anchor on page 1.

    Args:
        statement_pages: The statement's positioned text.

    Returns:
        Map of label to amount, for each label found with a readable value.

    Side Effects:
        None.
    """
    if not statement_pages["pages"]:
        return {}
    found = {}
    for line in group_lines(statement_pages["pages"][0]):
        if find_anchor(line):
            break
        text = " ".join(text_item["text"] for text_item in line.items)
        found.update(_read_summary_line(text))
    return found


def _read_summary_line(text):
    """Read a label and amount from one line of the summary.

    Args:
        text: The line's text.

    Returns:
        Map holding the label and amount if the line holds them; otherwise empty.

    Side Effects:
        None.
    """
    folded = text.strip().casefold()
    for label in SUMMARY_LABELS:
        if folded.startswith(label.casefold()):
            value = text.strip()[len(label) :].strip(LABEL_PUNCTUATION)
            amount = _parse_amount(value)
            return {} if amount is None else {label: amount}
    return {}


def _receipt_length_histogram(statement_pages):
    """Count the lengths of whatever sits left of each date, to answer open question OQ-10.

    Read from the pages, not the rows, because a row only exists for a 10-character receipt number.
    A receipt of another length would otherwise be invisible here and simply be missing.

    Args:
        statement_pages: The statement's positioned text.

    Returns:
        Map of length to count. A date with nothing to its left counts as length 0.

    Side Effects:
        None.
    """
    histogram = {}
    for page in statement_pages["pages"]:
        for line in group_lines(page):
            time_cell = find_time_cell(line.items)
            if time_cell is None:
                continue
            left_items = [
                text_item for text_item in line.items if text_item["x0"] < time_cell[0][0]["x0"]
            ]
            length = len(left_items[0]["text"].strip()) if left_items else 0
            histogram[length] = histogram.get(length, 0) + 1
    return histogram
