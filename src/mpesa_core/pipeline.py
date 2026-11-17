"""Statement pages to the result: every stage once, in order, with no I/O and no clock.

pandas is loaded by the analysis step and by nothing before it (ADR 0006), so a statement that
fails attestation, row building or classification never loads it.
"""

from datetime import datetime

from mpesa_core.analysis import analyze_transactions
from mpesa_core.classification.classify import classify_transactions
from mpesa_core.cleaning.canonicalize import canonicalize_rows
from mpesa_core.contracts import SCHEMA_VERSION
from mpesa_core.extraction.rows import build_rows
from mpesa_core.reconciliation.account import account_digest
from mpesa_core.reconciliation.attest import attest, verification_instruction
from mpesa_core.reconciliation.reconcile import measure_balances, measure_unclassified, reconcile

COMPLETION_TIME_FORMAT = "%Y-%m-%d %H:%M:%S"
CLASS_FIELDS = ("event_type", "cash_flow_direction", "economic_meaning")


def run(statement_pages, *, processed_at=None):
    """Turn one statement's pages into its result.

    Attestation runs first, so pages that are not an M-PESA statement stop before any row is read.

    Errors the stages raise pass through unchanged: ``AttestationError`` if page 1 does not show an
    M-PESA statement and its token; ``ExtractionError`` ``LAYOUT_UNRECOGNIZED`` if no row can be
    built; ``DomainRowError`` if a row has both a paid in and a withdrawn amount, or neither;
    ``AnalysisError`` if the analysis cannot read a completion time, or otherwise stops.

    Args:
        statement_pages: The ``StatementPages`` from the PDF reader. Any other key it carries is
            ignored and never reaches the result.
        processed_at: A time chosen by the caller, carried into the result as given.

    Returns:
        A ``PipelineResult`` of plain JSON values. The input is not changed. Page 1's mobile
        number is carried only as its digest, which must never be persisted.

    Side Effects:
        Imports pandas on the first run that reaches the analysis.
    """
    verification_token = attest(statement_pages)
    rows = build_rows(statement_pages)
    classified, diagnostics = classify_transactions(canonicalize_rows(rows))
    transactions = [_with_plain_classes(transaction) for transaction in classified]
    digest = account_digest(statement_pages)
    quality = {
        **reconcile(statement_pages, rows),
        **measure_unclassified(transactions),
        "account_number_unreadable": digest is None,
    }
    balances = measure_balances(rows, quality["chain_orientation"])
    # The report's closing balance follows the same print-order rule as balances (T-4).
    report = analyze_transactions(transactions, closing_balance=balances["closing_balance"])
    return {
        "schema_version": SCHEMA_VERSION,
        "verification_token": verification_token,
        "verification_instruction": verification_instruction(statement_pages),
        "account_digest": digest,
        "processed_at": processed_at,
        "period": measure_period(transactions),
        "balances": balances,
        "transactions": transactions,
        "report": report,
        "quality": quality,
        "diagnostics": diagnostics,
    }


def measure_period(transactions):
    """Find the earliest and latest completion times that can be read.

    Args:
        transactions: Records with a printed ``completion_time``.

    Returns:
        A ``Period`` of the two times as printed; both None if no time can be read.

    Side Effects:
        None.
    """
    readable = sorted(
        transaction["completion_time"]
        for transaction in transactions
        if _is_readable_time(transaction["completion_time"])
    )
    if not readable:
        return {"start": None, "end": None}
    return {"start": readable[0], "end": readable[-1]}


def _is_readable_time(completion_time):
    """Tell whether a completion time is a real date and time in the printed format.

    Args:
        completion_time: The printed completion time, or None.

    Returns:
        True if it reads, so its text also sorts in time order.

    Side Effects:
        None.
    """
    if not isinstance(completion_time, str):
        return False
    try:
        datetime.strptime(completion_time, COMPLETION_TIME_FORMAT)
    except ValueError:
        return False
    return True


def _with_plain_classes(transaction):
    """Give a transaction's classes as plain text, so the result holds only JSON values.

    Args:
        transaction: A ``ClassifiedRow``, whose classes may be enum members.

    Returns:
        A new record with each class as plain text; the values compare equal to the members.

    Side Effects:
        None.
    """
    return {**transaction, **{field: str(transaction[field]) for field in CLASS_FIELDS}}
