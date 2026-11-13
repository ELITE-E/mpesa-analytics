"""Transfers: money sent to people and received from them.

The amount is the money moved, without the fee: paid out for money sent, paid in for money
received. These figures say how much moved, never what it was for.
"""

from collections import Counter, defaultdict

from mpesa_core.analysis.frame import filter_by_period


def calculate_total_transfers(transfers, period_start, period_end):
    """Sum the transfers sent within the period.

    Args:
        transfers: Transfer records with ``date`` and ``amount``.
        period_start: First day of the period.
        period_end: Last day of the period.

    Returns:
        The ``period`` and the ``total_transfer_amount``.

    Side Effects:
        None.
    """
    in_period = filter_by_period(transfers, period_start, period_end)
    return {
        "period": {"start": period_start, "end": period_end},
        "total_transfer_amount": sum(transfer["amount"] for transfer in in_period),
    }


def calculate_total_received_transfers(received_transfers, period_start, period_end):
    """Sum the transfers received within the period.

    Args:
        received_transfers: Transfer records with ``date`` and ``amount``.
        period_start: First day of the period.
        period_end: Last day of the period.

    Returns:
        The ``period`` and the ``total_received``.

    Side Effects:
        None.
    """
    in_period = filter_by_period(received_transfers, period_start, period_end)
    return {
        "period": {"start": period_start, "end": period_end},
        "total_received": sum(transfer["amount"] for transfer in in_period),
    }


def rank_recipients_by_transfer_count(transfers, period_start, period_end):
    """Rank recipients by how many transfers they were sent within the period.

    Args:
        transfers: Transfer records with ``date`` and ``recipient``.
        period_start: First day of the period.
        period_end: Last day of the period.

    Returns:
        One record per recipient, most first: ``recipient``, ``transaction_count`` and
        ``ranking``. Equal counts share a rank, and keep first-seen order.

    Side Effects:
        None.
    """
    in_period = filter_by_period(transfers, period_start, period_end)
    counts = Counter(transfer["recipient"] for transfer in in_period)
    by_count = sorted(counts.items(), key=lambda counted: counted[1], reverse=True)
    rankings = _shared_rankings([count for _, count in by_count])
    return [
        {"recipient": recipient, "transaction_count": count, "ranking": ranking}
        for (recipient, count), ranking in zip(by_count, rankings, strict=True)
    ]


def calculate_monthly_transfer_amounts(transfers, period_start, period_end):
    """Sum the transfers sent within the period, by month.

    Args:
        transfers: Transfer records with ``date`` and ``amount``.
        period_start: First day of the period.
        period_end: Last day of the period.

    Returns:
        One record per month that has a transfer, in date order: ``month`` and
        ``transfer_amount``.

    Side Effects:
        None.
    """
    amounts_by_month = defaultdict(float)
    for transfer in filter_by_period(transfers, period_start, period_end):
        amounts_by_month[transfer["date"].strftime("%Y-%m")] += transfer["amount"]
    return [
        {"month": month, "transfer_amount": amounts_by_month[month]}
        for month in sorted(amounts_by_month)
    ]


def rank_transfers_by_amount(transfers, period_start, period_end):
    """Rank every transfer sent within the period by its amount.

    Args:
        transfers: Transfer records with ``date``, ``recipient`` and ``amount``.
        period_start: First day of the period.
        period_end: Last day of the period.

    Returns:
        One record per transfer, largest first: ``recipient``, ``amount``, ``date`` and
        ``ranking``. Equal amounts share a rank, and keep their order.

    Side Effects:
        None.
    """
    in_period = filter_by_period(transfers, period_start, period_end)
    by_amount = sorted(in_period, key=lambda transfer: transfer["amount"], reverse=True)
    rankings = _shared_rankings([transfer["amount"] for transfer in by_amount])
    return [
        {
            "recipient": transfer["recipient"],
            "amount": transfer["amount"],
            "date": transfer["date"],
            "ranking": ranking,
        }
        for transfer, ranking in zip(by_amount, rankings, strict=True)
    ]


def _shared_rankings(ordered_values):
    """Rank values already in order, giving equal neighbours the same rank.

    Args:
        ordered_values: Values in ranking order.

    Returns:
        One rank per value. After a shared rank, the next rank is the value's position, so ranks
        can skip.

    Side Effects:
        None.
    """
    rankings = []
    for position, value in enumerate(ordered_values, start=1):
        is_tied = position > 1 and value == ordered_values[position - 2]
        rankings.append(rankings[-1] if is_tied else position)
    return rankings
