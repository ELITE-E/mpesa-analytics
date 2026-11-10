#!/usr/bin/env python3
"""Compare the old extractor's rows with the new row builder's, on the owner's machine.

The new rows come from the real pdf.js adapter through ``extract_pages_cli.mjs``, whose output is
deleted afterwards. Rows are aligned by an HMAC of the receipt number under a key made for this run,
so no receipt number is ever compared or held in the clear beyond the rows themselves.

Output is fixed labels, counts and PASS or FAIL, never statement text or a path. ``--share`` is safe
to paste. Without it the tool also lists each mismatch's page and line, for looking on your own
screen. If the PDF needs a password, the CLI asks with a hidden prompt.

    python tools/equivalence/compare.py --pdf PATH --baseline FILE --share
"""

import argparse
import hashlib
import hmac
import json
import math
import os
import re
import secrets
import subprocess
import sys
import tempfile
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

from mpesa_core.classification.classify import classify_transactions
from mpesa_core.classification.taxonomy import CashFlowDirection, EconomicMeaning, FinancialEvent
from mpesa_core.cleaning.canonicalize import canonicalize_rows
from mpesa_core.errors import DomainRowError, ExtractionError
from mpesa_core.extraction.rows import assemble_rows
from mpesa_core.reconciliation.reconcile import find_chain_breaks, reconcile

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "tools" / "guards"))
from run_node_tool import PINNED_NODE, resolve_node  # noqa: E402

EXTRACT_CLI = REPO / "tools" / "pdf_readers" / "extract_pages_cli.mjs"
PAGES_NAME = "pages.json"
RECEIPT_FIELD = "receipt_no"
SEVEN_FIELDS = (
    RECEIPT_FIELD,
    "completion_time",
    "details",
    "status",
    "paid_in",
    "withdrawn",
    "balance",
)
GATED_FIELDS = ("completion_time", "paid_in", "withdrawn", "balance")
FAILED = 1
CANNOT_RUN = 2
BASELINE_UNREADABLE = "BASELINE_UNREADABLE"
CANONICAL_UNREADABLE = "CANONICAL_UNREADABLE"
CANONICAL_NAME = "canonical.json"
OLD_STATUS_FIELD = "transaction_status"
CANONICAL_TEXT_FIELDS = ("completion_time", "details", "status")
CANONICAL_AMOUNT_FIELDS = ("paid_in", "withdrawn", "balance")
CLASSIFIED_UNREADABLE = "CLASSIFIED_UNREADABLE"
CLASSIFIED_NAME = "classified.json"
OLD_NO_ENTITY = "NO_ENTITY_IDENTIFIED"
# Each class field, its gate's label, and the class names that may print.
CLASS_FIELDS = {
    "event_type": ("event_type", frozenset(FinancialEvent)),
    "cash_flow_direction": ("direction", frozenset(CashFlowDirection)),
    "economic_meaning": ("meaning", frozenset(EconomicMeaning)),
}
CLASSIFIED_AMOUNT_FIELDS = ("total_cost", "paid_out")
HALF_CENT = 0.005
EXTRACTION_FAILED = "EXTRACTION_FAILED"
CLI_ERROR_CODE = re.compile(r"ERROR \(([A-Z_]+)\)")
HMAC_KEY_BYTES = 32
# A status only shows if it reads like a status and is common, so a name or a stray fragment of
# details that landed in the status column stays hidden.
SHOWABLE_STATUS = re.compile(r"[A-Za-z ]{3,20}")
SHOWABLE_STATUS_MINIMUM = 20
OTHER_STATUS = "OTHER"
SUMMARY_WORDS = {True: "true", False: "false", None: "not_found"}


@dataclass(frozen=True)
class OldSide:
    """Everything the old code produced: extracted rows, canonical rows and classified rows."""

    rows: list
    canonical: list
    classified: list


