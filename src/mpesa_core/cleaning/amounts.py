"""Read printed amounts as numbers. Never raises, and never logs the printed text (D-04)."""

import math

CURRENCY_PREFIX = "KSh"
THOUSANDS_SEPARATOR = ","


def parse_currency(printed):
    """Read one printed amount as a float, the way the old cleaning step did.

    Unreadable text gives 0.0, as before, but nothing is logged: the text could be any part of a
    statement. ``reconcile`` counts unreadable amounts instead.

    Args:
        printed: The printed text, a number, or None.

    Returns:
        The amount. Missing, empty and unreadable values give 0.0. Text the number reader takes as
        not-a-number stays not-a-number; ``canonicalize_rows`` turns that into 0.0, as the old
        cleaning step did.

    Side Effects:
        None.
    """
    if printed is None or printed == "" or _is_missing_number(printed):
        return 0.0
    if isinstance(printed, int | float):
        return float(printed)
    plain = printed.replace(CURRENCY_PREFIX, "").replace(THOUSANDS_SEPARATOR, "").strip()
    try:
        return float(plain)
    except ValueError:
        return 0.0


def _is_missing_number(printed):
    """Tell whether a value is a number standing for a missing value.

    Args:
        printed: The value.

    Returns:
        True for a float that is not-a-number.

    Side Effects:
        None.
    """
    return isinstance(printed, float) and math.isnan(printed)
