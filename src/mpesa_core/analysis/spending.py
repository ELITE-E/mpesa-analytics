"""Spending: what was consumed, where and when.

Spending is merchant payments, bill payments and bundle purchases, measured by total cost, so
attributed fees are included.
"""

from collections import defaultdict

import pandas as pd

from mpesa_core.analysis.frame import (
    exclude_unidentified_entities,
    filter_by_period,
    select_events,
    select_qualifying_spending,
)

UNKNOWN_MONTH = "Unknown"
LARGEST_PURCHASE_FIELDS = {
    "receipt_no": "transaction",
    "entity": "recipient",
    "total_cost": "amount",
    "completion_time": "date",
}


def calculate_monthly_expenditure(frame):
    """Sum spending by month.

    Args:
        frame: A prepared frame.

    Returns:
        A frame of ``month`` and ``expenditure``, in month order. A row with an unreadable time
        falls in the month ``Unknown``.

    Side Effects:
        None.
    """
    if frame.empty:
        return pd.DataFrame(columns=["month", "expenditure"])
    spending = select_qualifying_spending(frame)
    spending["month"] = spending["completion_time"].dt.strftime("%Y-%m").fillna(UNKNOWN_MONTH)
    monthly = spending.groupby("month")["total_cost"].sum().reset_index()
    return monthly.rename(columns={"total_cost": "expenditure"})


def get_top_spending_recipients(frame, top_n=5):
    """Rank identified entities by the spending they received.

    The sort is pandas' default, so equal totals can swap ranks.

    Args:
        frame: A prepared frame.
        top_n: How many to keep.

    Returns:
        A frame of ``recipient``, ``amount_received`` and ``ranking``, largest first.

    Side Effects:
        None.
    """
    if frame.empty:
        return pd.DataFrame(columns=["recipient", "amount_received", "ranking"])
    spending = exclude_unidentified_entities(select_qualifying_spending(frame))
    totals = spending.groupby("entity")["total_cost"].sum().reset_index()
    totals.columns = ["recipient", "amount_received"]
    ranked = totals.sort_values(by="amount_received", ascending=False).reset_index(drop=True)
    ranked["ranking"] = ranked["amount_received"].rank(method="first", ascending=False).astype(int)
    return ranked.head(top_n).reset_index(drop=True)


def calculate_largest_purchases(frame, top_n=10):
    """Rank individual purchases with an identified entity by total cost.

    The sort is pandas' default, so equal costs can swap places, also at the cut.

    Args:
        frame: A prepared frame.
        top_n: How many to keep.

    Returns:
        A frame of ``transaction``, ``recipient``, ``amount``, ``date`` and ``ranking``.

    Side Effects:
        None.
    """
    if frame.empty:
        return pd.DataFrame(columns=[*LARGEST_PURCHASE_FIELDS.values(), "ranking"])
    purchases = exclude_unidentified_entities(select_qualifying_spending(frame))
    ranked = purchases.sort_values(by="total_cost", ascending=False).reset_index(drop=True)
    largest = ranked.head(top_n)[list(LARGEST_PURCHASE_FIELDS)].copy()
    largest.columns = list(LARGEST_PURCHASE_FIELDS.values())
    largest["ranking"] = range(1, len(largest) + 1)
    return largest


def calculate_spending_by_entity(frame):
    """Sum spending by identified entity.

    Args:
        frame: A prepared frame.

    Returns:
        A frame of ``entity`` and ``amount``, in alphabetical order.

    Side Effects:
        None.
    """
    if frame.empty:
        return pd.DataFrame(columns=["entity", "amount"])
    spending = exclude_unidentified_entities(select_qualifying_spending(frame))
    by_entity = spending.groupby("entity")["total_cost"].sum().reset_index()
    return by_entity.rename(columns={"total_cost": "amount"})


def calculate_merchant_usage_frequency(frame):
    """Rank identified merchants by how often they were paid.

    Args:
        frame: A prepared frame.

    Returns:
        A frame of ``merchant``, ``transaction_count`` and ``ranking``, most first. Ties stay in
        alphabetical order, and the ranks run 1, 2, 3.

    Side Effects:
        None.
    """
    if frame.empty:
        return pd.DataFrame(columns=["merchant", "transaction_count", "ranking"])
    payments = exclude_unidentified_entities(select_events(frame, "MERCHANT_PAYMENT"))
    counted = payments.groupby("entity")["receipt_no"].count().reset_index()
    counted = counted.rename(columns={"entity": "merchant", "receipt_no": "transaction_count"})
    ranked = counted.sort_values(by="transaction_count", ascending=False, kind="stable")
    ranked = ranked.reset_index(drop=True)
    ranked["ranking"] = ranked.index + 1
    return ranked


def calculate_bill_spending(bills, period_start, period_end):
    """Sum bill payments by entity within the period.

    Args:
        bills: Bill records with ``date``, ``entity`` and ``amount``.
        period_start: First day of the period.
        period_end: Last day of the period.

    Returns:
        One record per entity, in first-seen order: ``bill``, ``amount`` and the ``period``.

    Side Effects:
        None.
    """
    amounts_by_entity = defaultdict(float)
    for bill in filter_by_period(bills, period_start, period_end):
        amounts_by_entity[bill["entity"]] += bill["amount"]
    return [
        {"bill": entity, "amount": amount, "period": {"start": period_start, "end": period_end}}
        for entity, amount in amounts_by_entity.items()
    ]