class CompareError(Exception):
    """The comparison could not run. Holds a code, never a message from a tool or a statement."""

    def __init__(self, code):
        """Record why.

        Args:
            code: The fixed code to print.

        Side Effects:
            None.
        """
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class AlignedRows:
    """Both sides' rows, and which pairs share a receipt number and occurrence."""

    old_rows: list
    new_rows: list
    old_keys: list
    new_keys: list
    # Tuples of old row, new row and the new row's print position.
    matched: list


def main():
    """Run the comparison named on the command line.

    Returns:
        Process exit code: 0 if every gate passes, 1 if one fails, 2 if it could not run.

    Side Effects:
        Reads the baseline, runs the extract CLI (which may prompt), writes and deletes a temporary
        file outside the repo, and prints counts.
    """
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--pdf", type=Path, required=True)
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--share", action="store_true")
    args = parser.parse_args()
    try:
        old = OldSide(
            _read_baseline(args.baseline),
            _read_canonical(args.baseline.parent / CANONICAL_NAME),
            _read_classified(args.baseline.parent / CLASSIFIED_NAME),
        )
        statement_pages = _extract_statement_pages(args.pdf)
        assembly = assemble_rows(statement_pages)
        new_classified = classify_transactions(canonicalize_rows(assembly["rows"]))[0]
    except CompareError as error:
        print(f"compare: ERROR ({error.code})")
        return CANNOT_RUN
    except ExtractionError as error:
        print(f"compare: ERROR ({error.code.value})")
        return CANNOT_RUN
    except DomainRowError as error:
        print(f"compare: ERROR (CLASSIFICATION_STOPPED at row {error.row_index})")
        return CANNOT_RUN
    lines, gates = build_report(old, assembly, new_classified, statement_pages)
    lines += [] if args.share else _mismatch_positions(old.rows, assembly)
    print("\n".join(lines))
    return 0 if all(verdict for verdict, _ in gates) else FAILED


def build_report(old, assembly, new_classified, statement_pages):
    """Compare both sides and describe the outcome in counts.

    Args:
        old: The old code's rows, as an ``OldSide``.
        assembly: The new ``RowAssembly``.
        new_classified: The new rows, cleaned and classified, in print order.
        statement_pages: The statement pages the new rows came from.

    Returns:
        Tuple of the report's lines, ending in the verdicts, and the gates as tuples of whether
        each passed and its label.

    Side Effects:
        None.
    """
    aligned = _align(old.rows, assembly["rows"])
    old_quality = reconcile(statement_pages, aligned.old_rows)
    new_quality = reconcile(statement_pages, aligned.new_rows)
    field_mismatches = _count_field_mismatches(aligned)
    status_counts = _status_matrix(aligned)
    chain_lines, chain_gate = _chain_report(aligned, old_quality, new_quality)
    canonical_lines, canonical_gates = _canonical_report(
        old.canonical, canonicalize_rows(assembly["rows"])
    )
    classified_lines, classified_gates = _classified_report(old.classified, new_classified)
    gates = [
        *_row_and_field_gates(aligned, field_mismatches),
        _status_gate(aligned, field_mismatches["status"], status_counts),
        chain_gate,
        *canonical_gates,
        *classified_gates,
    ]
    lines = [
        *_row_count_lines(aligned),
        *[f"mismatch_{field}: {count}" for field, count in field_mismatches.items()],
        *[
            f"status_old_new {old_status} x {new_status}: {count}"
            for (old_status, new_status), count in sorted(status_counts.items())
        ],
        *_feature_lines(aligned, assembly),
        *chain_lines,
        *_summary_lines("old", old_quality),
        *_summary_lines("new", new_quality),
        *_layout_lines(assembly, new_quality),
        *canonical_lines,
        *classified_lines,
        *_chain_breaks_by_event_type(aligned.new_rows, new_classified, new_quality),
        *[f"{'PASS' if verdict else 'FAIL'} {label}" for verdict, label in gates],
        f"RESULT: {'PASS' if all(verdict for verdict, _ in gates) else 'FAIL'}",
    ]
    return lines, gates


