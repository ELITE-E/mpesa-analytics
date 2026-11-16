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

    Raises:
        AnalysisError: If pandas fails part way. ``DATE_UNREADABLE``, with the first such row,
            when a completion time cannot be read (A-3: the old code also stops there);
            otherwise ``ANALYSIS_FAILED``. The pandas error, which may quote a value, is kept
            as the cause only, so the message holds no statement value (ADR 0004).

    Side Effects:
        Imports pandas on first use.
    """
    from mpesa_core.analysis.frame import first_unreadable_date
    from mpesa_core.analysis.report import build_report
    from mpesa_core.errors import AnalysisCode, AnalysisError

    try:
        return build_report(rows, period)
    except (TypeError, ValueError) as error:
        row_index = first_unreadable_date(rows)
        if row_index is None:
            raise AnalysisError(AnalysisCode.ANALYSIS_FAILED) from error
        raise AnalysisError(AnalysisCode.DATE_UNREADABLE, row_index=row_index) from error
