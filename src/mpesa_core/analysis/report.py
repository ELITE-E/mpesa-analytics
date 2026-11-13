"""Compose the report from the individual analyses, and shape it as plain JSON values.

This module computes no figure itself. The report's keys and order are the old ones exactly; see
docs/decisions/analysis-behaviour.md.
"""

from datetime import date, datetime

import pandas as pd

from mpesa_core.analysis.cash_flow import (
    calculate_closing_balance,
    calculate_net_cash_flow,
    calculate_total_inflow,
    calculate_total_outflow,
)
from mpesa_core.analysis.fees import (
    calculate_mpesa_fees,
    calculate_total_fees,
    calculate_transfer_charges,
)
from mpesa_core.analysis.frame import (
    calendar_records,
    exclude_unidentified_entities,
    prepared_frame,
    resolve_period,
    select_events,
    select_qualifying_spending,
)
from mpesa_core.analysis.investments import (
    calculate_investment_frequency,
    calculate_monthly_investment,
    calculate_total_investment,
    summarize_investments_by_platform,
)
from mpesa_core.analysis.recurrence import find_recurring_bill_payments, find_recurring_purchases
from mpesa_core.analysis.spending import (
    calculate_bill_spending,
    calculate_largest_purchases,
    calculate_merchant_usage_frequency,
    calculate_monthly_expenditure,
    calculate_spending_by_entity,
    get_top_spending_recipients,
)
from mpesa_core.analysis.transfers import (
    calculate_monthly_transfer_amounts,
    calculate_total_received_transfers,
    calculate_total_transfers,
    rank_recipients_by_transfer_count,
    rank_transfers_by_amount,
)

TOP_RECIPIENT_COUNT = 5
LARGEST_PURCHASE_COUNT = 10
TIME_FORMAT = "%Y-%m-%d %H:%M:%S"


def build_report(rows, period=None):
    """Build the report for classified transactions.

    Args:
        rows: ``ClassifiedRow`` records in print order.
        period: Tuple of start and end; None, or a None in it, means the span of the rows.

    Returns:
        The report as plain JSON values, with its six sections in the old order.

    Side Effects:
        None.
    """
    frame = prepared_frame(rows)
    if period is None or None in period:
        period = resolve_period(frame)
    dates = (_calendar_date(period[0]), _calendar_date(period[1]))
    return public_value(
        {
            "cash_flow": _cash_flow_section(frame),
            "spending": _spending_section(frame),
            "bills": _bills_section(frame, dates),
            "investments": _investments_section(frame, dates),
            "transfers": _transfers_section(frame, dates),
            "fees": _fees_section(frame, period),
        }
    )


def public_value(value):
    """Convert a value, and everything inside it, to plain JSON values.

    Args:
        value: A frame, time, date, list, tuple, dict or plain value.

    Returns:
        Frames as lists of records, times as ``YYYY-MM-DD hh:mm:ss``, dates as ``YYYY-MM-DD``,
        tuples as lists, and dict keys as text. A missing time becomes None (A-4).

    Side Effects:
        None.
    """
    if isinstance(value, pd.DataFrame):
        return public_value(value.to_dict(orient="records"))
    if value is pd.NaT:
        return None
    if isinstance(value, datetime):
        return value.strftime(TIME_FORMAT)
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, list | tuple):
        return [public_value(element) for element in value]
    if isinstance(value, dict):
        return {str(key): public_value(element) for key, element in value.items()}
    return value


def _cash_flow_section(frame):
    """Assemble the cash flow section.

    Args:
        frame: A prepared frame.

    Returns:
        The four figures as plain floats.

    Side Effects:
        None.
    """
    return {
        "total_inflow": _as_float(calculate_total_inflow(frame)),
        "total_outflow": _as_float(calculate_total_outflow(frame)),
        "net_cash_flow": _as_float(calculate_net_cash_flow(frame)),
        "closing_balance": _as_float(calculate_closing_balance(frame)),
    }


def _spending_section(frame):
    """Assemble the spending section.

    Spending by entity and recurring purchases are ordered by each entity's most recent row.

    Args:
        frame: A prepared frame.

    Returns:
        The six spending figures.

    Side Effects:
        None.
    """
    identified = exclude_unidentified_entities(select_qualifying_spending(frame))
    recurring = find_recurring_purchases(calendar_records(identified))
    return {
        "monthly_expenditure": calculate_monthly_expenditure(frame),
        "top_recipients": get_top_spending_recipients(frame, top_n=TOP_RECIPIENT_COUNT),
        "largest_purchases": calculate_largest_purchases(frame, top_n=LARGEST_PURCHASE_COUNT),
        "spending_by_entity": _newest_entity_first(calculate_spending_by_entity(frame), identified),
        "merchant_usage_frequency": calculate_merchant_usage_frequency(frame),
        "recurring_purchases": _newest_recurring_first(recurring, "merchant", identified),
    }