def _read_baseline(baseline_path):
    """Read and check the baseline written by ``export_baseline.py``.

    Args:
        baseline_path: Path of the baseline.

    Returns:
        Rows with the seven fields and an empty position, so the core can read them.

    Raises:
        CompareError: ``BASELINE_UNREADABLE`` if the file is missing or has the wrong shape.

    Side Effects:
        Reads the file.
    """
    try:
        rows = json.loads(baseline_path.read_text(encoding="utf-8"))["rows"]
        return [_as_raw_row(row) for row in rows]
    except (OSError, ValueError, KeyError, TypeError) as error:
        raise CompareError(BASELINE_UNREADABLE) from error


def _read_canonical(canonical_path):
    """Read the old cleaning step's rows that ``export_baseline.py`` wrote beside the baseline.

    Args:
        canonical_path: Path of ``canonical.json``.

    Returns:
        Rows under this repo's field names: the old ``transaction_status`` becomes ``status``.

    Raises:
        CompareError: ``CANONICAL_UNREADABLE`` if the file is missing or has the wrong shape.

    Side Effects:
        Reads the file.
    """
    try:
        rows = json.loads(canonical_path.read_text(encoding="utf-8"))["rows"]
        return [_as_canonical_row(row) for row in rows]
    except (OSError, ValueError, KeyError, TypeError) as error:
        raise CompareError(CANONICAL_UNREADABLE) from error


def _read_classified(classified_path):
    """Read the old classifier's rows that ``export_baseline.py`` wrote beside the baseline.

    Args:
        classified_path: Path of ``classified.json``.

    Returns:
        Rows holding the receipt number, the three classes, the entity and the two amounts. The
        old marker for no entity becomes None, which is how this repo says it.

    Raises:
        CompareError: ``CLASSIFIED_UNREADABLE`` if the file is missing or has the wrong shape.

    Side Effects:
        Reads the file.
    """
    try:
        rows = json.loads(classified_path.read_text(encoding="utf-8"))["rows"]
        return [_as_classified_row(row) for row in rows]
    except (OSError, ValueError, KeyError, TypeError) as error:
        raise CompareError(CLASSIFIED_UNREADABLE) from error


def _as_classified_row(row):
    """Check one old classified row.

    Args:
        row: Map holding the receipt number, classes, entity and amounts.

    Returns:
        The row, with the no-entity marker as None and amounts as floats.

    Raises:
        TypeError: If a text field is not text or None, or an amount is not a number.

    Side Effects:
        None.
    """
    classified = {field: row[field] for field in (RECEIPT_FIELD, *CLASS_FIELDS, "entity")}
    for value in classified.values():
        _cell(value)
    if classified["entity"] == OLD_NO_ENTITY:
        classified["entity"] = None
    for field in CLASSIFIED_AMOUNT_FIELDS:
        if isinstance(row[field], bool) or not isinstance(row[field], int | float):
            raise TypeError
        classified[field] = float(row[field])
    return classified


def _as_canonical_row(row):
    """Check one old canonical row and give it this repo's field names.

    Args:
        row: Map holding the old cleaning step's seven fields.

    Returns:
        The row with text fields as given and amounts as floats.

    Raises:
        TypeError: If a text field is not text or None, or an amount is not a number.

    Side Effects:
        None.
    """
    canonical = {
        RECEIPT_FIELD: row[RECEIPT_FIELD],
        "completion_time": row["completion_time"],
        "details": row["details"],
        "status": row[OLD_STATUS_FIELD],
    }
    for value in canonical.values():
        _cell(value)
    for field in CANONICAL_AMOUNT_FIELDS:
        if isinstance(row[field], bool) or not isinstance(row[field], int | float):
            raise TypeError
        canonical[field] = float(row[field])
    return canonical


