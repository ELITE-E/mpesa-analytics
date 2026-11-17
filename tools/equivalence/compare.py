#!/usr/bin/env python3
"""Compare the old extractor's rows with the new row builder's, on the owner's machine.

The new rows come from the real pdf.js adapter through ``extract_pages_cli.mjs``, whose output is
deleted afterwards. Rows are aligned by an HMAC of the receipt number under a key made for this run,
so no receipt number is ever compared or held in the clear beyond the rows themselves.

Output is fixed labels, counts and PASS or FAIL, never statement text or a path. ``--share`` is safe
to paste. Without it the tool also lists each mismatch's page and line, for looking on your own
screen. If the PDF needs a password, the CLI asks with a hidden prompt.

``--labels`` instead prints page 1's summary block, from the ``SUMMARY`` line up to the
``DETAILED STATEMENT`` line, every digit replaced by ``#``, one per line and nothing else. Nothing
above the block is printed, as that is where the name, number and email are. If either marker is
missing it prints nothing and exits 2. It refuses ``--share``: read it on your own screen first.

``--browser-result DIR`` replaces ``--pdf``: it reads the statement pages and pipeline result that
``browser_run.mjs`` wrote from the browser engine, prints the same lines and gates, and adds the
gate ``browser_result_equals_cpython``: CPython's pipeline result on the browser's pages equals the
browser's. The browser result never holds the account digest, only whether one was read, so the
digest is excluded from that comparison by design. Lines starting ``browser_`` count where the two
differ: paths per top-level key (and how many of those are numbers under half a cent apart), rows
per field (and whether Unicode NFC plus whitespace normalisation makes them equal). With ``--pdf``
as well, the browser's statement pages are compared with the Node reader's for that PDF.

    python tools/equivalence/compare.py --pdf PATH --baseline FILE --share
    python tools/equivalence/compare.py --browser-result DIR --pdf PATH --baseline FILE --share
    python tools/equivalence/compare.py --pdf PATH --labels
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
import unicodedata
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

from mpesa_core import pipeline
from mpesa_core.analysis import analyze_transactions
from mpesa_core.classification.classify import classify_transactions
from mpesa_core.classification.taxonomy import CashFlowDirection, EconomicMeaning, FinancialEvent
from mpesa_core.cleaning.canonicalize import canonicalize_rows
from mpesa_core.errors import AnalysisError, CoreError, DomainRowError, ExtractionError
from mpesa_core.extraction.rows import assemble_rows
from mpesa_core.reconciliation.attest import attest
from mpesa_core.reconciliation.reconcile import (
    NEWEST_FIRST,
    SAME_RECEIPT,
    SAME_TIME,
    chain_break_residuals,
    count_breaks_resolvable_by_reorder,
    count_residuals_matching_nearby_amounts,
    find_chain_breaks,
    measure_balances,
    measure_identity_gap,
    reconcile,
    reorder_group_sizes,
    reorder_within_groups,
)
from mpesa_core.reconciliation.summary import summary_block_lines

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
# Marks a path or field present on one side only; never equal to a JSON value.
MISSING = object()
REPORT_UNREADABLE = "REPORT_UNREADABLE"
REPORT_NAME = "report.json"
MASKED_KEY = "<key>"
# Every key the report's schema uses. Any other key prints as MASKED_KEY, so no value can leak
# through a key.
REPORT_SCHEMA_KEYS = frozenset(
    {
        "cash_flow",
        "spending",
        "bills",
        "investments",
        "transfers",
        "fees",
        "total_inflow",
        "total_outflow",
        "net_cash_flow",
        "closing_balance",
        "monthly_expenditure",
        "month",
        "expenditure",
        "top_recipients",
        "recipient",
        "amount_received",
        "ranking",
        "largest_purchases",
        "transaction",
        "amount",
        "date",
        "spending_by_entity",
        "entity",
        "merchant_usage_frequency",
        "merchant",
        "transaction_count",
        "recurring_purchases",
        "occurrences",
        "dates",
        "intervals",
        "amounts",
        "recurrence_interval",
        "recurring_bills",
        "bill",
        "bill_spending",
        "period",
        "start",
        "end",
        "total_investment",
        "investment_amount",
        "by_platform",
        "platform",
        "amount_invested",
        "frequency",
        "investment_transactions",
        "monthly_investment",
        "total_transfers",
        "total_transfer_amount",
        "total_received",
        "by_recipient_count",
        "monthly_transfer_amounts",
        "transfer_amount",
        "largest_transfers",
        "total_fees",
        "mpesa_fees",
        "fee_amount",
        "transfer_charges",
        "transfer_charge_amount",
    }
)
EXTRACTION_FAILED = "EXTRACTION_FAILED"
CLI_ERROR_CODE = re.compile(r"ERROR \(([A-Z_]+)\)")
HMAC_KEY_BYTES = 32
# A status only shows if it reads like a status and is common, so a name or a stray fragment of
# details that landed in the status column stays hidden.
SHOWABLE_STATUS = re.compile(r"[A-Za-z ]{3,20}")
SHOWABLE_STATUS_MINIMUM = 20
OTHER_STATUS = "OTHER"
SUMMARY_WORDS = {True: "yes", False: "no", None: "not_found"}
BROWSER_RESULT_UNREADABLE = "BROWSER_RESULT_UNREADABLE"
BROWSER_RESULT_HOLDS_DIGEST = "BROWSER_RESULT_HOLDS_DIGEST"
BROWSER_PAGES_NAME = "pages.json"
BROWSER_RESULT_NAME = "result.json"
BROWSER_RESULT_FIELDS = {"processed_at", "pipeline_result", "account_digest_present"}
BROWSER_GATE = "browser_result_equals_cpython"
DIGEST_FIELD = "account_digest"
TOKEN_FIELD = "verification_token"
# Left out of browser_run's output on purpose (it must never be stored), so never compared.
EXCLUDED_BY_DESIGN = (DIGEST_FIELD,)
PIPELINE_RESULT_KEYS = frozenset(
    {
        "schema_version",
        "verification_token",
        "verification_instruction",
        "account_digest",
        "processed_at",
        "period",
        "balances",
        "transactions",
        "report",
        "quality",
        "diagnostics",
    }
)
ROW_FIELDS = (
    "receipt_no",
    "completion_time",
    "details",
    "status",
    "paid_in",
    "withdrawn",
    "paid_out",
    "balance",
    "event_type",
    "cash_flow_direction",
    "economic_meaning",
    "total_cost",
    "entity",
)
ITEM_POSITION_FIELDS = ("x0", "x1", "top", "bottom")
# Report lists ordered by value, with the field they are ordered by (behaviour-changes T-1, T-2).
TIE_ORDERED_LISTS = {
    ("spending", "top_recipients"): "amount_received",
    ("spending", "largest_purchases"): "amount",
}
CLOSING_BALANCE_PATH = ("cash_flow", "closing_balance")
MAGNITUDE_BUCKETS = ((1, "lt_1"), (100, "lt_100"), (10_000, "lt_10000"))


@dataclass(frozen=True)
class OldSide:
    """Everything the old code produced: extracted rows, canonical rows and classified rows."""

    rows: list
    canonical: list
    classified: list
    report: dict


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
    args = _parse_arguments()
    if args.labels:
        return _print_summary_labels(args.pdf)
    if args.skip_baseline:
        return _compare_browser_only(args)
    try:
        old = OldSide(
            _read_baseline(args.baseline),
            _read_canonical(args.baseline.parent / CANONICAL_NAME),
            _read_classified(args.baseline.parent / CLASSIFIED_NAME),
            _read_report(args.baseline.parent / REPORT_NAME),
        )
        browser_result = node_pages = None
        if args.browser_result is None:
            statement_pages = _extract_statement_pages(args.pdf)
        else:
            statement_pages, browser_result = _read_browser_result(args.browser_result)
            node_pages = None if args.pdf is None else _extract_statement_pages(args.pdf)
        assembly = assemble_rows(statement_pages)
        new_classified = classify_transactions(canonicalize_rows(assembly["rows"]))[0]
        orientation = reconcile(statement_pages, assembly["rows"])["chain_orientation"]
        # The same print-order closing balance as pipeline.run (behaviour-changes T-4).
        closing = measure_balances(assembly["rows"], orientation)["closing_balance"]
        new_report = analyze_transactions(new_classified, closing_balance=closing)
    except CompareError as error:
        print(f"compare: ERROR ({error.code})")
        return CANNOT_RUN
    except ExtractionError as error:
        print(f"compare: ERROR ({error.code.value})")
        return CANNOT_RUN
    except DomainRowError as error:
        print(f"compare: ERROR (CLASSIFICATION_STOPPED at row {error.row_index})")
        return CANNOT_RUN
    except AnalysisError as error:
        # Under the pinned pandas a date-based analysis cannot compare a missing date (A-3).
        print(f"compare: ERROR (ANALYSIS_STOPPED {error.code.value})")
        return CANNOT_RUN
    browser_section = (
        ([], [])
        if browser_result is None
        else _browser_section(statement_pages, browser_result, node_pages)
    )
    lines, gates = build_report(
        old, assembly, (new_classified, new_report), statement_pages, browser_section
    )
    lines += [] if args.share else _mismatch_positions(old.rows, assembly)
    print("\n".join(lines))
    return 0 if all(verdict for verdict, _ in gates) else FAILED


def _compare_browser_only(args):
    """Compare the browser's output with CPython's alone, without the old code's baseline.

    Args:
        args: The parsed arguments: ``--browser-result``, and ``--pdf`` to compare the pages
            with the Node reader's.

    Returns:
        Process exit code: 0 if the browser gate passes, 1 if not, 2 if it could not run.

    Side Effects:
        Reads the browser result, may run the extract CLI (which may prompt), prints counts.
    """
    try:
        statement_pages, browser_result = _read_browser_result(args.browser_result)
        node_pages = None if args.pdf is None else _extract_statement_pages(args.pdf)
    except CompareError as error:
        print(f"compare: ERROR ({error.code})")
        return CANNOT_RUN
    lines, gates = _browser_section(statement_pages, browser_result, node_pages)
    passed = all(verdict for verdict, _ in gates)
    print(
        "\n".join(
            [
                *lines,
                *[f"{'PASS' if verdict else 'FAIL'} {label}" for verdict, label in gates],
                f"RESULT: {'PASS' if passed else 'FAIL'}",
            ]
        )
    )
    return 0 if passed else FAILED


def _parse_arguments():
    """Read and check the command line.

    Returns:
        The parsed arguments: ``--pdf`` or ``--browser-result`` (or both), and ``--baseline``
        unless ``--labels`` or ``--skip-baseline`` is asked for.

    Side Effects:
        Exits with a usage message if the combination is not allowed.
    """
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--pdf", type=Path)
    parser.add_argument("--browser-result", type=Path)
    parser.add_argument("--baseline", type=Path)
    parser.add_argument("--share", action="store_true")
    parser.add_argument("--labels", action="store_true")
    parser.add_argument("--skip-baseline", action="store_true")
    args = parser.parse_args()
    if args.skip_baseline and args.browser_result is None:
        parser.error("--skip-baseline needs --browser-result")
    if args.pdf is None and args.browser_result is None:
        parser.error("--pdf or --browser-result is required")
    if args.labels and args.browser_result is not None:
        parser.error("--labels cannot be combined with --browser-result")
    if args.labels and args.share:
        parser.error("--labels cannot be combined with --share")
    if args.labels and args.pdf is None:
        parser.error("--labels needs --pdf")
    if not (args.labels or args.skip_baseline) and args.baseline is None:
        parser.error("--baseline is required")
    return args


def build_report(old, assembly, new_results, statement_pages, browser_section=((), ())):
    """Compare both sides and describe the outcome in counts.

    Args:
        old: The old code's results, as an ``OldSide``.
        assembly: The new ``RowAssembly``.
        new_results: Tuple of the new rows, cleaned and classified, in print order, and the new
            report.
        statement_pages: The statement pages the new rows came from.
        browser_section: Tuple of more lines, printed before the verdicts, and more gates, as
            tuples of whether each passed and its label, printed after the others and counted in
            the result.

    Returns:
        Tuple of the report's lines, ending in the verdicts, and the gates as tuples of whether
        each passed and its label.

    Side Effects:
        None.
    """
    new_classified, new_report = new_results
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
    report_lines, report_gate = _report_comparison(old.report, new_report, new_classified)
    gates = [
        *_row_and_field_gates(aligned, field_mismatches),
        _status_gate(aligned, field_mismatches["status"], status_counts),
        chain_gate,
        *canonical_gates,
        *classified_gates,
        report_gate,
        *browser_section[1],
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
        *_summary_lines(old_quality, new_quality),
        *_layout_lines(assembly, new_quality),
        *canonical_lines,
        *classified_lines,
        *_chain_breaks_by_event_type(aligned.new_rows, new_classified, new_quality),
        *report_lines,
        *_pipeline_lines(statement_pages),
        *_balance_lines(aligned.new_rows, new_quality, (old.report, new_report)),
        *_chain_diagnostic_lines(aligned.new_rows, new_quality),
        *_remaining_break_lines(aligned.new_rows, new_classified, new_quality),
        *browser_section[0],
        *[f"{'PASS' if verdict else 'FAIL'} {label}" for verdict, label in gates],
        f"RESULT: {'PASS' if all(verdict for verdict, _ in gates) else 'FAIL'}",
    ]
    return lines, gates


def _read_browser_result(directory):
    """Read what ``browser_run.mjs`` wrote: the browser's statement pages and pipeline result.

    Args:
        directory: The browser run's output directory.

    Returns:
        Tuple of the statement pages and the browser result: ``processed_at``,
        ``pipeline_result`` (without the account digest) and ``account_digest_present``.

    Raises:
        CompareError: ``BROWSER_RESULT_UNREADABLE`` if a file is missing or malformed;
            ``BROWSER_RESULT_HOLDS_DIGEST`` if the result holds the account digest, which must
            never be stored.

    Side Effects:
        Reads two files.
    """
    try:
        statement_pages = json.loads((directory / BROWSER_PAGES_NAME).read_text(encoding="utf-8"))
        browser_result = json.loads((directory / BROWSER_RESULT_NAME).read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise CompareError(BROWSER_RESULT_UNREADABLE) from error
    is_valid = (
        isinstance(statement_pages, dict)
        and isinstance(statement_pages.get("pages"), list)
        and isinstance(browser_result, dict)
        and set(browser_result) == BROWSER_RESULT_FIELDS
        and isinstance(browser_result["pipeline_result"], dict)
    )
    if not is_valid:
        raise CompareError(BROWSER_RESULT_UNREADABLE)
    if DIGEST_FIELD in browser_result["pipeline_result"]:
        raise CompareError(BROWSER_RESULT_HOLDS_DIGEST)
    return statement_pages, browser_result


def _browser_section(statement_pages, browser_result, node_pages):
    """Compare the browser's output with CPython's, and its pages with the Node reader's.

    Args:
        statement_pages: The browser's statement pages.
        browser_result: The browser result from ``_read_browser_result``.
        node_pages: The Node reader's statement pages for the same PDF, or None without ``--pdf``.

    Returns:
        Tuple of lines (labels, counts and yes or no only) and the one gate,
        ``browser_result_equals_cpython``, as a list of a tuple of its verdict and label. A run
        that stops on a core error fails the gate.

    Side Effects:
        Imports pandas on first use.
    """
    browser_pipeline_result = browser_result["pipeline_result"]
    browser_fields = set(browser_pipeline_result)
    lines = [
        f"browser_output_omits_account_digest: {_yes(DIGEST_FIELD not in browser_fields)}",
        f"browser_output_omits_verification_token: {_yes(TOKEN_FIELD not in browser_fields)}",
        f"browser_vs_cpython_excluded_by_design: {','.join(EXCLUDED_BY_DESIGN)}",
    ]
    try:
        cpython_result = json.loads(
            json.dumps(pipeline.run(statement_pages, processed_at=browser_result["processed_at"]))
        )
    except CoreError as error:
        code = getattr(error, "code", None)
        lines.append(
            f"browser_vs_cpython_run: FAIL ({'DOMAIN_ROW' if code is None else code.value})"
        )
        return [*lines, *_node_page_lines(statement_pages, node_pages)], [(False, BROWSER_GATE)]
    digest_present = cpython_result[DIGEST_FIELD] is not None
    lines.append(
        "browser_vs_cpython_account_digest_present_agrees: "
        f"{_yes(digest_present == browser_result['account_digest_present'])}"
    )
    path_counts = _differing_path_counts(browser_pipeline_result, cpython_result)
    lines += [
        line
        for key, (differing, below_half_cent) in sorted(path_counts.items())
        for line in (
            f"browser_vs_cpython_paths_differing {key}: {differing}",
            f"browser_vs_cpython_paths_below_half_cent {key}: {below_half_cent}",
        )
    ]
    lines += _report_path_lines(browser_pipeline_result.get("report"), cpython_result["report"])
    lines += _row_field_lines(
        browser_pipeline_result.get("transactions", []), cpython_result["transactions"]
    )
    lines += _node_page_lines(statement_pages, node_pages)
    agrees = all(differing == 0 for differing, _ in path_counts.values())
    return lines, [(agrees, BROWSER_GATE)]


def _report_path_lines(browser_report, cpython_report):
    """Describe each differing report path without its value.

    Args:
        browser_report: The browser's report.
        cpython_report: CPython's report.

    Returns:
        One line per differing leaf: the path with keys from the data as ``<key>`` and list
        positions kept, the leaf's type (number, string, null), whether its list holds the same
        values on both sides in another order, and for a number its size bucket.

    Side Effects:
        None.
    """
    lines = []
    for path in _differing_raw_paths(browser_report, cpython_report):
        cpython_value = _value_at(cpython_report, path)
        value = _value_at(browser_report, path) if cpython_value is MISSING else cpython_value
        parent = _parent_list_path(path)
        reordered = parent is not None and _is_reordered(
            _value_at(browser_report, parent), _value_at(cpython_report, parent)
        )
        line = (
            f"browser_vs_cpython_report_path: {_masked_path(path)} type={_leaf_type(value)} "
            f"parent_list_reordered={_yes(reordered)}"
        )
        if _leaf_type(value) == "number":
            line += f" magnitude={_magnitude(value)}"
        lines.append(line)
    return lines


def _is_reordered(first_list, second_list):
    """Tell whether two lists hold the same values in a different order.

    Args:
        first_list: A JSON value.
        second_list: Another JSON value.

    Returns:
        True if both are lists, differ in order, and hold the same multiset of values.

    Side Effects:
        None.
    """
    if not (isinstance(first_list, list) and isinstance(second_list, list)):
        return False

    def canonical(values):
        """Sort a list's values by their canonical JSON, so equal multisets compare equal.

        Args:
            values: The list.

        Returns:
            The values' canonical JSON texts, sorted.

        Side Effects:
            None.
        """
        return sorted(json.dumps(value, sort_keys=True) for value in values)

    return first_list != second_list and canonical(first_list) == canonical(second_list)


def _leaf_type(value):
    """Name a JSON leaf's type.

    Args:
        value: The leaf.

    Returns:
        ``number``, ``string``, ``null``, or ``other`` (a boolean).

    Side Effects:
        None.
    """
    if value is None:
        return "null"
    if isinstance(value, str):
        return "string"
    if isinstance(value, int | float) and not isinstance(value, bool):
        return "number"
    return "other"


def _magnitude(number):
    """Put a number's size in a bucket, so its value is never printed.

    Args:
        number: The number.

    Returns:
        ``lt_1``, ``lt_100``, ``lt_10000`` or ``gte`` for its absolute value.

    Side Effects:
        None.
    """
    for limit, name in MAGNITUDE_BUCKETS:
        if abs(number) < limit:
            return name
    return "gte"


def _differing_path_counts(browser_pipeline_result, cpython_result):
    """Count differing leaf paths under each top-level key, leaving out what is excluded by design.

    Args:
        browser_pipeline_result: The browser's pipeline result, without the digest.
        cpython_result: CPython's pipeline result through JSON.

    Returns:
        Map of top-level key (outside the schema written as ``<key>``) to a tuple of the number of
        leaf paths whose values differ or exist on one side only, and how many of those are two
        numbers less than half a cent apart.

    Side Effects:
        None.
    """
    keys = (set(browser_pipeline_result) | set(cpython_result)) - set(EXCLUDED_BY_DESIGN)
    counts = {}
    for key in keys:
        name = key if key in PIPELINE_RESULT_KEYS else MASKED_KEY
        browser_leaves = dict(_leaf_paths(browser_pipeline_result.get(key)))
        cpython_leaves = dict(_leaf_paths(cpython_result.get(key)))
        differing = below_half_cent = 0
        for path in set(browser_leaves) | set(cpython_leaves):
            browser_value = browser_leaves.get(path, MISSING)
            cpython_value = cpython_leaves.get(path, MISSING)
            # MISSING equals nothing, so a path on one side only always counts.
            if browser_value == cpython_value:
                continue
            differing += 1
            below_half_cent += _is_below_half_cent(browser_value, cpython_value)
        previous = counts.get(name, (0, 0))
        counts[name] = (previous[0] + differing, previous[1] + below_half_cent)
    return counts


def _leaf_paths(value, path=""):
    """List every leaf of a JSON value with its path. Paths are compared, never printed.

    Args:
        value: A JSON value.
        path: The path so far.

    Returns:
        Tuples of path and value for every value that is not a map or a list.

    Side Effects:
        None.
    """
    if isinstance(value, dict):
        return [
            leaf for key, inner in value.items() for leaf in _leaf_paths(inner, f"{path}.{key}")
        ]
    if isinstance(value, list):
        return [
            leaf
            for position, inner in enumerate(value)
            for leaf in _leaf_paths(inner, f"{path}[{position}]")
        ]
    return [(path, value)]


def _row_field_lines(browser_rows, cpython_rows):
    """Count, per field, the rows whose value differs, and whether normalising text clears it.

    Args:
        browser_rows: The browser's transactions.
        cpython_rows: CPython's transactions.

    Returns:
        Lines: whether the row counts are equal, then for each field the differing rows (rows
        compared by position), and for a field with differences whether every one disappears
        after Unicode NFC and whitespace normalisation. Fields outside the schema are counted
        as ``<key>``.

    Side Effects:
        None.
    """
    lines = [f"browser_vs_cpython_row_count_equal: {_yes(len(browser_rows) == len(cpython_rows))}"]
    differing = dict.fromkeys(ROW_FIELDS, 0)
    cleared = dict.fromkeys(ROW_FIELDS, True)
    for browser_row, cpython_row in zip(browser_rows, cpython_rows, strict=False):
        for field in set(browser_row) | set(cpython_row):
            browser_value = browser_row.get(field, MISSING)
            cpython_value = cpython_row.get(field, MISSING)
            if browser_value == cpython_value:
                continue
            name = field if field in ROW_FIELDS else MASKED_KEY
            differing[name] = differing.get(name, 0) + 1
            same = _normalised(browser_value) == _normalised(cpython_value)
            cleared[name] = cleared.get(name, True) and same
    for field, count in differing.items():
        lines.append(f"browser_vs_cpython_rows_differing {field}: {count}")
        if count:
            lines.append(
                f"browser_vs_cpython_rows_equal_after_normalisation {field}: {_yes(cleared[field])}"
            )
    return lines


def _node_page_lines(browser_pages, node_pages):
    """Compare the browser's statement pages with the Node reader's, item by item.

    Args:
        browser_pages: The browser's statement pages.
        node_pages: The Node reader's statement pages for the same PDF, or None.

    Returns:
        Lines of page and item counts on each side, items that differ (text or position, by
        position in the page), and items that still differ once text is normalised. Without
        Node pages, one line saying they were not compared.

    Side Effects:
        None.
    """
    if node_pages is None:
        return ["browser_vs_node_pages_compared: no"]
    differing = differing_normalised = 0
    browser_list, node_list = browser_pages["pages"], node_pages["pages"]
    for page_index in range(max(len(browser_list), len(node_list))):
        browser_items = browser_list[page_index]["items"] if page_index < len(browser_list) else []
        node_items = node_list[page_index]["items"] if page_index < len(node_list) else []
        for item_index in range(max(len(browser_items), len(node_items))):
            browser_item = browser_items[item_index] if item_index < len(browser_items) else None
            node_item = node_items[item_index] if item_index < len(node_items) else None
            differing += browser_item != node_item
            differing_normalised += not _items_equal_after_normalisation(browser_item, node_item)
    return [
        "browser_vs_node_pages_compared: yes",
        f"browser_vs_node_pages_browser: {len(browser_list)}",
        f"browser_vs_node_pages_node: {len(node_list)}",
        f"browser_vs_node_items_browser: {sum(len(page['items']) for page in browser_list)}",
        f"browser_vs_node_items_node: {sum(len(page['items']) for page in node_list)}",
        f"browser_vs_node_items_differing: {differing}",
        f"browser_vs_node_items_differing_after_normalisation: {differing_normalised}",
    ]


def _items_equal_after_normalisation(browser_item, node_item):
    """Tell whether two text items match once their text is normalised; positions must match.

    Args:
        browser_item: A text item, or None if that side has no item here.
        node_item: A text item, or None.

    Returns:
        True if both exist, their positions are equal and their normalised text is equal.

    Side Effects:
        None.
    """
    if browser_item is None or node_item is None:
        return False
    same_position = all(
        browser_item.get(field) == node_item.get(field) for field in ITEM_POSITION_FIELDS
    )
    return same_position and _normalised(browser_item.get("text")) == _normalised(
        node_item.get("text")
    )


def _normalised(value):
    """Normalise text for comparison: Unicode NFC, runs of whitespace as one space, trimmed.

    Args:
        value: Any JSON value.

    Returns:
        The normalised text for a string; any other value unchanged.

    Side Effects:
        None.
    """
    if not isinstance(value, str):
        return value
    return " ".join(unicodedata.normalize("NFC", value).split())


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


def _read_report(report_path):
    """Read the old report that ``export_baseline.py`` wrote beside the baseline.

    Args:
        report_path: Path of ``report.json``.

    Returns:
        The report as plain JSON values.

    Raises:
        CompareError: ``REPORT_UNREADABLE`` if the file is missing or is not a map.

    Side Effects:
        Reads the file.
    """
    try:
        report = json.loads(report_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise CompareError(REPORT_UNREADABLE) from error
    if not isinstance(report, dict):
        raise CompareError(REPORT_UNREADABLE)
    return report


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


def _summary_lines(old_quality, new_quality):
    """Report whether the summary block's TOTAL agrees with each side's rows, and its type rows.

    Args:
        old_quality: ``DataQuality`` of the old rows.
        new_quality: ``DataQuality`` of the new rows.

    Returns:
        Report lines: yes, no or not_found per total and side, then how many of the seven type
        rows were read, which depends on the page only.

    Side Effects:
        None.
    """
    lines = [
        f"{field}_{side}: {SUMMARY_WORDS[quality[field]]}"
        for field in ("summary_total_paid_in_matches", "summary_total_paid_out_matches")
        for side, quality in (("old", old_quality), ("new", new_quality))
    ]
    return [*lines, f"summary_type_rows_parsed: {new_quality['summary_type_rows_parsed']}"]


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
        *_line_position_lines("page_heading", assembly["unattached_page_heading_positions"]),
        *_line_position_lines("other", assembly["unattached_other_positions"]),
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


def _report_comparison(old_report, new_report, new_rows):
    """Compare two reports value by value, by JSON path. Paths print; values never do.

    A difference proven to be tie order only does not fail the gate: in a list ordered by value
    (``TIE_ORDERED_LISTS``) whose sort values are the same on both sides, position by position;
    or a closing balance that is another row's balance at a latest time several rows share. The
    old code left tie order undefined (behaviour-changes T-1 to T-3).

    Args:
        old_report: The old analytics' report.
        new_report: This repo's report.
        new_rows: This repo's classified rows, which show whether the latest time is tied.

    Returns:
        Tuple of report lines and the gate. A path present on one side only counts as different.
        Every differing path is listed, with its list positions, and any key outside the schema
        shows as ``<key>``; tie-order-only paths are counted per path class (positions as ``[]``).

    Side Effects:
        None.
    """
    old_values, new_values = dict(_report_leaves(old_report)), dict(_report_leaves(new_report))
    paths = old_values.keys() | new_values.keys()
    missing = object()
    different = sorted(
        path for path in paths if old_values.get(path, missing) != new_values.get(path, missing)
    )
    below_half_cent = sum(
        _is_below_half_cent(old_values.get(path), new_values.get(path)) for path in different
    )
    raw_different = _differing_raw_paths(old_report, new_report)
    tie_order_only = [
        path for path in raw_different if _is_tie_order_only(path, old_report, new_report, new_rows)
    ]
    classes = Counter(_masked_path(path, keep_positions=False) for path in tie_order_only)
    lines = [
        f"report_paths_total: {len(paths)}",
        f"report_paths_equal: {len(paths) - len(different)}",
        f"report_paths_different: {len(different)}",
        f"report_paths_different_below_half_cent: {below_half_cent}",
        f"report_paths_tie_order_only: {len(tie_order_only)}",
        *[f"report_tie_order_only {name}: {count}" for name, count in sorted(classes.items())],
        *[f"report_path_different: {path}" for path in different],
    ]
    return lines, (len(tie_order_only) == len(raw_different), "report_paths_equal")


def _differing_raw_paths(first, second):
    """List the leaf paths, as tuples of keys and positions, whose values differ.

    Args:
        first: A JSON value.
        second: Another JSON value.

    Returns:
        Paths present on one side only, or holding different values, sorted by their masked form.

    Side Effects:
        None.
    """
    first_leaves, second_leaves = dict(_raw_leaves(first)), dict(_raw_leaves(second))
    differing = [
        path
        for path in first_leaves.keys() | second_leaves.keys()
        if first_leaves.get(path, MISSING) != second_leaves.get(path, MISSING)
    ]
    return sorted(differing, key=lambda path: (_masked_path(path), repr(path)))


def _raw_leaves(value, path=()):
    """List every leaf of a JSON value with its path as a tuple. Paths are never printed raw.

    Args:
        value: A JSON value.
        path: The path so far.

    Returns:
        Tuples of path and value for every value that is not a map or a list.

    Side Effects:
        None.
    """
    if isinstance(value, dict):
        return [leaf for key, inner in value.items() for leaf in _raw_leaves(inner, (*path, key))]
    if isinstance(value, list):
        return [
            leaf
            for position, inner in enumerate(value)
            for leaf in _raw_leaves(inner, (*path, position))
        ]
    return [(path, value)]


def _masked_path(path, *, keep_positions=True):
    """Write a path with every key from the data as ``<key>``.

    Args:
        path: The path, as a tuple of keys and list positions.
        keep_positions: Whether to keep list positions, or write them as ``[]``.

    Returns:
        The path as text: schema keys joined by dots, positions in brackets.

    Side Effects:
        None.
    """
    text = ""
    for step in path:
        if isinstance(step, int):
            text += f"[{step}]" if keep_positions else "[]"
        else:
            name = step if step in REPORT_SCHEMA_KEYS else MASKED_KEY
            text += f".{name}" if text else name
    return text


def _value_at(root, path):
    """Follow a path into a JSON value.

    Args:
        root: The JSON value.
        path: Keys and list positions.

    Returns:
        The value there, or ``MISSING`` if the path does not exist.

    Side Effects:
        None.
    """
    value = root
    for step in path:
        within_list = isinstance(value, list) and isinstance(step, int) and step < len(value)
        within_map = isinstance(value, dict) and step in value
        if not (within_list or within_map):
            return MISSING
        value = value[step]
    return value


def _parent_list_path(path):
    """Find the path of the nearest list holding a leaf.

    Args:
        path: The leaf's path.

    Returns:
        The path up to the last list position, or None if no list holds the leaf.

    Side Effects:
        None.
    """
    positions = [index for index, step in enumerate(path) if isinstance(step, int)]
    return path[: positions[-1]] if positions else None


def _is_tie_order_only(path, old_report, new_report, new_rows):
    """Tell whether a differing report path is proven to differ by tie order only.

    Args:
        path: The differing leaf's path.
        old_report: The old report.
        new_report: The new report.
        new_rows: The new classified rows.

    Returns:
        True for a leaf in a list ordered by value whose sort values match position by position,
        or for a closing balance that is another row's balance at a shared latest time.

    Side Effects:
        None.
    """
    if path == CLOSING_BALANCE_PATH:
        return _is_tied_closing_balance(
            _value_at(old_report, path), _value_at(new_report, path), new_rows
        )
    parent = _parent_list_path(path)
    if parent not in TIE_ORDERED_LISTS:
        return False
    old_list, new_list = _value_at(old_report, parent), _value_at(new_report, parent)
    if not (isinstance(old_list, list) and isinstance(new_list, list)):
        return False
    sort_key = TIE_ORDERED_LISTS[parent]
    return len(old_list) == len(new_list) and [entry.get(sort_key) for entry in old_list] == [
        entry.get(sort_key) for entry in new_list
    ]


def _is_tied_closing_balance(old_balance, new_balance, new_rows):
    """Tell whether two closing balances both belong to rows at a latest time several rows share.

    Args:
        old_balance: The old report's closing balance.
        new_balance: The new report's closing balance.
        new_rows: The new classified rows.

    Returns:
        True if the latest completion time is shared by two or more rows and both balances are
        balances of those rows.

    Side Effects:
        None.
    """
    times = [row["completion_time"] for row in new_rows if isinstance(row["completion_time"], str)]
    if not times:
        return False
    latest = max(times)
    tied = [row["balance"] for row in new_rows if row["completion_time"] == latest]
    return len(tied) >= 2 and old_balance in tied and new_balance in tied


def _print_summary_labels(pdf_path):
    """Print page 1's summary block with every digit masked, and nothing else.

    Args:
        pdf_path: The statement PDF.

    Returns:
        Process exit code: 0, or 2 if the statement could not be read or either marker of the
        block is missing, in which case nothing is printed.

    Side Effects:
        Runs the extract CLI (which may prompt), and prints to stdout only.
    """
    try:
        statement_pages = _extract_statement_pages(pdf_path)
    except CompareError as error:
        print(f"compare: ERROR ({error.code})")
        return CANNOT_RUN
    texts = summary_block_lines(statement_pages)
    if texts is None:
        return CANNOT_RUN
    for text in texts:
        print(re.sub(r"\d", "#", text))
    return 0


def _chain_diagnostic_lines(new_rows, new_quality):
    """Describe the balance identity and the chain breaks in counts and yes or no only.

    Args:
        new_rows: The new rows in print order.
        new_quality: Their ``DataQuality``, for the print orientation.

    Returns:
        Lines for whether the identity gap is zero to half a cent and its size bucket; the
        breaks' residuals: how many, how many pair with a neighbouring break of opposite sign and
        how many do not; the breaks before and after reordering groups; how many breaks each
        group rule resolves; and a histogram of group sizes.

    Side Effects:
        None.
    """
    orientation = new_quality["chain_orientation"]
    gap = measure_identity_gap(new_rows, orientation)
    residuals = [residual for _, residual in chain_break_residuals(new_rows, orientation)]
    paired, unpaired = _pair_residuals(residuals)
    reorder = count_breaks_resolvable_by_reorder(new_rows, orientation)
    by_rule = {
        name: count_breaks_resolvable_by_reorder(new_rows, orientation, rule)["resolved"]
        for name, rule in (("receipt", SAME_RECEIPT), ("time", SAME_TIME))
    }
    sizes = reorder_group_sizes(new_rows)
    return [
        f"identity_gap_zero_within_half_cent: {_yes(gap is not None and abs(gap) <= HALF_CENT)}",
        f"identity_gap_bucket: {_gap_bucket(gap)}",
        f"break_residuals_total: {len(residuals)}",
        f"break_residuals_paired_adjacent: {paired}",
        f"break_residuals_unpaired: {unpaired}",
        f"chain_breaks_raw: {new_quality['chain_breaks_raw']}",
        f"chain_breaks_after_reorder: {new_quality['chain_breaks_after_reorder']}",
        f"chain_breaks_resolved_by_group_reorder: {reorder['resolved']}",
        *[f"chain_breaks_resolved_by_{name}_groups: {count}" for name, count in by_rule.items()],
        *[f"reorder_group_size_{size}: {sizes[size]}" for size in sorted(sizes)],
        f"reorder_groups_too_large: {reorder['groups_too_large']}",
    ]


def _remaining_break_lines(new_rows, new_classified, new_quality):
    """Describe the breaks left once every group is in its best order. Counts only.

    Args:
        new_rows: The new rows in print order.
        new_classified: The same rows, classified, in the same order.
        new_quality: ``DataQuality`` of the new rows, which names the orientation.

    Returns:
        Lines counting the remaining breaks by the event type of the newer row of the break (the
        one whose balance does not follow), those on a page boundary, and those whose residual
        equals a paid in or withdrawn amount within ``NEARBY_ROWS`` rows; no event type lines if
        the two lists do not line up.

    Side Effects:
        None.
    """
    orientation = new_quality["chain_orientation"]
    reordered = reorder_within_groups(new_rows, orientation)["rows"]
    breaks = find_chain_breaks(reordered, orientation)
    newer_offset = 0 if orientation == NEWEST_FIRST else 1
    lines = []
    if len(new_rows) == len(new_classified):
        position_of = {id(row): position for position, row in enumerate(new_rows)}
        event_types = Counter(
            str(new_classified[position_of[id(reordered[link + newer_offset])]]["event_type"])
            for link in breaks
        )
        lines += [
            f"remaining_breaks_after_{name}: {count}" for name, count in sorted(event_types.items())
        ]
    on_boundary = sum(reordered[link]["page"] != reordered[link + 1]["page"] for link in breaks)
    matching = count_residuals_matching_nearby_amounts(reordered, orientation)
    return [
        *lines,
        f"remaining_breaks_on_page_boundary: {on_boundary}",
        f"remaining_break_residuals_matching_nearby_amount: {matching}",
    ]


def _gap_bucket(gap):
    """Name the size band of the identity gap, without its sign.

    Args:
        gap: The gap, or None if a balance is unknown.

    Returns:
        ``lt_1``, ``lt_100``, ``lt_10000`` or ``gte_10000``; ``not_found`` without a gap.

    Side Effects:
        None.
    """
    if gap is None:
        return "not_found"
    for limit, name in ((1, "lt_1"), (100, "lt_100"), (10_000, "lt_10000")):
        if abs(gap) < limit:
            return name
    return "gte_10000"


def _pair_residuals(residuals):
    """Count the breaks that cancel a neighbour: a residual followed by its opposite.

    Breaks are taken in print order; a break pairs with the next break if their residuals sum
    to zero within half a cent, and a paired break is not used again.

    Args:
        residuals: The breaks' residuals, in print order.

    Returns:
        Tuple of the number of breaks in pairs and the number left unpaired.

    Side Effects:
        None.
    """
    unpaired = 0
    position = 0
    while position < len(residuals):
        has_next = position + 1 < len(residuals)
        if has_next and abs(residuals[position] + residuals[position + 1]) <= HALF_CENT:
            position += 2
            continue
        unpaired += 1
        position += 1
    return len(residuals) - unpaired, unpaired


def _pipeline_lines(statement_pages):
    """Say whether attestation and the whole pipeline run succeed. Codes only, never a token.

    Args:
        statement_pages: The statement pages the new rows came from.

    Returns:
        Lines for ``attestation`` and ``pipeline_run``: ``PASS``, or ``FAIL`` with the error's code.
        Informational, not gates.

    Side Effects:
        None.
    """
    return [
        f"attestation: {_outcome(attest, statement_pages)}",
        f"pipeline_run: {_outcome(pipeline.run, statement_pages)}",
    ]


def _outcome(stage, statement_pages):
    """Run one stage and describe how it ended.

    Args:
        stage: A function of the statement pages.
        statement_pages: The statement pages.

    Returns:
        ``PASS``, or ``FAIL`` and the code of the core error it raised; a row error has no code,
        so it shows as ``DOMAIN_ROW``.

    Side Effects:
        None.
    """
    try:
        stage(statement_pages)
    except CoreError as error:
        code = getattr(error, "code", None)
        return f"FAIL ({'DOMAIN_ROW' if code is None else code.value})"
    return "PASS"


def _balance_lines(new_rows, new_quality, reports):
    """Describe the new balances (D-06) as yes or no, never as amounts.

    Args:
        new_rows: The new rows in print order.
        new_quality: Their ``DataQuality``, for the print orientation.
        reports: Tuple of the old and the new report, for their closing balance.

    Returns:
        Lines for the orientation, whether each balance was found, whether the closing balance
        equals each report's, and whether opening plus paid in minus withdrawn gives closing to
        half a cent. Informational, not gates.

    Side Effects:
        None.
    """
    orientation = new_quality["chain_orientation"]
    balances = measure_balances(new_rows, orientation)
    opening, closing = balances["opening_balance"], balances["closing_balance"]
    canonical = canonicalize_rows(new_rows)
    moved = sum(row["paid_in"] for row in canonical) - sum(
        abs(row["withdrawn"]) for row in canonical
    )
    holds = None not in (opening, closing) and abs(opening + moved - closing) <= HALF_CENT
    old_closing, new_closing = (
        report.get("cash_flow", {}).get("closing_balance") for report in reports
    )
    return [
        f"balances_orientation: {orientation}",
        f"balances_opening_found: {_yes(opening is not None)}",
        f"balances_closing_found: {_yes(closing is not None)}",
        f"balances_closing_equals_old_report: {_yes(_close(old_closing, closing))}",
        f"balances_closing_equals_new_report: {_yes(_close(new_closing, closing))}",
        f"balances_identity_holds: {_yes(holds)}",
    ]


def _close(report_closing, closing):
    """Compare a report's closing balance with the new one, to half a cent.

    Args:
        report_closing: The report's figure, or None if it has none.
        closing: The new closing balance, or None.

    Returns:
        True if both are numbers within half a cent.

    Side Effects:
        None.
    """
    numbers = all(isinstance(value, int | float) for value in (report_closing, closing))
    return numbers and abs(report_closing - closing) <= HALF_CENT


def _yes(answer):
    """Spell a truth value for the output.

    Args:
        answer: A truth value.

    Returns:
        ``yes`` or ``no``.

    Side Effects:
        None.
    """
    return "yes" if answer else "no"


def _report_leaves(value, path=""):
    """List every value in a report with its path.

    Args:
        value: A JSON value.
        path: The path so far.

    Returns:
        Tuples of path and value, for every value that is not a map or a list. Keys outside the
        schema are written as ``<key>``, so their text never reaches a path. Two such keys at one
        place share a path, so a change in either still shows as a difference there.

    Side Effects:
        None.
    """
    if isinstance(value, dict):
        leaves = []
        for key, inner in value.items():
            name = key if key in REPORT_SCHEMA_KEYS else MASKED_KEY
            leaves += _report_leaves(inner, f"{path}.{name}" if path else name)
        return leaves
    if isinstance(value, list):
        leaves = []
        for position, inner in enumerate(value):
            leaves += _report_leaves(inner, f"{path}[{position}]")
        return leaves
    return [(path, value)]


def _is_below_half_cent(old, new):
    """Tell whether two report values are numbers less than half a cent apart.

    Args:
        old: The old value.
        new: The new value.

    Returns:
        True only for two numbers, neither a boolean, whose difference is under half a cent.

    Side Effects:
        None.
    """
    numbers = [
        value
        for value in (old, new)
        if isinstance(value, int | float) and not isinstance(value, bool)
    ]
    return len(numbers) == 2 and abs(old - new) < HALF_CENT


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


def _line_position_lines(kind, positions):
    """Describe where lines of one kind sit, by page and by offset from the header row.

    Args:
        kind: ``page_heading`` or ``other``, used in the labels.
        positions: The assembly's positions for that kind.

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
        f"unattached_{kind}_pages: {len(per_page)}",
        *[
            f"unattached_{kind}_pages_with_{lines}_lines: {pages}"
            for lines, pages in sorted(pages_by_line_count.items())
        ],
        *[
            f"unattached_{kind}_offset_{offset}: {count}"
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
