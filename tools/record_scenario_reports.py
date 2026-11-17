#!/usr/bin/env python3
"""Record the core's report on the scenarios whose frontend tests need one (CP8b, decision A).

The old tests used the backend's analytics on the prototype sample and the five edge-case
statements, so their screens render real lists and links. This runs the core's analysis on each
scenario ledger's rows (``<name>.api.json``, from the generator) and writes ``<name>.report.json``
beside it. The generator cannot do this, because it must not import the core, so each report is a
recorded fixture: its manifest entry names its source and engine, as the pdf.js recordings do.

    python tools/record_scenario_reports.py
"""

import hashlib
import json
import sys
from pathlib import Path

from mpesa_core.analysis import analyze_transactions

FIXTURES = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "synthetic"
MANIFEST_NAME = "MANIFEST.toml"
RECORDED_MARKER = "\n[[recorded]]"
REPORT_SUFFIX = ".report.json"
LEDGER_SUFFIX = ".api.json"
ENGINE = "mpesa_core analysis"
NO_ENTITY = "NO_ENTITY_IDENTIFIED"
REPORTED_SCENARIOS = (
    "F5-prototype-converted",
    "S-stress-overview",
    "S-no-spending",
    "S-people-edge-cases",
    "S-savings-edge-cases",
    "S-cash-edge-cases",
)


def main():
    """Write every report and rewrite the manifest's report entries.

    Returns:
        Process exit code, 0 on success.

    Side Effects:
        Writes the reports and the manifest, and prints each report's size.
    """
    entries = []
    for name in REPORTED_SCENARIOS:
        content = report_bytes(name, FIXTURES)
        (FIXTURES / f"{name}{REPORT_SUFFIX}").write_bytes(content)
        print(f"{name}{REPORT_SUFFIX}: {len(content)} bytes")
        source = (FIXTURES / f"{name}{LEDGER_SUFFIX}").read_bytes()
        entries.append(
            f"{RECORDED_MARKER}\n"
            f'path = "{name}{REPORT_SUFFIX}"\n'
            f'source = "{name}{LEDGER_SUFFIX}"\n'
            f'source_sha256 = "{hashlib.sha256(source).hexdigest()}"\n'
            f'engine = "{ENGINE}"\n'
            f'sha256 = "{hashlib.sha256(content).hexdigest()}"\n'
        )
    write_recorded_section(FIXTURES / MANIFEST_NAME, entries)
    return 0


def report_bytes(name, fixtures):
    """The core's report on one scenario's ledger, as the bytes the fixture holds.

    Args:
        name: The scenario's name.
        fixtures: The directory holding its ``.api.json``.

    Returns:
        UTF-8 JSON with the engine and the report, keys sorted, ending in a newline.

    Side Effects:
        Reads the ledger; imports pandas on first use.
    """
    ledger = json.loads((fixtures / f"{name}{LEDGER_SUFFIX}").read_text(encoding="utf-8"))
    rows = ledger["rows"]
    # The core reads transactions in print order, newest first.
    transactions = [_classified(row) for row in reversed(rows)]
    report = analyze_transactions(transactions, closing_balance=rows[-1]["balance"])
    content = {"engine": ENGINE, "report": report}
    return (json.dumps(content, indent=1, sort_keys=True, ensure_ascii=False) + "\n").encode()


def write_recorded_section(manifest, entries):
    """Replace the manifest's report entries, keeping every other recorded entry.

    Args:
        manifest: Path of the manifest.
        entries: The new report entries, each starting with the recorded marker.

    Side Effects:
        Rewrites the manifest.
    """
    head, *blocks = manifest.read_text(encoding="utf-8").split(RECORDED_MARKER)
    kept = [
        f"{RECORDED_MARKER}{block}"
        for block in blocks
        if f'{REPORT_SUFFIX}"' not in block.split("\n", 2)[1]
    ]
    manifest.write_text("".join([head, *kept, *entries]), encoding="utf-8")


def _classified(row):
    """Turn a ledger row into the core's transaction record.

    Args:
        row: A row in the frontend's shape.

    Returns:
        A ``ClassifiedRow``: ``transaction_status`` as ``status``, the amount out as both
        ``withdrawn`` and ``paid_out``, and no entity for the not-identified marker.

    Side Effects:
        None.
    """
    return {
        "receipt_no": row["receipt_no"],
        "completion_time": row["completion_time"],
        "details": row["details"],
        "status": row["transaction_status"],
        "paid_in": row["paid_in"],
        "withdrawn": row["paid_out"],
        "paid_out": row["paid_out"],
        "balance": row["balance"],
        "event_type": row["event_type"],
        "cash_flow_direction": row["cash_flow_direction"],
        "economic_meaning": row["economic_meaning"],
        "total_cost": row["total_cost"],
        "entity": None if row["entity"] == NO_ENTITY else row["entity"],
    }


if __name__ == "__main__":
    sys.exit(main())