def _as_raw_row(row):
    """Turn a baseline row into the shape the core reads, without changing what it says.

    Args:
        row: Map holding the seven fields.

    Returns:
        A ``RawRow`` with blank cells as None. The old side has no position, so page and line are 0.

    Side Effects:
        None.
    """
    raw_row = {field: _cell(row[field]) or None for field in SEVEN_FIELDS}
    return {**raw_row, "completion_time": raw_row["completion_time"] or "", "page": 0, "line": 0}


def _cell(value):
    """Read a cell for comparison, where None and an empty string are equal after strip.

    Args:
        value: The cell, as text or None.

    Returns:
        The stripped text.

    Raises:
        TypeError: If the cell is neither, which means the baseline has the wrong shape.

    Side Effects:
        None.
    """
    if value is not None and not isinstance(value, str):
        raise TypeError
    return (value or "").strip()


def _extract_statement_pages(pdf_path):
    """Run the pdf.js adapter through its CLI and read what it wrote.

    Stdin and stderr stay connected to the terminal, so the CLI's hidden prompt reaches the owner.

    Args:
        pdf_path: Path of the statement PDF.

    Returns:
        The statement pages.

    Raises:
        CompareError: With the code the CLI reported.

    Side Effects:
        Runs Node, which may prompt. Writes a temporary owner-only file and deletes it.
    """
    node = resolve_node(PINNED_NODE, os.environ.get("PATH", ""))
    if node is None:
        raise CompareError(EXTRACTION_FAILED)
    with tempfile.TemporaryDirectory() as scratch:
        pages_path = Path(scratch) / PAGES_NAME
        completed = subprocess.run(
            [node, str(EXTRACT_CLI), str(pdf_path), "--out", str(pages_path)],
            stdout=subprocess.PIPE,
            text=True,
            check=False,
        )
        if completed.returncode != 0:
            reported = CLI_ERROR_CODE.search(completed.stdout)
            raise CompareError(reported.group(1) if reported else EXTRACTION_FAILED)
        return json.loads(pages_path.read_text(encoding="utf-8"))


def _align(old_rows, new_rows):
    """Pair rows by an HMAC of receipt number and occurrence, under a key made for this call.

    Args:
        old_rows: The old rows, in print order.
        new_rows: The new rows, in print order.

    Returns:
        The ``AlignedRows``. The key is gone when this returns; only digests remain.

    Side Effects:
        None.
    """
    run_key = secrets.token_bytes(HMAC_KEY_BYTES)
    old_keys = _row_keys(old_rows, run_key)
    new_keys = _row_keys(new_rows, run_key)
    old_by_key = dict(zip(old_keys, old_rows, strict=True))
    matched = [
        (old_by_key[key], new_row, position)
        for position, (key, new_row) in enumerate(zip(new_keys, new_rows, strict=True))
        if key in old_by_key
    ]
    return AlignedRows(old_rows, new_rows, old_keys, new_keys, matched)


def _row_keys(rows, run_key):
    """Give each row a digest of its receipt number and its occurrence among equal receipts.

    Args:
        rows: Rows in print order.
        run_key: The key for this run.

    Returns:
        One digest per row.

    Side Effects:
        None.
    """
    seen = Counter()
    keys = []
    for row in rows:
        receipt = _cell(row[RECEIPT_FIELD])
        message = f"{receipt}\0{seen[receipt]}".encode()
        keys.append(hmac.new(run_key, message, hashlib.sha256).digest())
        seen[receipt] += 1
    return keys


