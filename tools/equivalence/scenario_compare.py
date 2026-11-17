#!/usr/bin/env python3
"""Compare the core with each contract scenario's own ledger (CP8b, owner decision A). Counts only.

Each printable scenario's statement pages (``<name>.model.json``, what pdf.js reads from its PDF)
go through ``pipeline.run``; each transaction is set beside the ledger row the scenario wrote for
it, matched by position, oldest first. Every differing field is counted, as a finding about the
core or about the scenario's hand-written labels; nothing is changed. A scenario the core refuses
prints its error code.

    python tools/equivalence/scenario_compare.py
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from mpesa_core import pipeline  # noqa: E402
from mpesa_core.errors import CoreError  # noqa: E402
from synth.generate import SCENARIO_FIXTURES  # noqa: E402

FIXTURES = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "synthetic"
NO_ENTITY = "NO_ENTITY_IDENTIFIED"
CENTS = 100
# Ledger field: the core's field. Receipts are compared with what the statement printed.
TEXT_FIELDS = {
    "completion_time": "completion_time",
    "details": "details",
    "event_type": "event_type",
    "entity": "entity",
    "economic_meaning": "economic_meaning",
    "cash_flow_direction": "cash_flow_direction",
}
AMOUNT_FIELDS = {"paid_in": "paid_in", "paid_out": "paid_out", "balance": "balance"}
COST_FIELD = "total_cost"


def main():
    """Compare every printable scenario and print the counts.

    Returns:
        Process exit code: 0 (findings are counts, not failures).

    Side Effects:
        Reads the fixtures, runs the core, and prints one line per count.
    """
    for name in SCENARIO_FIXTURES:
        model = FIXTURES / f"{name}.model.json"
        if model.is_file():
            for line in compare_scenario(name):
                print(line)
    return 0


def compare_scenario(name):
    """Compare the core's reading of one scenario with its ledger.

    Args:
        name: The scenario's name.

    Returns:
        Count lines: rows on each side, then the rows differing in each field; or one error line.

    Side Effects:
        Reads the scenario's files and runs the core.
    """
    pages = json.loads((FIXTURES / f"{name}.model.json").read_text(encoding="utf-8"))
    ledger = json.loads((FIXTURES / f"{name}.api.json").read_text(encoding="utf-8"))
    try:
        pipeline_result = pipeline.run(pages)
    except CoreError as error:
        return [f"{name} core_error: {getattr(error.code, 'name', error.code)}"]
    core_rows = list(reversed(pipeline_result["transactions"]))
    ledger_rows = ledger["rows"]
    lines = [
        f"{name} rows_ledger: {len(ledger_rows)}",
        f"{name} rows_core: {len(core_rows)}",
    ]
    pairs = list(zip(ledger_rows, core_rows, ledger["printed_receipts"], strict=False))
    lines.append(
        f"{name} differ receipt_no: "
        f"{sum(core['receipt_no'] != printed for _, core, printed in pairs)}"
    )
    for ledger_field, core_field in TEXT_FIELDS.items():
        differing = sum(
            _text(row[ledger_field]) != _text(core[core_field]) for row, core, _ in pairs
        )
        lines.append(f"{name} differ {ledger_field}: {differing}")
    for ledger_field, core_field in {**AMOUNT_FIELDS, COST_FIELD: COST_FIELD}.items():
        differing = sum(
            _cents(row[ledger_field]) != _cents(core[core_field]) for row, core, _ in pairs
        )
        lines.append(f"{name} differ {ledger_field}: {differing}")
    return lines


def _text(value):
    """Compare texts as the frontend shows them: no entity is the not-identified marker.

    Args:
        value: A text or None.

    Returns:
        The text.

    Side Effects:
        None.
    """
    return NO_ENTITY if value is None else str(value)


def _cents(value):
    """Turn an amount into whole cents, with no amount as zero.

    Args:
        value: A number or None.

    Returns:
        The cents.

    Side Effects:
        None.
    """
    return round((value or 0) * CENTS)


if __name__ == "__main__":
    sys.exit(main())
