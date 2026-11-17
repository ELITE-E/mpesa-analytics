"""A scenario's ledger: its rows, summary and totals in the shape the frontend reads (CP8b).

Written from the behaviour the old contract fixtures described, never from their code:
- each row's balance runs from the opening balance, oldest first;
- a row's total cost is its amount when its meaning is a cost (consumption, unknown or not
  determinable), plus each charge whose receipt it shares; a charge adds to the nearest row
  by position sharing its receipt, the earlier one on a tie, and keeps no cost of its own;
- the summary counts the rows and the unclassified ones;
- the snapshot's totals come from the rows, the other analytics lists empty.

Receipts become their ledger form (``SYN`` and the code, as the scenario named them) unless that
would look like a real receipt, and every printed receipt takes the fake form ADR 0003 declares.
"""

import re
from datetime import datetime

from synth.scenarios import ECONOMIC_MEANING, NO_ENTITY

IMPORTED_AT = "2026-10-22T09:00:00+00:00"
CONTRACT_VERSION = "1.0"
STATUS = "Completed"
COSTED_MEANINGS = {"CONSUMPTION", "UNKNOWN", "NOT_DETERMINABLE"}
SPENDING_TYPES = {"MERCHANT_PAYMENT", "BILL_PAYMENT", "BUNDLE_PURCHASE"}
KNOWN_FEES = {"customer transfer of funds charge", "pay bill charge"}
TRANSFER_CHARGE = "customer transfer of funds charge"
LEDGER_PREFIX = "SYN"
PRINTED_PREFIX = "ZZ"
PRINTED_CODE_LENGTH = 8
RECEIPT_LENGTH = 10
PHONE_MARKER = re.compile(r"\{(\d+)\}")
# The masked fake phone of ADR 0003: 2547, five asterisks, then a tail from 000 to 099.
PHONE_PREFIX = "2547" + "*" * 5 + "0"
TIME_FORMAT = "%Y-%m-%d %H:%M:%S"
CENTS = 100
FEE = "FEE"


def api_ledger(scenario):
    """Build a scenario's ledger as the frontend reads it.

    Args:
        scenario: A ``Scenario``.

    Returns:
        Map of ``name``, ``rows`` (oldest first), ``summary``, ``snapshot``,
        ``printed_receipts`` (one per row, the receipt a printed statement shows) and ``problems``
        (rows whose balance differs from the sample's own; empty when the conversion holds).

    Side Effects:
        None.
    """
    rows, problems = _rows(scenario)
    start, end = rows[0]["completion_time"][:10], rows[-1]["completion_time"][:10]
    return {
        "name": scenario.name,
        "rows": rows,
        "summary": summary(scenario.import_id, rows, start, end),
        "snapshot": snapshot(scenario.import_id, rows, start, end),
        "printed_receipts": [printed_receipt(row.code) for row in scenario.rows],
        "problems": problems,
    }


def printed_rows(scenario):
    """The scenario's rows as a statement prints them: newest first, amounts in cents.

    Args:
        scenario: A printable ``Scenario``.

    Returns:
        Row maps in the generator's shape, each with the event type and entity it was written as.

    Side Effects:
        None.
    """
    ledger_rows, _ = _rows(scenario)
    printed = []
    for source, row in zip(scenario.rows, ledger_rows, strict=True):
        printed.append(
            {
                "time": datetime.strptime(row["completion_time"], TIME_FORMAT),
                "receipt_no": printed_receipt(source.code),
                "details": row["details"],
                "paid_in_cents": source.paid_in_cents,
                "withdrawn_cents": source.paid_out_cents,
                "balance_cents": round(row["balance"] * CENTS),
                "event_type": row["event_type"],
                "entity": None if row["entity"] == NO_ENTITY else row["entity"],
            }
        )
    return list(reversed(printed))


def printed_receipt(code):
    """The fake receipt a printed statement shows for a scenario's receipt code.

    Args:
        code: Up to eight capitals or digits.

    Returns:
        ``ZZ`` and the code, padded with zeros to eight characters.

    Side Effects:
        None.
    """
    return f"{PRINTED_PREFIX}{code.ljust(PRINTED_CODE_LENGTH, '0')}"