def _row_count_lines(aligned):
    """Report how many rows each side has and how they paired.

    Args:
        aligned: The aligned rows.

    Returns:
        Report lines.

    Side Effects:
        None.
    """
    matched_keys = set(aligned.old_keys) & set(aligned.new_keys)
    old_order = [key for key in aligned.old_keys if key in matched_keys]
    new_order = [key for key in aligned.new_keys if key in matched_keys]
    order_differences = sum(old != new for old, new in zip(old_order, new_order, strict=True))
    return [
        f"rows_old: {len(aligned.old_rows)}",
        f"rows_new: {len(aligned.new_rows)}",
        f"matched: {len(aligned.matched)}",
        f"old_only: {len(aligned.old_rows) - len(aligned.matched)}",
        f"new_only: {len(aligned.new_rows) - len(aligned.matched)}",
        f"print_order_differences: {order_differences}",
    ]


def _count_field_mismatches(aligned):
    """Count the paired rows that differ, per field.

    Args:
        aligned: The aligned rows.

    Returns:
        Map of field to count, for all seven fields.

    Side Effects:
        None.
    """
    return {
        field: sum(_cell(old[field]) != _cell(new[field]) for old, new, _ in aligned.matched)
        for field in SEVEN_FIELDS
    }


def _status_matrix(aligned):
    """Count paired rows by old status and new status.

    Args:
        aligned: The aligned rows.

    Returns:
        Map of tuple of old and new status class to count.

    Side Effects:
        None.
    """
    old_seen = Counter(_cell(row["status"]) for row in aligned.old_rows)
    new_seen = Counter(_cell(row["status"]) for row in aligned.new_rows)
    return Counter(
        (
            _status_class(_cell(old["status"]), old_seen),
            _status_class(_cell(new["status"]), new_seen),
        )
        for old, new, _ in aligned.matched
    )


def _status_class(status, seen):
    """Choose what a status may print as.

    Args:
        status: The stripped status.
        seen: How often each status appears on the same side.

    Returns:
        The status if it is 3 to 20 letters and spaces and appears often enough, otherwise OTHER.

    Side Effects:
        None.
    """
    is_showable = SHOWABLE_STATUS.fullmatch(status) and seen[status] >= SHOWABLE_STATUS_MINIMUM
    return status if is_showable else OTHER_STATUS


def _feature_lines(aligned, assembly):
    """Count what the rows with any mismatch have in common.

    Args:
        aligned: The aligned rows.
        assembly: The new ``RowAssembly``.

    Returns:
        Report lines.

    Side Effects:
        None.
    """
    positions = [
        position
        for old, new, position in aligned.matched
        if any(_cell(old[field]) != _cell(new[field]) for field in SEVEN_FIELDS)
    ]
    rows = aligned.new_rows
    features = {
        "multi_line": lambda at: assembly["printed_line_counts"][at] > 1,
        "first_or_last_on_page": lambda at: _is_first_or_last_on_page(rows, at),
        "page_1": lambda at: rows[at]["page"] == 1,
        "tied_timestamp": lambda at: _has_tied_timestamp(rows, at),
    }
    return [
        f"mismatch_rows: {len(positions)}",
        *[
            f"mismatch_rows_{name}: {sum(holds(position) for position in positions)}"
            for name, holds in features.items()
        ],
    ]


def _is_first_or_last_on_page(rows, position):
    """Tell whether a row starts or ends its page.

    Args:
        rows: Rows in print order.
        position: The row's print position.

    Returns:
        True if a neighbour is on another page or missing.

    Side Effects:
        None.
    """
    page = rows[position]["page"]
    is_first = position == 0 or rows[position - 1]["page"] != page
    is_last = position == len(rows) - 1 or rows[position + 1]["page"] != page
    return is_first or is_last


def _has_tied_timestamp(rows, position):
    """Tell whether a neighbouring row completed at the same second.

    Args:
        rows: Rows in print order.
        position: The row's print position.

    Returns:
        True if either neighbour has the same completion time.

    Side Effects:
        None.
    """
    neighbours = rows[max(position - 1, 0) : position] + rows[position + 1 : position + 2]
    return any(row["completion_time"] == rows[position]["completion_time"] for row in neighbours)


