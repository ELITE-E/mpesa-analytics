"""The one place rows enter pandas, and the selections every analysis shares.

Rows become a frame here and nowhere else. Every class goes in as plain text, never as an enum
member, so comparisons cannot silently match nothing (D-01).
"""

from datetime import date

import pandas as pd

# The old report shows this marker as a name wherever it did not drop unidentified entities.
NO_ENTITY_IDENTIFIED = "NO_ENTITY_IDENTIFIED"
CLASS_FIELDS = ("event_type", "cash_flow_direction", "economic_meaning")
FRAME_FIELDS = (
    "receipt_no",
    "completion_time",
    "details",
    "paid_in",
    "paid_out",
    "balance",
    *CLASS_FIELDS,
    "total_cost",
    "entity",
)
ENTITY_ALIASES = ("merchant", "recipient", "platform")
SPENDING_EVENTS = ("MERCHANT_PAYMENT", "BILL_PAYMENT", "BUNDLE_PURCHASE")


def prepared_frame(rows):
    """Turn classified rows into the frame the analyses read.

    Args:
        rows: ``ClassifiedRow`` records in print order.

    Returns:
        A frame with one line per row, in the same order. Completion times are parsed, and an
        unreadable one becomes missing. ``date`` is the completion time, ``amount`` the total
        cost, ``investment_amount`` the paid out, and ``merchant``, ``recipient`` and ``platform``
        the entity. No rows gives an empty frame with every column (A-5).

    Side Effects:
        None.
    """
    frame = pd.DataFrame([_plain_record(row) for row in rows], columns=list(FRAME_FIELDS))
    frame["completion_time"] = pd.to_datetime(frame["completion_time"], errors="coerce")
    frame["date"] = frame["completion_time"]
    frame["amount"] = frame["total_cost"]
    frame["investment_amount"] = frame["paid_out"]
    for alias in ENTITY_ALIASES:
        frame[alias] = frame["entity"]
    return frame


def resolve_period(frame):
    """Work out the default period: the span of the readable completion times.

    Args:
        frame: A prepared frame.

    Returns:
        Tuple of start and end as datetimes. With no readable time, the earliest and latest dates
        the language allows.

    Side Effects:
        None.
    """
    times = frame["completion_time"].dropna()
    if times.empty:
        return date.min, date.max
    return times.min().to_pydatetime(), times.max().to_pydatetime()


def select_events(frame, *event_types):
    """Keep the lines of the given event types.

    Args:
        frame: A prepared frame.
        *event_types: Event type names, as plain text.

    Returns:
        A copy holding only those lines.

    Side Effects:
        None.
    """
    return frame[frame["event_type"].isin(event_types)].copy()


def select_qualifying_spending(frame):
    """Keep the lines that count as spending: merchant payments, bill payments and bundles.

    Args:
        frame: A prepared frame.

    Returns:
        A copy holding only those lines.

    Side Effects:
        None.
    """
    return select_events(frame, *SPENDING_EVENTS)


def exclude_unidentified_entities(frame):
    """Drop the lines whose entity no grammar could read.

    Args:
        frame: A prepared frame.

    Returns:
        A copy without those lines.

    Side Effects:
        None.
    """
    return frame[frame["entity"] != NO_ENTITY_IDENTIFIED].copy()


def calendar_records(frame, amount_from=None):
    """Turn a frame into the records the date-based analyses read.

    Args:
        frame: A prepared frame, usually one selection of it.
        amount_from: Column to use as ``amount``; by default ``amount`` stays the total cost.

    Returns:
        One record per line, in order. ``date`` is the completion time's calendar date, and
        ``bill`` is the entity.

    Side Effects:
        None.
    """
    dated = frame.assign(date=frame["completion_time"].dt.date, bill=frame["entity"])
    if amount_from is not None:
        dated = dated.assign(amount=dated[amount_from])
    return dated.to_dict(orient="records")


def filter_by_period(records, period_start, period_end):
    """Keep the records whose date lies in the period, both ends included.

    Args:
        records: Records with a ``date``.
        period_start: First day, as a date or datetime.
        period_end: Last day, as a date or datetime.

    Returns:
        The records inside the period, in order. A record with a missing date raises under the
        pinned pandas, as the old code does (A-3, deferred).

    Side Effects:
        None.
    """
    start_date = pd.Timestamp(period_start).date()
    end_date = pd.Timestamp(period_end).date()
    return [
        record
        for record in records
        if start_date <= pd.Timestamp(record["date"]).date() <= end_date
    ]


def _plain_record(row):
    """Reduce one classified row to plain values for the frame.

    Args:
        row: A ``ClassifiedRow``.

    Returns:
        A record holding only the fields the analyses read. Each class is plain text, and a
        missing entity is the old marker, so the report matches the old one.

    Side Effects:
        None.
    """
    record = {field: row.get(field) for field in FRAME_FIELDS}
    for field in CLASS_FIELDS:
        record[field] = None if record[field] is None else str(record[field])
    if record["entity"] is None:
        record["entity"] = NO_ENTITY_IDENTIFIED
    return record
