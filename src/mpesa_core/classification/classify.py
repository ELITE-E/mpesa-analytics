"""Classify canonical rows: event type, cash flow direction, economic meaning, total cost, entity.

The rules and their order are in docs/decisions/classification-behaviour.md. Problems are returned
as diagnostics, never logged or written (ADR 0004).
"""

from mpesa_core.classification.entity import extract_entity
from mpesa_core.classification.taxonomy import CashFlowDirection, EconomicMeaning, FinancialEvent
from mpesa_core.errors import DomainRowError

REQUIRED_FIELDS = ("receipt_no", "completion_time", "details", "paid_in", "withdrawn", "balance")
EVENT_CLASSIFICATION_UNRESOLVED = "EVENT_CLASSIFICATION_UNRESOLVED"
ECONOMIC_MEANING_UNRESOLVED = "ECONOMIC_MEANING_UNRESOLVED"
ENTITY_EXTRACTION_UNRESOLVED = "ENTITY_EXTRACTION_UNRESOLVED"
FEE_MARKERS = ("CUSTOMER TRANSFER OF FUNDS CHARGE", "WITHDRAWAL CHARGE", "PAY BILL CHARGE")
# Rules in order, most specific first: (test, words, event type). The broad rules near the end
# would also match texts the earlier rules catch, so the order must not change.
EVENT_RULES = (
    ("starts", ("FUNDS RECEIVED FROM",), FinancialEvent.TRANSFER_IN),
    ("starts", ("DEPOSIT",), FinancialEvent.DEPOSIT),
    ("contains", ("UNIT TRUST INVEST",), FinancialEvent.INVESTMENT),
    ("contains", FEE_MARKERS, FinancialEvent.FEE),
    ("starts", ("MERCHANT PAYMENT",), FinancialEvent.MERCHANT_PAYMENT),
    ("starts", ("PAY BILL",), FinancialEvent.BILL_PAYMENT),
    ("starts", ("CUSTOMER TRANSFER TO",), FinancialEvent.TRANSFER_OUT),
    ("starts", ("WITHDRAWAL",), FinancialEvent.WITHDRAWAL),
    ("contains", ("REVERSAL",), FinancialEvent.REVERSAL),
    ("contains", ("AIRTIME PURCHASE",), FinancialEvent.AIRTIME_PURCHASE),
    ("contains", ("CUSTOMER BUNDLE PURCHASE",), FinancialEvent.BUNDLE_PURCHASE),
    ("all", ("RECHARGE FOR CUSTOMER", "DATA BUNDLES"), FinancialEvent.BUNDLE_PURCHASE),
)
MEANINGS = {
    FinancialEvent.MERCHANT_PAYMENT: EconomicMeaning.CONSUMPTION,
    FinancialEvent.BILL_PAYMENT: EconomicMeaning.CONSUMPTION,
    FinancialEvent.AIRTIME_PURCHASE: EconomicMeaning.CONSUMPTION,
    FinancialEvent.BUNDLE_PURCHASE: EconomicMeaning.CONSUMPTION,
    FinancialEvent.DEPOSIT: EconomicMeaning.INFLOW,
    FinancialEvent.WITHDRAWAL: EconomicMeaning.ASSET_TRANSFER,
    FinancialEvent.INVESTMENT: EconomicMeaning.INVESTMENT,
    FinancialEvent.FEE: EconomicMeaning.FEE,
    FinancialEvent.TRANSFER_IN: EconomicMeaning.INFLOW,
    FinancialEvent.REVERSAL: EconomicMeaning.REVERSAL,
    FinancialEvent.TRANSFER_OUT: EconomicMeaning.NOT_DETERMINABLE,
}
COSTED_MEANINGS = {
    EconomicMeaning.CONSUMPTION,
    EconomicMeaning.UNKNOWN,
    EconomicMeaning.NOT_DETERMINABLE,
}


def classify_transactions(rows):
    """Classify canonical rows, in the old pipeline's order: the classifier, then entities.

    Args:
        rows: ``CanonicalRow`` records in print order.

    Returns:
        Tuple of new ``ClassifiedRow`` records in print order, and the ``Diagnostic`` records: every
        unclassified row, then every row of unknown meaning, then every row with no entity. The
        input is not changed.

    Raises:
        ValueError: If a row lacks a required canonical field. The message names the fields only.
            A row with both a paid in and a paid out amount, or neither, raises ``DomainRowError``
            holding the row's position only (D-05).

    Side Effects:
        None.
    """
    if not rows:
        return [], []
    missing = sorted({field for row in rows for field in REQUIRED_FIELDS if field not in row})
    if missing:
        raise ValueError(f"missing canonical fields: {', '.join(missing)}")
    classified = [_with_event_type(row) for row in rows]
    diagnostics = _diagnostics_for(classified, "event_type", FinancialEvent.UNCLASSIFIED)
    for row_index, row in enumerate(classified):
        row["cash_flow_direction"] = _cash_flow_direction(row_index, row)
        row["economic_meaning"] = economic_meaning_of(row["event_type"])
    diagnostics += _diagnostics_for(classified, "economic_meaning", EconomicMeaning.UNKNOWN)
    for row in classified:
        row["total_cost"] = _base_total_cost(row)
    _attribute_fees(classified)
    for row in classified:
        row["entity"] = extract_entity(row["details"])
    diagnostics += _diagnostics_for(classified, "entity", None)
    return classified, diagnostics