def _chain_report(aligned, old_quality, new_quality):
    """Compare where each side's balance chain breaks.

    Args:
        aligned: The aligned rows.
        old_quality: ``DataQuality`` of the old rows.
        new_quality: ``DataQuality`` of the new rows.

    Returns:
        Tuple of report lines and the gate. Differences are counted, so the gate passes either way
        and says which.

    Side Effects:
        None.
    """
    old_links = _broken_links(aligned.old_rows, aligned.old_keys, old_quality["chain_orientation"])
    new_links = _broken_links(aligned.new_rows, aligned.new_keys, new_quality["chain_orientation"])
    outcome = "identical" if old_links == new_links else "counted"
    return (
        [
            f"chain_breaks_old: {len(old_links)}",
            f"chain_breaks_new: {len(new_links)}",
            f"chain_breaks_both: {len(old_links & new_links)}",
            f"chain_orientation_old: {old_quality['chain_orientation']}",
            f"chain_orientation_new: {new_quality['chain_orientation']}",
            *[
                f"chain_breaks_new_{kind}: {count}"
                for kind, count in new_quality["chain_break_counts"][
                    new_quality["chain_orientation"]
                ].items()
            ],
        ],
        (True, f"chain_breaks ({outcome})"),
    )


def _broken_links(rows, keys, orientation):
    """Name each chain break by the digests of its two rows, so both sides can be compared.

    Args:
        rows: Rows in print order.
        keys: Each row's digest.
        orientation: The orientation to read the chain in.

    Returns:
        Set of tuples of two digests.

    Side Effects:
        None.
    """
    return {(keys[link], keys[link + 1]) for link in find_chain_breaks(rows, orientation)}


def _summary_lines(side, quality):
    """Report each statement summary label's reconciliation.

    Args:
        side: ``old`` or ``new``.
        quality: That side's ``DataQuality``.

    Returns:
        Report lines.

    Side Effects:
        None.
    """
    return [
        f"summary_{side}_{label.lower().replace(' ', '_')}: {SUMMARY_WORDS[agrees]}"
        for label, agrees in quality["summary_reconciliation"].items()
    ]


def _layout_lines(assembly, new_quality):
    """Report what the row builder met, which answers open questions OQ-03 and OQ-10.

    Args:
        assembly: The new ``RowAssembly``.
        new_quality: ``DataQuality`` of the new rows.

    Returns:
        Report lines.

    Side Effects:
        None.
    """
    histogram = new_quality["receipt_length_histogram"]
    return [
        *[f"{name}: {count}" for name, count in assembly["layout_counts"].items()],
        *_other_line_lines(assembly["unattached_other_positions"]),
        f"unparsed_amounts_new: {new_quality['unparsed_amounts']}",
        *[f"receipt_length_{length}: {histogram[length]}" for length in sorted(histogram)],
    ]


def _canonical_report(old_canonical, new_canonical):
    """Compare canonical rows from the old cleaning step with this repo's.

    Text fields match after strip, with None equal to an empty string. Amounts must be exactly the
    same float, and two not-a-number values count as equal.

    Args:
        old_canonical: The old cleaning step's rows.
        new_canonical: Canonical rows built from the new rows.

    Returns:
        Tuple of report lines and the canonical gates.

    Side Effects:
        None.
    """
    aligned = _align(old_canonical, new_canonical)
    mismatches = {
        field: sum(_cell(old[field]) != _cell(new[field]) for old, new, _ in aligned.matched)
        for field in CANONICAL_TEXT_FIELDS
    }
    for field in CANONICAL_AMOUNT_FIELDS:
        mismatches[field] = sum(
            not _same_amount(old[field], new[field]) for old, new, _ in aligned.matched
        )
    lines = [
        f"canonical_rows_old: {len(old_canonical)}",
        f"canonical_rows_new: {len(new_canonical)}",
        f"canonical_matched: {len(aligned.matched)}",
        *[f"canonical_mismatch_{field}: {count}" for field, count in mismatches.items()],
    ]
    amount_mismatches = sum(mismatches[field] for field in CANONICAL_AMOUNT_FIELDS)
    gates = [
        (len(old_canonical) == len(new_canonical), "canonical_row_count_equal"),
        (not mismatches["details"], "zero_mismatch_details_normalized"),
        (not amount_mismatches, "zero_mismatch_amounts"),
        (not mismatches["status"], "zero_mismatch_status"),
    ]
    return lines, gates


