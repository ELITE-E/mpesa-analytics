"""Analysis: classified transactions to the report.

The only core package allowed to use pandas, and only for v1 (ADR 0006). pandas loads when
``analyze_transactions`` is first called, never when the core is imported. The rules are in
docs/decisions/analysis-behaviour.md.
"""


def analyze_transactions(rows, period=None):
    """Build the report for classified transactions.

    Args:
        rows: ``ClassifiedRow`` records in print order.
        period: Tuple of start and end, as datetimes or dates. By default, or if either is None,
            the period runs from the earliest to the latest readable completion time.

    Returns:
        The report: a dict of plain JSON values with the sections ``cash_flow``, ``spending``,
        ``bills``, ``investments``, ``transfers`` and ``fees``. The input is not changed.

    Side Effects:
        Imports pandas on first use.
    """
    from mpesa_core.analysis.report import build_report

    return build_report(rows, period)
