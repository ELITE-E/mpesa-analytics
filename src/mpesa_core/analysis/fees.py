"""Fees: what moving money cost.

Fee rows are measured by paid out, because fee attribution zeroes a fee's own total cost. Unlike
the date-based analyses, the period is compared at full time precision.
"""

TRANSFER_CHARGE = "Customer Transfer of Funds Charge"
MPESA_FEE_TYPES = (TRANSFER_CHARGE, "Pay Bill Charge")


def calculate_total_fees(frame, period_start, period_end):
    """Sum every fee paid within the period.

    Args:
        frame: A prepared frame.
        period_start: Start of the period, as a datetime.
        period_end: End of the period, as a datetime.

    Returns:
        The ``period`` and ``total_fees``.

    Side Effects:
        None.
    """
    return {
        "period": {"start": period_start, "end": period_end},
        "total_fees": _fees_paid(frame, None, period_start, period_end),
    }


def calculate_mpesa_fees(frame, period_start, period_end):
    """Sum the known M-PESA operation fees paid within the period.

    Args:
        frame: A prepared frame.
        period_start: Start of the period, as a datetime.
        period_end: End of the period, as a datetime.

    Returns:
        The ``period`` and ``fee_amount``.

    Side Effects:
        None.
    """
    return {
        "period": {"start": period_start, "end": period_end},
        "fee_amount": _fees_paid(frame, MPESA_FEE_TYPES, period_start, period_end),
    }


def calculate_transfer_charges(frame, period_start, period_end):
    """Sum the transfer charges paid within the period.

    Args:
        frame: A prepared frame.
        period_start: Start of the period, as a datetime.
        period_end: End of the period, as a datetime.

    Returns:
        The ``period`` and ``transfer_charge_amount``.

    Side Effects:
        None.
    """
    return {
        "period": {"start": period_start, "end": period_end},
        "transfer_charge_amount": _fees_paid(frame, (TRANSFER_CHARGE,), period_start, period_end),
    }


def _fees_paid(frame, fee_types, period_start, period_end):
    """Sum the paid out of fee lines within the period.

    Args:
        frame: A prepared frame.
        fee_types: Details texts to keep, compared whole and ignoring case; None keeps every fee.
        period_start: Start of the period, as a datetime.
        period_end: End of the period, as a datetime.

    Returns:
        The sum. With no readable completion time among the fees, nothing can lie in a period, so
        the sum is zero (A-5).

    Side Effects:
        None.
    """
    is_fee = frame["event_type"] == "FEE"
    if fee_types is not None:
        folded_types = {fee_type.casefold() for fee_type in fee_types}
        is_fee = is_fee & frame["details"].str.casefold().isin(folded_types)
    fees = frame[is_fee]
    if fees["completion_time"].isna().all():
        return fees.iloc[0:0]["paid_out"].sum()
    in_period = (fees["completion_time"] >= period_start) & (fees["completion_time"] <= period_end)
    return fees[in_period]["paid_out"].sum()