def _classified_report(old_classified, new_classified):
    """Compare the old classification with this repo's, row by row and as class counts.

    Args:
        old_classified: The old classifier's rows.
        new_classified: The new rows, classified.

    Returns:
        Tuple of report lines and the classification gates. Entities are compared but never
        printed; only counts are.

    Side Effects:
        None.
    """
    aligned = _align(old_classified, new_classified)
    pairs = aligned.matched
    mismatches = {
        field: sum(_cell(_text(old[field])) != _cell(_text(new[field])) for old, new, _ in pairs)
        for field in (*CLASS_FIELDS, "entity")
    }
    over_half_cent = {}
    for field in CLASSIFIED_AMOUNT_FIELDS:
        mismatches[field] = sum(not _same_amount(old[field], new[field]) for old, new, _ in pairs)
        over_half_cent[field] = sum(
            abs(old[field] - new[field]) > HALF_CENT for old, new, _ in pairs
        )
    old_tables, new_tables = _class_tables(old_classified), _class_tables(new_classified)
    lines = [
        f"classified_rows_old: {len(old_classified)}",
        f"classified_rows_new: {len(new_classified)}",
        f"classified_matched: {len(pairs)}",
        *[f"classified_mismatch_{field}: {count}" for field, count in mismatches.items()],
        *[
            f"classified_mismatch_{field}_over_half_cent: {count}"
            for field, count in over_half_cent.items()
        ],
        *_class_table_lines("old", old_tables),
        *_class_table_lines("new", new_tables),
    ]
    gates = [
        *[
            (not mismatches[field], f"zero_mismatch_{label}")
            for field, (label, _) in CLASS_FIELDS.items()
        ],
        (not mismatches["entity"], "zero_mismatch_entity"),
        (not mismatches["total_cost"], "zero_mismatch_total_cost"),
        (old_tables == new_tables, "class_count_table_identical"),
    ]
    return lines, gates


def _text(value):
    """Give a class or entity as plain text, so an enum member compares by its value.

    Args:
        value: A class, an entity, or None.

    Returns:
        The text, or None.

    Side Effects:
        None.
    """
    return None if value is None else str(value)


def _class_tables(classified):
    """Count rows by each class field.

    Args:
        classified: Classified rows.

    Returns:
        Map of class field to a ``Counter`` of class names. A value that is not a known class
        name counts as OTHER, so nothing from a row can print.

    Side Effects:
        None.
    """
    return {
        field: Counter(
            str(row[field]) if str(row[field]) in known else OTHER_STATUS for row in classified
        )
        for field, (_, known) in CLASS_FIELDS.items()
    }


def _class_table_lines(side, tables):
    """Print class-count tables.

    Args:
        side: ``old`` or ``new``.
        tables: The tables from ``_class_tables``.

    Returns:
        Report lines, one per class seen.

    Side Effects:
        None.
    """
    return [
        f"class_count_{side}_{field} {name}: {count}"
        for field, table in tables.items()
        for name, count in sorted(table.items())
    ]


