"""Independent ledger: works out a statement's expected totals from its printed rows.

Tests compare the core against this, so it must share nothing with the core or the generator.
Times are compared as text, which is safe because they are printed in ISO order.
"""

from decimal import Decimal, InvalidOperation

FEE_SUFFIX = "Charge"
# What the generator says it wrote into a row; recorded beside the rows, never as a printed field.
BUILT_FIELDS = ("event_type", "entity")
ZERO = Decimal("0.00")
# The summary block's rows, each printed as a label, a colon, paid in and paid out.
SUMMARY_TOTAL = "TOTAL:"
SUMMARY_TYPES = (
    "SEND MONEY:",
    "RECEIVED MONEY:",
    "AGENT DEPOSIT:",
    "AGENT WITHDRAWAL:",
    "LIPA NA M-PESA (PAYBILL):",
    "LIPA NA M-PESA (BUY GOODS):",
    "OTHERS:",
)


def compute_expected(rows, summary_lines=()):
    """Work out the expected totals for one statement.

    Args:
        rows: Raw rows in print order, with amounts as printed text.
        summary_lines: Tuples of the texts printed on each page 1 line above the table.

    Returns:
        A map of totals, cash flow, balances, counts, chain breaks by kind, the summary's TOTAL row,
        whether its paid in and paid out agree with the rows (None without it), how many type rows
        it printed, the count of each event type the rows were built as, what
        each row was built as (``built``, in print order), and the rows with their printed fields
        and position only. ``opening_balance`` and
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
    summary_rows = {line[0]: line[1:] for line in summary_lines if len(line) == 3}
    printed_total = summary_rows.get(SUMMARY_TOTAL)
    return {
        "row_count": len(rows),
        "total_paid_in": totals["Total Paid In"],
        "total_withdrawn": totals["Total Withdrawn"],
        "total_inflow": totals["Total Paid In"],
        "total_outflow": totals["Total Withdrawn"],
        "net_cash_flow": _text(
            _parse_amount(0, totals["Total Paid In"]) - _parse_amount(0, totals["Total Withdrawn"])
        ),
        "total_fees": _text(sum(fees, ZERO)),
        "opening_balance": totals["Opening Balance"],
        "closing_balance": totals["Closing Balance"],
        "chain_breaks": len(breaks),
        "chain_break_kinds": _chain_break_kinds(rows, breaks),
        "status_counts": status_counts,
        "summary_total": (
            {}
            if printed_total is None
            else dict(zip(("paid_in", "paid_out"), printed_total, strict=True))
        ),
        "summary_total_paid_in_matches": _summary_agrees(printed_total, 0, totals["Total Paid In"]),
        "summary_total_paid_out_matches": _summary_agrees(
            printed_total, 1, totals["Total Withdrawn"]
        ),
        "summary_type_rows_parsed": sum(label in summary_rows for label in SUMMARY_TYPES),
        "same_second_pairs": _same_second_pairs(rows),
        "event_type_counts": _event_type_counts(rows),
        "built": [_built_as(row) for row in rows],
        "rows": [
            {field: value for field, value in row.items() if field not in BUILT_FIELDS}
            for row in rows
        ],
    }


def _summary_agrees(printed_total, column, computed):
    """Compare one column of the printed TOTAL row with the rows' total.

    Args:
        printed_total: The TOTAL row's paid in and paid out as printed, or None.
        column: 0 for paid in, 1 for paid out.
        computed: The rows' total as text.

    Returns:
        Whether they are equal; None without a TOTAL row.

    Side Effects:
        None.
    """
    if printed_total is None:
        return None
    return _parse_amount(0, printed_total[column]) == _parse_amount(0, computed)


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
    """Work the balance before the oldest row back from that row's printed amounts (D-06).

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
    oldest = len(rows) - 1 if _prints_newest_first(rows) else 0
    paid_in, withdrawn, balance = amounts[oldest]
    return _text(balance - paid_in + withdrawn)


def _closing_balance(rows, amounts):
    """Find the balance of the newest row in print order, whatever its time ties with (D-06).

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
    newest = 0 if _prints_newest_first(rows) else len(rows) - 1
    return _text(amounts[newest][2])


def _prints_newest_first(rows):
    """Tell the print orientation from the two ends' times, without reading the balance chain.

    Args:
        rows: Raw rows in print order; at least one.

    Returns:
        False only if the last printed row is later than the first; equal times read as newest
        first, the usual statement order.

    Side Effects:
        None.
    """
    return rows[0]["completion_time"] >= rows[-1]["completion_time"]


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


def _event_type_counts(rows):
    """Count the event types the generator wrote into the rows, without reading any details.

    Args:
        rows: Raw rows in print order; a generated row carries the ``event_type`` it was built as.

    Returns:
        Map of event type to count; empty when no row carries one.

    Side Effects:
        None.
    """
    counts = {}
    for row in rows:
        if "event_type" in row:
            counts[row["event_type"]] = counts.get(row["event_type"], 0) + 1
    return counts


def _built_as(row):
    """Give what the generator says a row was built as.

    Args:
        row: A raw row, which may carry ``event_type`` and ``entity``.

    Returns:
        Map of those two fields, None where the row does not carry one.

    Side Effects:
        None.
    """
    return {field: row.get(field) for field in BUILT_FIELDS}


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
