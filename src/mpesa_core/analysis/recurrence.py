"""Recurrence: purchases and bill payments that repeat at a steady interval.

An entity recurs when it has at least ``MIN_OCCURRENCES`` payments and every gap between them, in
days, lies within ``INTERVAL_TOLERANCE_DAYS`` of the median gap.
"""

from collections import defaultdict

from mpesa_core.analysis.frame import filter_by_period

MIN_OCCURRENCES = 3
INTERVAL_TOLERANCE_DAYS = 3


def find_recurring_purchases(purchases):
    """Find the merchants whose purchases recur.

    Args:
        purchases: Purchase records with ``date``, ``merchant`` and ``amount``.

    Returns:
        One record per recurring merchant, in first-seen order: ``merchant``, ``occurrences``,
        ``dates``, ``intervals``, ``amounts`` and the median ``recurrence_interval``.

    Side Effects:
        None.
    """
    recurring = _find_recurring_entities(purchases, group_key="merchant", name_key="merchant")
    for purchase in recurring:
        purchase["recurrence_interval"] = _median(purchase["intervals"])
    return recurring


def find_recurring_bill_payments(bills, period_start, period_end):
    """Find the bills whose payments within the period recur.

    Args:
        bills: Bill records with ``date``, ``entity`` and ``amount``.
        period_start: First day of the period.
        period_end: Last day of the period.

    Returns:
        One record per recurring bill, in first-seen order: ``bill``, ``occurrences``, ``dates``,
        ``intervals`` and ``amounts``.

    Side Effects:
        None.
    """
    in_period = filter_by_period(bills, period_start, period_end)
    return _find_recurring_entities(in_period, group_key="entity", name_key="bill")


def _find_recurring_entities(records, *, group_key, name_key):
    """Group records by entity and keep the groups that recur.

    Args:
        records: Records with ``date`` and ``amount``.
        group_key: Field to group by.
        name_key: Field to report the entity under.

    Returns:
        One record per recurring entity, in first-seen order.

    Side Effects:
        None.
    """
    grouped = defaultdict(list)
    for record in records:
        grouped[record[group_key]].append(record)
    recurring = []
    for entity, entity_records in grouped.items():
        if len(entity_records) < MIN_OCCURRENCES:
            continue
        ordered = sorted(entity_records, key=lambda record: record["date"])
        dates = [record["date"] for record in ordered]
        intervals = [
            (later - earlier).days for earlier, later in zip(dates, dates[1:], strict=False)
        ]
        if _has_consistent_intervals(intervals):
            recurring.append(
                {
                    name_key: entity,
                    "occurrences": len(ordered),
                    "dates": dates,
                    "intervals": intervals,
                    "amounts": [record["amount"] for record in ordered],
                }
            )
    return recurring


def _has_consistent_intervals(intervals):
    """Tell whether every gap lies within the tolerance of the median gap.

    Args:
        intervals: Gaps in days; not empty.

    Returns:
        True if they all do.

    Side Effects:
        None.
    """
    typical = _median(intervals)
    return all(abs(interval - typical) <= INTERVAL_TOLERANCE_DAYS for interval in intervals)


def _median(values):
    """Find the median of whole-day gaps, kept whole.

    Args:
        values: Gaps in days; not empty.

    Returns:
        The middle value; for an even count, the two middle values averaged and rounded down.

    Side Effects:
        None.
    """
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) // 2
