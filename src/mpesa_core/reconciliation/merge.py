"""Rules for a ledger's merged view across statements (ADR 0017): its period and closing balance.

The browser store describes each statement by its period, its print orientation and the indices,
in print order, of the ledger transactions it observed. Pure: no clock, no storage.
"""

from datetime import datetime

from mpesa_core.errors import AnalysisCode, AnalysisError
from mpesa_core.reconciliation.reconcile import NEWEST_FIRST, OLDEST_FIRST

COMPLETION_TIME_FORMAT = "%Y-%m-%d %H:%M:%S"


def merged_period(statements):
    """The union of the statements' periods: earliest start to latest end.

    Args:
        statements: Statement descriptions, each with a ``period`` of ``start`` and ``end`` as
            printed completion times, or None.

    Returns:
        A ``Period``; a statement whose start or end is None adds nothing to that side, and both
        are None when no statement has one.

    Raises:
        AnalysisError: ``MERGE_REQUEST_INVALID`` when a description has no such period.

    Side Effects:
        None.
    """
    if not all(_has_period(entry) for entry in statements):
        raise AnalysisError(AnalysisCode.MERGE_REQUEST_INVALID)
    starts = [entry["period"]["start"] for entry in statements if entry["period"]["start"]]
    ends = [entry["period"]["end"] for entry in statements if entry["period"]["end"]]
    return {"start": min(starts) if starts else None, "end": max(ends) if ends else None}


def merged_closing_balance(transactions, statements):
    """The balance after the ledger's newest transaction.

    The newest is the one with the latest readable completion time. A tie goes to the statement
    imported later; a tie inside one statement goes to the row its print order puts newest (the
    first printed when it prints newest first, the last printed otherwise), as D-06 reads one
    statement.

    Args:
        transactions: The ledger's transactions, each with ``completion_time`` and ``balance``.
        statements: Statement descriptions in import order, each with ``chain_orientation`` and
            ``transaction_indices`` (positions in ``transactions``, in print order).

    Returns:
        That transaction's balance, or None when no completion time can be read.

    Raises:
        AnalysisError: ``MERGE_REQUEST_INVALID`` when a description is malformed: not a record,
            an unknown orientation, or an index outside ``transactions``. No value is repeated.

    Side Effects:
        None.
    """
    newest_key = None
    newest_balance = None
    for import_position, entry in enumerate(statements):
        checked = _checked_statement(entry, len(transactions))
        if checked is None:
            raise AnalysisError(AnalysisCode.MERGE_REQUEST_INVALID)
        indices, newest_first = checked
        for print_position, index in enumerate(indices):
            completion_time = transactions[index]["completion_time"]
            if not _is_readable_time(completion_time):
                continue
            chain_position = -print_position if newest_first else print_position
            key = (completion_time, import_position, chain_position)
            if newest_key is None or key > newest_key:
                newest_key, newest_balance = key, transactions[index]["balance"]
    return newest_balance


def _checked_statement(entry, transaction_count):
    """Check one statement description and read its indices and orientation.

    Args:
        entry: The description.
        transaction_count: How many transactions the ledger holds.

    Returns:
        The indices, and True if the statement prints newest first; None if the description is
        malformed.

    Side Effects:
        None.
    """
    if not _has_period(entry):
        return None
    orientation = entry.get("chain_orientation")
    indices = entry.get("transaction_indices")
    is_valid = (
        orientation in (NEWEST_FIRST, OLDEST_FIRST)
        and isinstance(indices, list)
        and all(_is_index(index, transaction_count) for index in indices)
    )
    if not is_valid:
        return None
    return indices, orientation == NEWEST_FIRST


def _has_period(entry):
    """Tell whether a statement description is a record with a period of two times or Nones.

    Args:
        entry: The description.

    Returns:
        True if ``entry["period"]`` holds ``start`` and ``end``, each text or None.

    Side Effects:
        None.
    """
    period = entry.get("period") if isinstance(entry, dict) else None
    return isinstance(period, dict) and all(
        isinstance(period.get(side), str | None) for side in ("start", "end")
    )


def _is_index(index, transaction_count):
    """Tell whether a value is a position inside the ledger's transactions.

    Args:
        index: The value.
        transaction_count: How many transactions there are.

    Returns:
        True for a whole number from 0 to ``transaction_count - 1``.

    Side Effects:
        None.
    """
    return type(index) is int and 0 <= index < transaction_count


def _is_readable_time(completion_time):
    """Tell whether a completion time is a real date and time in the printed format.

    Args:
        completion_time: The printed completion time, or None.

    Returns:
        True if it reads, so its text also sorts in time order.

    Side Effects:
        None.
    """
    if not isinstance(completion_time, str):
        return False
    try:
        datetime.strptime(completion_time, COMPLETION_TIME_FORMAT)
    except ValueError:
        return False
    return True
