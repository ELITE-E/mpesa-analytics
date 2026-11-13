"""Investments: money set aside through investment events, measured by paid out."""

from collections import defaultdict

from mpesa_core.analysis.frame import filter_by_period


def calculate_total_investment(investments, period_start, period_end):
    """Sum the amount invested within the period.

    Args:
        investments: Investment records with ``date`` and ``investment_amount``.
        period_start: First day of the period.
        period_end: Last day of the period.

    Returns:
        The ``period`` and the ``investment_amount``.

    Side Effects:
        None.
    """
    in_period = filter_by_period(investments, period_start, period_end)
    return {
        "period": {"start": period_start, "end": period_end},
        "investment_amount": sum(investment["investment_amount"] for investment in in_period),
    }


def summarize_investments_by_platform(investments, period_start, period_end):
    """Sum the amount invested within the period, by platform.

    Args:
        investments: Investment records with ``date``, ``platform`` and ``investment_amount``.
        period_start: First day of the period.
        period_end: Last day of the period.

    Returns:
        One record per platform, in first-seen order: ``platform`` and ``amount_invested``.

    Side Effects:
        None.
    """
    amounts_by_platform = defaultdict(float)
    for investment in filter_by_period(investments, period_start, period_end):
        amounts_by_platform[investment["platform"]] += investment["investment_amount"]
    return [
        {"platform": platform, "amount_invested": amount}
        for platform, amount in amounts_by_platform.items()
    ]


def calculate_investment_frequency(investments, period_start, period_end):
    """Count the investments within the period.

    Args:
        investments: Investment records with ``date``.
        period_start: First day of the period.
        period_end: Last day of the period.

    Returns:
        The count, under ``investment_transactions`` and again under ``frequency``, and the sorted
        ``dates``.

    Side Effects:
        None.
    """
    in_period = filter_by_period(investments, period_start, period_end)
    return {
        "investment_transactions": len(in_period),
        "dates": sorted(investment["date"] for investment in in_period),
        "frequency": len(in_period),
    }


def calculate_monthly_investment(investments):
    """Sum the amount invested by month, over every investment given.

    Args:
        investments: Investment records with ``date`` and ``investment_amount``.

    Returns:
        One record per month, in date order: ``month`` and ``investment_amount``.

    Side Effects:
        None.
    """
    amounts_by_month = defaultdict(float)
    for investment in investments:
        amounts_by_month[investment["date"].strftime("%Y-%m")] += investment["investment_amount"]
    return [
        {"month": month, "investment_amount": amount}
        for month, amount in sorted(amounts_by_month.items())
    ]