def ledger_receipt(code):
    """The receipt the ledger keeps: the scenario's own, unless it would look like a real one.

    Args:
        code: The scenario's receipt code.

    Returns:
        ``SYN`` and the code, or the printed form when that would be ten characters long.

    Side Effects:
        None.
    """
    named = f"{LEDGER_PREFIX}{code}"
    return printed_receipt(code) if len(named) == RECEIPT_LENGTH else named


def fill_phones(text):
    """Put the fake masked phone for each numbered marker in a text.

    Args:
        text: Details or an entity, maybe holding ``{n}`` markers.

    Returns:
        The text with each marker as the fake masked phone: ``2547``, five asterisks, ``0``, then
        the marker's number in two digits.

    Side Effects:
        None.
    """
    return PHONE_MARKER.sub(lambda match: f"{PHONE_PREFIX}{int(match.group(1)):02d}", text)


def fee_linkage(rows):
    """Count charges by how many other rows share their receipt.

    Args:
        rows: Ledger rows.

    Returns:
        Map of ``linked`` (exactly one), ``orphan`` (none) and ``ambiguous`` (several) to counts,
        leaving out kinds with none.

    Side Effects:
        None.
    """
    parents = {}
    for row in rows:
        if row["event_type"] != FEE:
            parents[row["receipt_no"]] = parents.get(row["receipt_no"], 0) + 1
    counts = {}
    for row in rows:
        if row["event_type"] == FEE:
            sharing = parents.get(row["receipt_no"], 0)
            kind = "linked" if sharing == 1 else "orphan" if sharing == 0 else "ambiguous"
            counts[kind] = counts.get(kind, 0) + 1
    return counts


def summary(import_id, rows, start, end):
    """The import summary of a ledger.

    Args:
        import_id: The import's id.
        rows: Ledger rows.
        start: The period's first date.
        end: The period's last date.

    Returns:
        The summary in the frontend's shape.

    Side Effects:
        None.
    """
    unclassified = sum(1 for row in rows if row["event_type"] == "UNCLASSIFIED")
    return {
        "id": import_id,
        "imported_at": IMPORTED_AT,
        "period_start": start,
        "period_end": end,
        "status": "completed",
        "transaction_count": len(rows),
        "previously_imported_transaction_count": 0,
        "unclassified_transaction_count": unclassified,
        "observation_counts": {"unrecognized_event_type": unclassified} if unclassified else {},
    }


def snapshot(import_id, rows, start, end):
    """The analytics snapshot of a ledger: totals from its rows, every list empty.

    Args:
        import_id: The import's id.
        rows: Ledger rows.
        start: The period's first date.
        end: The period's last date.

    Returns:
        The snapshot in the frontend's shape.

    Side Effects:
        None.
    """
    return {
        "import_id": import_id,
        "contract_version": CONTRACT_VERSION,
        "computed_at": IMPORTED_AT,
        "result": _totals(rows, {"start": start, "end": end}),
    }


def _rows(scenario):
    """Build the ledger rows and check them against any balance the sample printed.

    Args:
        scenario: A ``Scenario``.

    Returns:
        Tuple of the rows, oldest first, and the receipts of rows whose balance differs from the
        sample's.

    Side Effects:
        None.
    """
    rows, problems = [], []
    balance = scenario.opening_cents
    for position, source in enumerate(scenario.rows, start=1):
        balance += source.paid_in_cents - source.paid_out_cents
        row = {
            "id": position,
            "receipt_no": ledger_receipt(source.code),
            "completion_time": source.time,
            "details": fill_phones(source.details),
            "transaction_status": STATUS,
            "event_type": source.event_type,
            "entity": fill_phones(source.entity),
            "paid_in": source.paid_in_cents / CENTS,
            "paid_out": source.paid_out_cents / CENTS,
            "total_cost": 0.0,
            "balance": balance / CENTS,
            "cash_flow_direction": "INFLOW" if source.paid_in_cents > 0 else "OUTFLOW",
            "economic_meaning": ECONOMIC_MEANING[source.event_type],
        }
        rows.append(row)
        if source.sample_balance_cents not in (None, balance):
            problems.append(row["receipt_no"])
    _add_costs(rows)
    return rows, problems


