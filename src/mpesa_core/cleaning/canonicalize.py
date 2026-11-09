"""Turn raw rows into canonical rows, with the old cleaning step's rules in the same order.

The rules are in docs/decisions/cleaning-behaviour.md. Rows are plain records, so no dataframe
library is needed.
"""

import math

from mpesa_core.cleaning.amounts import parse_currency
from mpesa_core.cleaning.normalize import normalize_name

HEADER_RECEIPT = "Receipt No."
AMOUNT_FIELDS = ("paid_in", "withdrawn", "balance")


def canonicalize_rows(rows):
    """Clean raw rows into canonical rows.

    In order: drop rows without a usable receipt number, read the amounts, normalize the details
    and give the classifier its name for withdrawn (``paid_out``). Receipt numbers, completion
    times and statuses stay exactly as printed, and any other field passes through unchanged.

    Args:
        rows: ``RawRow`` records in print order.

    Returns:
        New ``CanonicalRow`` records in print order; the input is not changed.

    Side Effects:
        None.
    """
    return [_canonical_row(row) for row in rows if _has_usable_receipt(row)]


def _has_usable_receipt(row):
    """Tell whether a row carries a receipt number, and so is a transaction.

    Args:
        row: A raw row.

    Returns:
        False if the receipt is missing, blank, or exactly the printed column title. The title is
        compared without trimming, as the old cleaning step did.

    Side Effects:
        None.
    """
    receipt = row["receipt_no"]
    if receipt is None:
        return False
    return receipt.strip() != "" and receipt != HEADER_RECEIPT


def _canonical_row(row):
    """Build one canonical row from a raw row.

    Args:
        row: A raw row with a usable receipt number.

    Returns:
        A new record with float amounts, normalized details and ``paid_out`` set to withdrawn.

    Side Effects:
        None.
    """
    amounts = {field: _amount(row[field]) for field in AMOUNT_FIELDS}
    return {
        **row,
        **amounts,
        "details": normalize_name(row["details"] or ""),
        "paid_out": amounts["withdrawn"],
    }


def _amount(printed):
    """Read an amount cell; a result that is not a number counts as 0.0, as before.

    Args:
        printed: The printed amount, or None.

    Returns:
        The amount as a float.

    Side Effects:
        None.
    """
    amount = parse_currency(printed)
    return 0.0 if math.isnan(amount) else amount
