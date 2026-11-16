"""Compare parsed rows with the statement summary and the balance chain. Counts only (ADR 0004).

Whether a statement prints newest or oldest first is not assumed: the chain is checked in both
orientations and the one with fewer breaks is recorded. Blank paid in and withdrawn mean zero.
"""

from itertools import permutations

from mpesa_core.extraction.columns import find_time_cell, group_lines, is_amount_text
from mpesa_core.reconciliation.summary import read_summary_block

NEWEST_FIRST = "newest_first"
OLDEST_FIRST = "oldest_first"
CHAIN_TOLERANCE = 0.005
EMPTY_STATUS = ""
UNCLASSIFIED = "UNCLASSIFIED"
# Every order of a group is tried, so the work grows as the factorial: 6 rows is 720 orders.
MAX_REORDER_GROUP = 6
# Which neighbouring rows may have printed in either order: a group rule.
SAME_RECEIPT = "same_receipt"
SAME_TIME = "same_time"
RECEIPT_OR_TIME = "receipt_or_time"
GROUP_RULES = (SAME_RECEIPT, SAME_TIME, RECEIPT_OR_TIME)
NEARBY_ROWS = 5


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
    identity_gap = measure_identity_gap(rows, orientation)
    chain_breaks = sum(break_counts[orientation].values())
    reorder = count_breaks_resolvable_by_reorder(rows, orientation)
    summary = read_summary_block(statement_pages)
    paid_in, paid_out = _sum_moved(rows)
    return {
        "row_count": len(rows),
        "status_counts": _count_statuses(rows),
        "chain_breaks": chain_breaks,
        "chain_breaks_raw": chain_breaks,
        "chain_breaks_resolvable_by_reorder": reorder["resolved"],
        "chain_breaks_after_reorder": reorder["remaining"],
        "identity_holds": None if identity_gap is None else abs(identity_gap) <= CHAIN_TOLERANCE,
        "chain_orientation": orientation,
        "chain_break_counts": break_counts,
        "unparsed_amounts": _count_unparsed_amounts(rows),
        "summary_total_paid_in_matches": _agrees(summary["total_paid_in"], paid_in),
        "summary_total_paid_out_matches": _agrees(summary["total_paid_out"], paid_out),
        "summary_type_rows_parsed": summary["type_rows_parsed"],
        "receipt_length_histogram": _receipt_length_histogram(statement_pages),
    }


def measure_unclassified(transactions):
    """Measure how much of a statement no classification rule recognized.

    These go in ``quality``, not in the report: the report's keys stay exactly as they were.

    Args:
        transactions: ``ClassifiedRow`` records.

    Returns:
        The count of unclassified rows, their share of all rows (0.0 with no rows), and their
        paid in and withdrawn totals, the latter as a size. Numbers only.

    Side Effects:
        None.
    """
    unclassified = [row for row in transactions if row["event_type"] == UNCLASSIFIED]
    return {
        "unclassified_rows": len(unclassified),
        "unclassified_share": len(unclassified) / len(transactions) if transactions else 0.0,
        "unclassified_paid_in": float(sum(row["paid_in"] for row in unclassified)),
        "unclassified_withdrawn": float(sum(row["paid_out"] for row in unclassified)),
    }


def measure_balances(rows, orientation):
    """Find the balance before the statement's oldest row and after its newest one (D-06).

    Print order decides which rows those are, never the clock, so a tied timestamp cannot swap
    them: newest first, the newest row is the first printed and the oldest the last.

    Args:
        rows: Raw rows in print order.
        orientation: ``NEWEST_FIRST`` or ``OLDEST_FIRST``, as ``reconcile`` records it.

    Returns:
        ``opening_balance``: the oldest row's balance minus its paid in plus its withdrawn (as a
        size); ``closing_balance``: the newest row's balance. Each is None without rows, or if an
        amount it needs cannot be read.

    Raises:
        ValueError: If the orientation is not one of the two names. The value is not repeated.

    Side Effects:
        None.
    """
    if orientation not in (NEWEST_FIRST, OLDEST_FIRST):
        raise ValueError("orientation must be newest_first or oldest_first")
    if not rows:
        return {"opening_balance": None, "closing_balance": None}
    newest, oldest = (rows[0], rows[-1]) if orientation == NEWEST_FIRST else (rows[-1], rows[0])
    return {
        "opening_balance": _balance_before(oldest),
        "closing_balance": _parse_amount(newest["balance"]),
    }