def _add_costs(rows):
    """Set each row's total cost: its own cost, plus the charges that belong to it.

    Args:
        rows: Ledger rows, oldest first.

    Side Effects:
        Sets ``total_cost`` on the rows.
    """
    cost_cents = [
        round(row["paid_out"] * CENTS) if row["economic_meaning"] in COSTED_MEANINGS else 0
        for row in rows
    ]
    for index, row in enumerate(rows):
        if row["event_type"] != FEE:
            continue
        parents = [
            position
            for position, other in enumerate(rows)
            if other["receipt_no"] == row["receipt_no"] and other["event_type"] != FEE
        ]
        if parents:
            nearest = min(parents, key=lambda position: abs(position - index))
            cost_cents[nearest] += round(row["paid_out"] * CENTS)
    for row, cents in zip(rows, cost_cents, strict=True):
        row["total_cost"] = cents / CENTS


def _total(rows, field, event_type=None):
    """Add up one amount over rows, optionally of one event type only.

    Args:
        rows: Ledger rows.
        field: The amount's field.
        event_type: Only rows of this type, or every row when None.

    Returns:
        The total.

    Side Effects:
        None.
    """
    return sum(row[field] for row in rows if event_type is None or row["event_type"] == event_type)


def _totals(rows, period):
    """The snapshot's result: totals from the rows, every list empty.

    Args:
        rows: Ledger rows.
        period: Map of ``start`` and ``end``.

    Returns:
        The result in the frontend's shape.

    Side Effects:
        None.
    """
    inflow = sum(row["paid_in"] for row in rows if row["cash_flow_direction"] == "INFLOW")
    outflow = sum(row["paid_out"] for row in rows if row["cash_flow_direction"] == "OUTFLOW")
    spend = sum(row["total_cost"] for row in rows if row["event_type"] in SPENDING_TYPES)
    fees = [row for row in rows if row["event_type"] == FEE]
    known = [row for row in fees if row["details"].casefold() in KNOWN_FEES]
    transfer = [row for row in fees if row["details"].casefold() == TRANSFER_CHARGE]
    return {
        "cash_flow": {
            "total_inflow": inflow,
            "total_outflow": outflow,
            "net_cash_flow": inflow - outflow,
            "closing_balance": rows[-1]["balance"] if rows else 0.0,
        },
        "spending": {
            "monthly_expenditure": (
                [{"month": period["start"][:7], "expenditure": spend}] if spend else []
            ),
            "top_recipients": [],
            "largest_purchases": [],
            "spending_by_entity": [],
            "merchant_usage_frequency": [],
            "recurring_purchases": [],
        },
        "bills": {"recurring_bills": [], "bill_spending": []},
        "investments": {
            "total_investment": {
                "period": period,
                "investment_amount": _total(rows, "paid_out", "INVESTMENT"),
            },
            "by_platform": [],
            "frequency": {"investment_transactions": 0, "dates": [], "frequency": 0},
            "monthly_investment": [],
        },
        "transfers": {
            "total_transfers": {
                "period": period,
                "total_transfer_amount": _total(rows, "paid_out", "TRANSFER_OUT"),
            },
            "total_received": {
                "period": period,
                "total_received": _total(rows, "paid_in", "TRANSFER_IN"),
            },
            "by_recipient_count": [],
            "monthly_transfer_amounts": [],
            "largest_transfers": [],
        },
        "fees": {
            "total_fees": {"period": period, "total_fees": _total(fees, "paid_out")},
            "mpesa_fees": {"period": period, "fee_amount": _total(known, "paid_out")},
            "transfer_charges": {
                "period": period,
                "transfer_charge_amount": _total(transfer, "paid_out"),
            },
        },
    }
