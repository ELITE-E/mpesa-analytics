"""Independent ledger: works out a statement's expected totals from its printed rows.

Tests compare the core against this, so it must share nothing with the core or the generator.
Times are compared as text, which is safe because they are printed in ISO order.
"""

from decimal import Decimal, InvalidOperation

FEE_SUFFIX = "Charge"
ZERO = Decimal("0.00")
# Labels the statement summary prints that the rows can confirm.
TOTAL_LABELS = (
    "Transaction Count",
    "Total Paid In",
    "Total Withdrawn",
    "Opening Balance",
    "Closing Balance",
)


def compute_expected(rows, summary_lines=()):
    """Work out the expected totals for one statement.

    Args:
        rows: Raw rows in print order, with amounts as printed text.
        summary_lines: Tuples of label and printed value from the statement summary.

    Returns:
        A map of totals, balances, counts, chain breaks by kind, the summary's printed totals and
        whether each agrees with the rows, and the rows themselves. ``opening_balance`` and
        ``closing_balance`` are None for an empty statement.

    Side Effects:
        None.
    """
    amounts = [_parse_row(index, row) for index, row in enumerate(rows)]
    status_counts = {}
    for row in rows:
        status_counts[row["status"]] = status_counts.get(row["status"], 0) + 1
    fees = [
        withdrawn
        for row, (_, withdrawn, _) in zip(rows, amounts, strict=True)
        if row["details"].endswith(FEE_SUFFIX)
    ]
    breaks = _chain_break_links(rows, amounts)
    totals = {
        "Transaction Count": str(len(rows)),
        "Total Paid In": _text(sum((paid_in for paid_in, _, _ in amounts), ZERO)),
        "Total Withdrawn": _text(sum((withdrawn for _, withdrawn, _ in amounts), ZERO)),
        "Opening Balance": _opening_balance(rows, amounts),
        "Closing Balance": _closing_balance(rows, amounts),
    }
    printed_totals = {label: value for label, value in summary_lines if label in TOTAL_LABELS}
    return {
        "row_count": len(rows),
        "total_paid_in": totals["Total Paid In"],
        "total_withdrawn": totals["Total Withdrawn"],
        "total_fees": _text(sum(fees, ZERO)),
        "opening_balance": totals["Opening Balance"],
        "closing_balance": totals["Closing Balance"],
        "chain_breaks": len(breaks),
        "chain_break_kinds": _chain_break_kinds(rows, breaks),
        "status_counts": status_counts,
        "summary_totals": printed_totals,
        "summary_reconciliation": {
            label: _parse_amount(0, printed) == _parse_amount(0, totals[label])
            for label, printed in printed_totals.items()
        },
        "same_second_pairs": _same_second_pairs(rows),
        "rows": list(rows),
    }


def _parse_row(row_index, row):
    """Parse one row's amounts.

    Args:
        row_index: Position of the row, used in the error message.
        row: The raw row.

    Returns:
        Tuple of paid in, withdrawn and balance as ``Decimal``.

    Side Effects:
        None.
    """
    return (
        _parse_amount(row_index, row["paid_in"]),
        _parse_amount(row_index, row["withdrawn"]),
        _parse_amount(row_index, row["balance"]),
    )


def _parse_amount(row_index, printed):
    """Parse one printed amount, without repeating it in any error.

    Args:
        row_index: Position of the row, used in the error message.
        printed: Amount as printed, or None if the column is blank.

    Returns:
        The amount, with blank meaning zero.

    Raises:
        ValueError: If the text is not a number.

    Side Effects:
        None.
    """
    if printed is None:
        return ZERO
    try:
        return Decimal(printed.replace(",", ""))
    except InvalidOperation as error:
        raise ValueError(f"row {row_index}: amount is not numeric") from error


def _chronological_positions(rows):
    """Order row positions oldest first; tied rows apply in reverse print order.

    Args:
        rows: Raw rows in print order.

    Returns:
        Row positions, oldest first.

    Side Effects:
        None.
    """
    newest_printed_first = range(len(rows) - 1, -1, -1)
    return sorted(newest_printed_first, key=lambda index: rows[index]["completion_time"])


def _opening_balance(rows, amounts):
    """Work the balance before the oldest row back from that row's printed amounts.

    Args:
        rows: Raw rows in print order.
        amounts: Parsed amounts for each row.

    Returns:
        The opening balance as text, or None for an empty statement.

    Side Effects:
        None.
    """
    if not rows:
        return None
    paid_in, withdrawn, balance = amounts[_chronological_positions(rows)[0]]
    return _text(balance - paid_in + withdrawn)


def _closing_balance(rows, amounts):
    """Find the balance of the latest row; ties go to the first one printed (D-06).

    Args:
        rows: Raw rows in print order.
        amounts: Parsed amounts for each row.

    Returns:
        The closing balance as text, or None for an empty statement.

    Side Effects:
        None.
    """
    if not rows:
        return None
    latest = max(row["completion_time"] for row in rows)
    first_printed = next(i for i, row in enumerate(rows) if row["completion_time"] == latest)
    return _text(amounts[first_printed][2])


def _chain_break_links(rows, amounts):
    """Find the rows whose balance does not follow from the previous row's.

    Args:
        rows: Raw rows in print order.
        amounts: Parsed amounts for each row.

    Returns:
        Tuples of the older and newer row position, one for each break in the balance chain.

    Side Effects:
        None.
    """
    breaks = []
    previous = None
    for position in _chronological_positions(rows):
        paid_in, withdrawn, balance = amounts[position]
        if previous is not None and amounts[previous][2] + paid_in - withdrawn != balance:
            breaks.append((previous, position))
        previous = position
    return breaks


def _chain_break_kinds(rows, breaks):
    """Count breaks by what the two rows have in common; each break counts once.

    Args:
        rows: Raw rows in print order.
        breaks: Tuples of the older and newer row position.

    Returns:
        Map of kind to count, with every kind present.

    Side Effects:
        None.
    """
    kinds = {"same_receipt": 0, "tied_timestamp": 0, "page_boundary": 0, "other": 0}
    for older, newer in breaks:
        kinds[_chain_break_kind(rows[older], rows[newer])] += 1
    return kinds


def _chain_break_kind(older, newer):
    """Name what explains a break, most specific first.

    Args:
        older: The earlier row.
        newer: The later row.

    Returns:
        The kind's name.

    Side Effects:
        None.
    """
    if older["receipt_no"] == newer["receipt_no"]:
        return "same_receipt"
    if older["completion_time"] == newer["completion_time"]:
        return "tied_timestamp"
    return "page_boundary" if older["page"] != newer["page"] else "other"


def _same_second_pairs(rows):
    """Report how each same-second parent and fee pair was printed.

    Args:
        rows: Raw rows in print order.

    Returns:
        ``fee_first`` or ``parent_first`` for each adjacent pair, in print order.

    Side Effects:
        None.
    """
    pairs = []
    for upper, lower in zip(rows, rows[1:], strict=False):
        same_second = upper["completion_time"] == lower["completion_time"]
        same_receipt = upper["receipt_no"] == lower["receipt_no"]
        upper_is_fee = upper["details"].endswith(FEE_SUFFIX)
        if same_second and same_receipt and upper_is_fee != lower["details"].endswith(FEE_SUFFIX):
            pairs.append("fee_first" if upper_is_fee else "parent_first")
    return pairs


def _text(amount):
    """Format an amount for comparison.

    Args:
        amount: The amount.

    Returns:
        The amount with two decimals and no thousands commas.

    Side Effects:
        None.
    """
    return f"{amount:.2f}"