def measure_identity_gap(rows, orientation):
    """Measure how far the closing balance is from the opening balance plus what moved.

    With an unbroken chain the gap is zero, so a gap is the sum of every break's residual.
    Unreadable paid in and withdrawn amounts add nothing, as in the summary totals.

    Args:
        rows: Raw rows in print order.
        orientation: ``NEWEST_FIRST`` or ``OLDEST_FIRST``.

    Returns:
        Closing balance minus opening balance minus paid in plus withdrawn (as a size), or None
        if either balance is unknown.

    Side Effects:
        None.
    """
    balances = measure_balances(rows, orientation)
    if None in balances.values():
        return None
    paid_in, withdrawn = _sum_moved(rows)
    return balances["closing_balance"] - balances["opening_balance"] - paid_in + withdrawn


def _sum_moved(rows):
    """Add up what the rows paid in and withdrew. Unreadable amounts add nothing.

    Args:
        rows: Raw rows.

    Returns:
        Tuple of the paid in total and the withdrawn total, the latter as a size.

    Side Effects:
        None.
    """
    paid_in = sum(_parse_cell(row["paid_in"]) or 0.0 for row in rows)
    withdrawn = sum(abs(_parse_cell(row["withdrawn"]) or 0.0) for row in rows)
    return paid_in, withdrawn


def chain_break_residuals(rows, orientation):
    """Give each chain break's residual: how far its newer balance is from what it should be.

    Args:
        rows: Raw rows in print order.
        orientation: ``NEWEST_FIRST`` or ``OLDEST_FIRST``.

    Returns:
        Tuples of the break's print position, as ``find_chain_breaks`` gives it, and the newer
        balance minus the older balance minus paid in plus withdrawn (as a size).

    Side Effects:
        None.
    """
    residuals = []
    for position in find_chain_breaks(rows, orientation):
        upper, lower = rows[position], rows[position + 1]
        newer, older = (upper, lower) if orientation == NEWEST_FIRST else (lower, upper)
        expected = (
            _parse_amount(older["balance"])
            + _parse_cell(newer["paid_in"])
            - abs(_parse_cell(newer["withdrawn"]))
        )
        residuals.append((position, _parse_amount(newer["balance"]) - expected))
    return residuals


def count_breaks_resolvable_by_reorder(rows, orientation, rule=RECEIPT_OR_TIME):
    """Count the chain breaks that some order inside a group removes.

    Args:
        rows: Raw rows in print order. They are not changed.
        orientation: ``NEWEST_FIRST`` or ``OLDEST_FIRST``.
        rule: Which neighbours form a group, one of ``GROUP_RULES``; see ``reorder_within_groups``.

    Returns:
        ``resolved``: breaks that disappear; ``remaining``: breaks that stay; and
        ``groups_too_large``: groups over ``MAX_REORDER_GROUP`` rows, left as printed.

    Side Effects:
        None.
    """
    reordered = reorder_within_groups(rows, orientation, rule)
    before = len(find_chain_breaks(rows, orientation))
    after = len(find_chain_breaks(reordered["rows"], orientation))
    return {
        "resolved": before - after,
        "remaining": after,
        "groups_too_large": reordered["groups_too_large"],
    }


def reorder_within_groups(rows, orientation, rule=RECEIPT_OR_TIME):
    """Put each group of rows in the order with the fewest chain breaks.

    A group is a run of two or more rows in which each row is joined to the next: by sharing its
    receipt number (``SAME_RECEIPT``), its completion time (``SAME_TIME``), or either
    (``RECEIPT_OR_TIME``). Groups are tried in print order; each keeps the order with the fewest
    breaks on the links it touches, the printed order winning a tie, so breaks never rise.

    Args:
        rows: Raw rows in print order. They are not changed.
        orientation: ``NEWEST_FIRST`` or ``OLDEST_FIRST``.
        rule: One of ``GROUP_RULES``.

    Returns:
        ``rows``: the same row records in the new order; ``groups_too_large``: groups over
        ``MAX_REORDER_GROUP`` rows, left as printed.

    Side Effects:
        None.
    """
    reordered = list(rows)
    too_large = 0
    for start, end in _reorder_groups(rows, rule):
        if end - start + 1 > MAX_REORDER_GROUP:
            too_large += 1
            continue
        reordered[start : end + 1] = _best_group_order(reordered, start, end, orientation)
    return {"rows": reordered, "groups_too_large": too_large}