def _bills_section(frame, dates):
    """Assemble the bills section.

    Args:
        frame: A prepared frame.
        dates: The period as two calendar dates.

    Returns:
        Recurring bills, ordered by each bill's most recent payment, and spending per bill.

    Side Effects:
        None.
    """
    bills = select_events(frame, "BILL_PAYMENT")
    records = calendar_records(bills)
    recurring = find_recurring_bill_payments(records, *dates)
    return {
        "recurring_bills": _newest_recurring_first(recurring, "bill", bills),
        "bill_spending": calculate_bill_spending(records, *dates),
    }


def _investments_section(frame, dates):
    """Assemble the investments section.

    Args:
        frame: A prepared frame.
        dates: The period as two calendar dates.

    Returns:
        The four investment figures.

    Side Effects:
        None.
    """
    records = calendar_records(select_events(frame, "INVESTMENT"))
    return {
        "total_investment": calculate_total_investment(records, *dates),
        "by_platform": summarize_investments_by_platform(records, *dates),
        "frequency": calculate_investment_frequency(records, *dates),
        "monthly_investment": calculate_monthly_investment(records),
    }


def _transfers_section(frame, dates):
    """Assemble the transfers section: money sent by paid out, money received by paid in.

    Args:
        frame: A prepared frame.
        dates: The period as two calendar dates.

    Returns:
        The five transfer figures.

    Side Effects:
        None.
    """
    sent = calendar_records(select_events(frame, "TRANSFER_OUT"), amount_from="paid_out")
    received = calendar_records(select_events(frame, "TRANSFER_IN"), amount_from="paid_in")
    return {
        "total_transfers": calculate_total_transfers(sent, *dates),
        "total_received": calculate_total_received_transfers(received, *dates),
        "by_recipient_count": rank_recipients_by_transfer_count(sent, *dates),
        "monthly_transfer_amounts": calculate_monthly_transfer_amounts(sent, *dates),
        "largest_transfers": rank_transfers_by_amount(sent, *dates),
    }


def _fees_section(frame, period):
    """Assemble the fees section. Fees are compared at full time, and reported with dates.

    Args:
        frame: A prepared frame.
        period: The period as given: two datetimes, or two dates.

    Returns:
        The three fee figures, each with a date-only period.

    Side Effects:
        None.
    """
    figures = {
        "total_fees": calculate_total_fees(frame, *period),
        "mpesa_fees": calculate_mpesa_fees(frame, *period),
        "transfer_charges": calculate_transfer_charges(frame, *period),
    }
    reported_period = {"start": _calendar_date(period[0]), "end": _calendar_date(period[1])}
    return {name: {**figure, "period": reported_period} for name, figure in figures.items()}


def _newest_entity_first(by_entity, source):
    """Reorder a per-entity frame so the entity with the most recent row comes first.

    Args:
        by_entity: A frame with an ``entity`` column.
        source: The lines the figures came from.

    Returns:
        The frame reordered; equal recency keeps the earlier order.

    Side Effects:
        None.
    """
    if by_entity.empty:
        return by_entity
    most_recent = source["completion_time"].groupby(source["entity"]).max()
    ordered = by_entity.assign(_recency=by_entity["entity"].map(most_recent))
    ordered = ordered.sort_values(by="_recency", ascending=False, kind="stable")
    return ordered.drop(columns="_recency").reset_index(drop=True)


def _newest_recurring_first(recurring, name_key, source):
    """Reorder recurring records so the entity with the most recent row comes first.

    Args:
        recurring: Recurring records.
        name_key: Field holding each record's entity.
        source: The lines the records came from.

    Returns:
        The records reordered; equal recency keeps the earlier order.

    Side Effects:
        None.
    """
    if not recurring:
        return recurring
    most_recent = source["completion_time"].groupby(source["entity"]).max()
    return sorted(recurring, key=lambda found: most_recent.get(found[name_key]), reverse=True)


def _as_float(value):
    """Give a figure as a plain float.

    Args:
        value: A number, possibly a pandas one.

    Returns:
        The float, or 0.0 if the value is not a number.

    Side Effects:
        None.
    """
    try:
        return float(value)
    except TypeError, ValueError:
        return 0.0


def _calendar_date(moment):
    """Give the calendar date of a datetime.

    Args:
        moment: A datetime or a date.

    Returns:
        The date; a date is returned as it is.

    Side Effects:
        None.
    """
    return moment.date() if isinstance(moment, datetime) else moment