def event_type_of(details):
    """Name the financial event a details text describes.

    Args:
        details: Normalized details text.

    Returns:
        The ``FinancialEvent`` of the first rule that matches, ignoring case, or ``UNCLASSIFIED``.

    Side Effects:
        None.
    """
    text = str(details).upper()
    for test, words, event_type in EVENT_RULES:
        if _rule_matches(test, words, text):
            return event_type
    return FinancialEvent.UNCLASSIFIED


def economic_meaning_of(event_type):
    """Map an event type to its economic meaning.

    Args:
        event_type: A ``FinancialEvent``.

    Returns:
        The ``EconomicMeaning``. A type with no mapping is ``UNKNOWN``, including
        ``LOAN_REPAYMENT``, whose old mapping named a meaning that does not exist (D-02).

    Side Effects:
        None.
    """
    return MEANINGS.get(event_type, EconomicMeaning.UNKNOWN)


def _rule_matches(test, words, text):
    """Apply one event rule.

    Args:
        test: ``starts`` (one of the words starts the text), ``contains`` (one appears in it) or
            ``all`` (every word appears in it).
        words: The words, in capitals.
        text: The details in capitals.

    Returns:
        True if the rule matches.

    Side Effects:
        None.
    """
    if test == "starts":
        return any(text.startswith(word) for word in words)
    if test == "contains":
        return any(word in text for word in words)
    return all(word in text for word in words)


def _with_event_type(row):
    """Start a classified row: withdrawn as a size under the name ``paid_out``, and the event type.

    Args:
        row: A canonical row.

    Returns:
        A new record.

    Side Effects:
        None.
    """
    return {
        **row,
        "paid_out": abs(float(row["withdrawn"])),
        "event_type": event_type_of(row["details"]),
    }


def _cash_flow_direction(row_index, row):
    """Decide whether money came in or went out.

    Args:
        row_index: The row's position, for the error.
        row: A classified row with ``paid_out`` set.

    Returns:
        ``INFLOW`` if paid in is above zero, otherwise ``OUTFLOW`` if paid out is.

    Raises:
        DomainRowError: If both are above zero, or neither is.

    Side Effects:
        None.
    """
    paid_in = float(row["paid_in"])
    paid_out = row["paid_out"]
    if paid_in > 0.0 and paid_out > 0.0:
        raise DomainRowError(row_index)
    if paid_in > 0.0:
        return CashFlowDirection.INFLOW
    if paid_out > 0.0:
        return CashFlowDirection.OUTFLOW
    raise DomainRowError(row_index)


def _base_total_cost(row):
    """Work out a row's cost before fees are attributed.

    Args:
        row: A classified row with its economic meaning.

    Returns:
        Paid out for spending and for outgoing money of unknown purpose; 0.0 for anything else,
        fees included.

    Side Effects:
        None.
    """
    return row["paid_out"] if row["economic_meaning"] in COSTED_MEANINGS else 0.0


def _attribute_fees(rows):
    """Move each fee's cost onto its parent: the nearest non-fee row with the same receipt number.

    Parents are indexed by receipt number (D-07). On a tie the earlier row wins, as before. A fee
    with no parent keeps its cost of 0.0.

    Args:
        rows: Classified rows in print order, with base total costs.

    Side Effects:
        Changes ``total_cost`` on the rows passed in.
    """
    parents = {}
    for position, row in enumerate(rows):
        if row["event_type"] != FinancialEvent.FEE:
            parents.setdefault(row["receipt_no"], []).append(position)
    for position, row in enumerate(rows):
        candidates = (
            parents.get(row["receipt_no"]) if row["event_type"] == FinancialEvent.FEE else None
        )
        if candidates:
            parent = min(candidates, key=lambda candidate: abs(candidate - position))
            rows[parent]["total_cost"] += row["paid_out"]
            row["total_cost"] = 0.0


def _diagnostics_for(rows, field, unresolved):
    """List the rows whose field holds the unresolved value.

    Args:
        rows: Classified rows in print order.
        field: ``event_type``, ``economic_meaning`` or ``entity``.
        unresolved: The value that means unresolved.

    Returns:
        One ``Diagnostic`` per such row, in print order. Details stay in memory only (ADR 0004).

    Side Effects:
        None.
    """
    code = {
        "event_type": EVENT_CLASSIFICATION_UNRESOLVED,
        "economic_meaning": ECONOMIC_MEANING_UNRESOLVED,
        "entity": ENTITY_EXTRACTION_UNRESOLVED,
    }[field]
    return [
        {"code": code, "row_index": row_index, "details": row["details"]}
        for row_index, row in enumerate(rows)
        if row[field] == unresolved
    ]