def reorder_group_sizes(rows, rule=RECEIPT_OR_TIME):
    """Count the groups of each size, as ``reorder_within_groups`` finds them.

    Args:
        rows: Raw rows in print order.
        rule: One of ``GROUP_RULES``.

    Returns:
        Map of group size to the number of groups that size; empty without groups.

    Side Effects:
        None.
    """
    sizes = {}
    for start, end in _reorder_groups(rows, rule):
        sizes[end - start + 1] = sizes.get(end - start + 1, 0) + 1
    return sizes


def count_residuals_matching_nearby_amounts(rows, orientation, window=NEARBY_ROWS):
    """Count the breaks whose residual, as a size, equals an amount printed close by.

    Args:
        rows: Raw rows in the order to check.
        orientation: ``NEWEST_FIRST`` or ``OLDEST_FIRST``.
        window: How many rows beyond the break's two rows to look at, on each side.

    Returns:
        The number of breaks whose residual is within half a cent of a non-zero paid in or
        withdrawn amount (as a size) on one of those rows.

    Side Effects:
        None.
    """
    matching = 0
    for position, residual in chain_break_residuals(rows, orientation):
        nearby = rows[max(0, position - window) : position + 2 + window]
        amounts = [_parse_cell(row[field]) for row in nearby for field in ("paid_in", "withdrawn")]
        matching += any(
            amount and abs(abs(amount) - abs(residual)) <= CHAIN_TOLERANCE for amount in amounts
        )
    return matching


def _reorder_groups(rows, rule):
    """Find the runs of rows that are each joined to the next under a rule.

    Args:
        rows: Raw rows in print order.
        rule: One of ``GROUP_RULES``.

    Returns:
        Tuples of the first and last print position of each run of two or more rows.

    Raises:
        ValueError: If the rule is not one of ``GROUP_RULES``. The value is not repeated.

    Side Effects:
        None.
    """
    if rule not in GROUP_RULES:
        raise ValueError("rule must be one of GROUP_RULES")
    groups = []
    start = 0
    for position in range(1, len(rows) + 1):
        joined = position < len(rows) and _joined(rows[position - 1], rows[position], rule)
        if not joined:
            if position - 1 > start:
                groups.append((start, position - 1))
            start = position
    return groups


def _joined(upper, lower, rule):
    """Tell whether two neighbouring rows could have printed in either order, under a rule.

    Args:
        upper: The upper row.
        lower: The lower row.
        rule: One of ``GROUP_RULES``.

    Returns:
        True if they share what the rule asks for.

    Side Effects:
        None.
    """
    same_receipt = upper["receipt_no"] == lower["receipt_no"]
    same_time = upper["completion_time"] == lower["completion_time"]
    if rule == SAME_RECEIPT:
        return same_receipt
    if rule == SAME_TIME:
        return same_time
    return same_receipt or same_time


def _best_group_order(rows, start, end, orientation):
    """Find the order of one group with the fewest breaks on the links it touches.

    Args:
        rows: Rows in print order, earlier groups already reordered.
        start: Print position of the group's first row.
        end: Print position of its last row.
        orientation: ``NEWEST_FIRST`` or ``OLDEST_FIRST``.

    Returns:
        The group's rows in the best order; the printed order wins a tie, as it is tried first.

    Side Effects:
        None.
    """
    above = rows[start - 1 : start]
    below = rows[end + 1 : end + 2]
    return min(
        permutations(rows[start : end + 1]),
        key=lambda order: len(find_chain_breaks([*above, *order, *below], orientation)),
    )


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


def _agrees(printed, computed):
    """Compare a printed total with the computed one, to half a cent.

    Args:
        printed: The printed amount, or None if it was not found.
        computed: The computed amount.

    Returns:
        True or False; None if nothing was printed.

    Side Effects:
        None.
    """
    return None if printed is None else abs(printed - computed) <= CHAIN_TOLERANCE


def _balance_before(row):
    """Work the balance before a row back from its printed amounts.

    Args:
        row: A raw row.

    Returns:
        The balance minus paid in plus withdrawn as a size, or None if any is unreadable.

    Side Effects:
        None.
    """
    balance = _parse_amount(row["balance"])
    paid_in = _parse_cell(row["paid_in"])
    withdrawn = _parse_cell(row["withdrawn"])
    if None in (balance, paid_in, withdrawn):
        return None
    return balance - paid_in + abs(withdrawn)


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