def _chain_breaks_by_event_type(new_rows, new_classified, new_quality):
    """Count the new chain breaks by the event type of the row whose balance does not follow.

    That row is the newer of the two: the upper one when the statement prints newest first.

    Args:
        new_rows: The new rows in print order.
        new_classified: The same rows, classified, in the same order.
        new_quality: ``DataQuality`` of the new rows, which names the orientation.

    Returns:
        Report lines, one per event type seen; none if the two lists do not line up.

    Side Effects:
        None.
    """
    if len(new_rows) != len(new_classified):
        return []
    orientation = new_quality["chain_orientation"]
    newer_offset = 0 if orientation == "newest_first" else 1
    counts = Counter(
        str(new_classified[link + newer_offset]["event_type"])
        for link in find_chain_breaks(new_rows, orientation)
    )
    return [f"chain_breaks_new_after_{name}: {count}" for name, count in sorted(counts.items())]


def _same_amount(old, new):
    """Compare two canonical amounts exactly.

    Args:
        old: The old amount.
        new: The new amount.

    Returns:
        True if they are the same float, or both not-a-number.

    Side Effects:
        None.
    """
    return old == new or (math.isnan(old) and math.isnan(new))


def _other_line_lines(positions):
    """Describe where the unexplained lines sit, by page and by offset from the header row.

    Args:
        positions: The assembly's ``unattached_other_positions``.

    Returns:
        Report lines: how many pages hold such lines, how many pages hold each number of them,
        and how many lines sit at each offset from the header, rounded to the nearest point.
        Positions only, never text.

    Side Effects:
        None.
    """
    per_page = Counter(position["page"] for position in positions)
    pages_by_line_count = Counter(per_page.values())
    offsets = Counter(
        "none" if position["offset_from_header"] is None else round(position["offset_from_header"])
        for position in positions
    )
    return [
        f"unattached_other_pages: {len(per_page)}",
        *[
            f"unattached_other_pages_with_{lines}_lines: {pages}"
            for lines, pages in sorted(pages_by_line_count.items())
        ],
        *[
            f"unattached_other_offset_{offset}: {count}"
            for offset, count in sorted(offsets.items(), key=lambda pair: str(pair[0]))
        ],
    ]


def _row_and_field_gates(aligned, field_mismatches):
    """Decide the gates that must hold exactly.

    A different receipt number never pairs, so it shows up as a row found on one side only.

    Args:
        aligned: The aligned rows.
        field_mismatches: Map of field to mismatch count.

    Returns:
        Gates as tuples of whether each passed and its label.

    Side Effects:
        None.
    """
    every_row_paired = len(aligned.matched) == len(aligned.old_rows) == len(aligned.new_rows)
    return [
        (len(aligned.old_rows) == len(aligned.new_rows), "row_count_equal"),
        (every_row_paired and not field_mismatches[RECEIPT_FIELD], "zero_mismatch_receipt_no"),
        *[(not field_mismatches[field], f"zero_mismatch_{field}") for field in GATED_FIELDS],
    ]


def _status_gate(aligned, mismatches, status_counts):
    """Decide the status gate: no mismatch, or every paired row counted in the matrix.

    Args:
        aligned: The aligned rows.
        mismatches: How many paired rows differ in status.
        status_counts: The status matrix.

    Returns:
        The gate, as a tuple of whether it passed and its label.

    Side Effects:
        None.
    """
    is_fully_counted = sum(status_counts.values()) == len(aligned.matched)
    outcome = "0" if not mismatches else f"counted {mismatches}"
    return (is_fully_counted, f"status_mismatches ({outcome})")


def _mismatch_positions(old_rows, assembly):
    """List where mismatches are, for the owner's own screen. Never part of ``--share``.

    Args:
        old_rows: The old rows.
        assembly: The new ``RowAssembly``.

    Returns:
        Report lines holding a field name, a page and a line.

    Side Effects:
        None.
    """
    aligned = _align(old_rows, assembly["rows"])
    return [
        f"mismatch_at: {field} page {new['page']} line {new['line']}"
        for old, new, _ in aligned.matched
        for field in SEVEN_FIELDS
        if _cell(old[field]) != _cell(new[field])
    ]


if __name__ == "__main__":
    sys.exit(main())
