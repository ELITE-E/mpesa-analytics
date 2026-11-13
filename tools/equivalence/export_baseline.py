#!/usr/bin/env python3
"""Export what the old code reads from a statement, for the equivalence check.

Runs the old pipeline's steps as it ran them: decrypt in memory, extract, clean, classify, find
entities, then analyze. It writes the extractor's rows (``baseline.json``), the cleaning step's
rows (``canonical.json``), the classified rows (``classified.json``) and the old report
(``report.json``).

Run by the owner with the OLD repo's Python, so it uses only the standard library and syntax that
older versions accept. Both files hold statement values, so they are owner-only and refused inside
either repo. Output is counts, or function names and signatures when an old step cannot be called.

    OLD_PYTHON export_baseline.py --old-repo PATH --pdf PATH --out DIR
"""

import argparse
import ast
import contextlib
import getpass
import importlib
import inspect
import io
import json
import logging
import os
import re
import subprocess
import sys
import warnings
from pathlib import Path

OLD_DECRYPT_MODULE = "src.security"
OLD_DECRYPT_FUNCTION = "decrypt_pdf_in_memory"
OLD_MODULE = "src.extract"
OLD_FUNCTION = "extract_table_from_pdf"
OLD_CLEAN_MODULE = "src.clean"
OLD_CLEAN_FUNCTION = "clean_mpesa_dataframe"
OLD_ENGINE_MODULE = "src.engine"
OLD_ENGINE_FUNCTION = "process_engine"
OLD_ENTITY_MODULE = "src.entity"
OLD_ENTITY_FUNCTION = "enrich_transactions_with_entities"
OLD_ANALYTICS_MODULE = "src.analytics"
OLD_ANALYTICS_FUNCTION = "orchestrate_analytics"
# Each old step's module and function, in the order the old pipeline runs them.
OLD_STEPS = {
    "decrypt": (OLD_DECRYPT_MODULE, OLD_DECRYPT_FUNCTION),
    "extract": (OLD_MODULE, OLD_FUNCTION),
    "clean": (OLD_CLEAN_MODULE, OLD_CLEAN_FUNCTION),
    "classify": (OLD_ENGINE_MODULE, OLD_ENGINE_FUNCTION),
    "entities": (OLD_ENTITY_MODULE, OLD_ENTITY_FUNCTION),
    "analyze": (OLD_ANALYTICS_MODULE, OLD_ANALYTICS_FUNCTION),
}
THIS_REPO = Path(__file__).resolve().parents[2]
BASELINE_NAME = "baseline.json"
CANONICAL_NAME = "canonical.json"
CANONICAL_TEXT_FIELDS = ("receipt_no", "completion_time", "details", "transaction_status")
CANONICAL_AMOUNT_FIELDS = ("paid_in", "withdrawn", "balance")
CLASSIFIED_NAME = "classified.json"
CLASSIFIED_TEXT_FIELDS = (
    "receipt_no",
    "event_type",
    "cash_flow_direction",
    "economic_meaning",
    "entity",
)
CLASSIFIED_AMOUNT_FIELDS = ("total_cost", "paid_out")
REPORT_NAME = "report.json"
CANNOT_RUN = 2
OWNER_ONLY = 0o600
OWNER_ONLY_DIRECTORY = 0o700
PASSWORD_PROMPT = "PDF password: "
MISSING_VALUE_TEXTS = {"nan", "NaN", "NaT", "<NA>", "None"}
# Normalized old column names for each of the seven printed fields.
FIELD_COLUMNS = {
    "receipt_no": ("receipt_no", "receipt"),
    "completion_time": ("completion_time",),
    "details": ("details",),
    "status": ("status", "transaction_status"),
    "paid_in": ("paid_in",),
    "withdrawn": ("withdrawn",),
    "balance": ("balance",),
}


class OldExtractorError(Exception):
    """An old step could not be used. Holds the step's name only: its messages can quote a PDF."""

    def __init__(self, step):
        """Record which step failed.

        Args:
            step: A key of ``OLD_STEPS``.

        Side Effects:
            None.
        """
        super().__init__(step)
        self.step = step


def main():
    """Export the baseline named on the command line.

    Returns:
        Process exit code: 0 on success, 2 if the baseline could not be written.

    Side Effects:
        Reads the PDF through the old code, prompts for a password, changes directory to the output
        directory, writes the baseline and prints counts.
    """
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--old-repo", type=Path, required=True)
    parser.add_argument("--pdf", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    old_repo = args.old_repo.resolve()
    pdf_path = args.pdf.resolve()
    out = args.out.resolve()
    if not pdf_path.is_file():
        print("export_baseline: ERROR (PDF not found)")
        return CANNOT_RUN
    if _is_inside_a_repo(out, old_repo):
        print("export_baseline: ERROR (--out must be outside both repos)")
        return CANNOT_RUN
    password = _ask_for_password()
    out.mkdir(parents=True, exist_ok=True, mode=OWNER_ONLY_DIRECTORY)
    # The old code may write logs beside it. They hold raw values, so they must not land in a repo.
    os.chdir(out)
    try:
        rows, canonical_rows, classified_rows, report = _read_rows_with_old_code(
            old_repo, pdf_path, password
        )
    except OldExtractorError as error:
        print(f"export_baseline: ERROR (old {error.step} step could not be used)")
        _print_available_functions(old_repo, error.step)
        return CANNOT_RUN
    if not rows:
        print("rows: 0")
        return CANNOT_RUN
    _write_owner_only(out / BASELINE_NAME, json.dumps({"rows": rows}, indent=1))
    _write_owner_only(out / CANONICAL_NAME, json.dumps({"rows": canonical_rows}, indent=1))
    _write_owner_only(out / CLASSIFIED_NAME, json.dumps({"rows": classified_rows}, indent=1))
    _write_owner_only(out / REPORT_NAME, json.dumps(report, indent=1))
    _print_counts(rows, canonical_rows, classified_rows)
    print(f"report_values: {_count_values(report)}")
    return 0


def _is_inside_a_repo(out, old_repo):
    """Tell whether a resolved path lies inside this repo or the old one.

    Args:
        out: The resolved output path.
        old_repo: The resolved old repo path.

    Returns:
        True if the output is inside either repo's git toplevel.

    Side Effects:
        Runs git.
    """
    repos = {old_repo, THIS_REPO, _git_toplevel(old_repo), _git_toplevel(THIS_REPO)}
    return any(repo == out or repo in out.parents for repo in repos)


def _git_toplevel(path):
    """Find a path's git toplevel.

    Args:
        path: A directory.

    Returns:
        The resolved toplevel, or the path itself if it is not in a git repo.

    Side Effects:
        Runs git.
    """
    try:
        completed = subprocess.run(
            ["git", "-C", str(path), "rev-parse", "--show-toplevel"],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            universal_newlines=True,
            check=False,
        )
    except OSError:
        return path
    toplevel = completed.stdout.strip()
    return Path(toplevel).resolve() if completed.returncode == 0 and toplevel else path


def _ask_for_password():
    """Ask for the PDF's password, hidden when typed at a terminal.

    ``getpass`` reads from the terminal even when stdin is piped, so piped input is read directly.

    Returns:
        The password, or None if nothing was entered.

    Side Effects:
        Writes a prompt to the terminal or stderr, never stdout, and reads the password.
    """
    if sys.stdin.isatty():
        return getpass.getpass(PASSWORD_PROMPT) or None
    sys.stderr.write(PASSWORD_PROMPT)
    sys.stderr.flush()
    return sys.stdin.readline().rstrip("\r\n") or None


def _read_rows_with_old_code(old_repo, pdf_path, password):
    """Run every old step, from decrypt to analyze, with all they print or log silenced.

    As in the old pipeline, the PDF is decrypted in memory and the extractor reads that stream.

    Args:
        old_repo: The resolved old repo path.
        pdf_path: The resolved PDF path.
        password: The PDF's password, or None.

    Returns:
        Tuple of the extractor's rows, each with the seven raw fields; the cleaning step's rows,
        each with its seven canonical fields; the classified rows, each with its receipt number
        and classification; and the old report as plain JSON values. Rows are in print order.

    Raises:
        OldExtractorError: Naming the step that could not be imported or called, or that returned
            something without the expected fields. The original error is dropped: it can quote
            the PDF.

    Side Effects:
        Reads the PDF, runs the old code, leaves no bytecode in its repo, and silences logging and
        warnings.
    """
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(old_repo))
    logging.disable(logging.CRITICAL)
    warnings.simplefilter("ignore")
    sink = io.StringIO()
    step = "decrypt"
    try:
        with contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
            pdf_stream = io.BytesIO(pdf_path.read_bytes())
            decrypted = _old_function(step)(file_stream=pdf_stream, password=password)
            step = "extract"
            extracted = _old_function(step)(decrypted)
            rows = [_seven_fields(record) for record in _records_of(extracted)]
            step = "clean"
            cleaned = _old_function(step)(extracted)
            canonical = [_canonical_fields(record) for record in _records_of(cleaned)]
            step = "classify"
            classified = _old_function(step)(cleaned)
            step = "entities"
            enriched = _old_function(step)(classified)
            classified_rows = [_classified_fields(record) for record in _records_of(enriched)]
            step = "analyze"
            report = _plain_report(_old_function(step)(enriched))
            return rows, canonical, classified_rows, report
    except Exception:  # noqa: BLE001 - old code can raise anything; the caller reports the failure.
        raise OldExtractorError(step) from None


def _old_function(step):
    """Import one old step's function.

    Args:
        step: A key of ``OLD_STEPS``.

    Returns:
        The function.

    Side Effects:
        Imports the old module.
    """
    module_name, function_name = OLD_STEPS[step]
    return getattr(importlib.import_module(module_name), function_name)


def _records_of(extracted):
    """Read the old result as a list of maps, for a frame or a plain list.

    Args:
        extracted: What the old function returned.

    Returns:
        One map per row.

    Raises:
        OldExtractorError: If the result is neither a frame nor a list of maps.

    Side Effects:
        None.
    """
    if hasattr(extracted, "to_dict"):
        return extracted.to_dict("records")
    if isinstance(extracted, list) and all(isinstance(record, dict) for record in extracted):
        return extracted
    raise OldExtractorError


def _seven_fields(record):
    """Reduce one old row to the seven raw fields.

    Args:
        record: Map of old column name to value.

    Returns:
        Map of field name to text or None.

    Raises:
        OldExtractorError: If a field has no column.

    Side Effects:
        None.
    """
    by_normalized_name = {_normalized(name): value for name, value in record.items()}
    fields = {}
    for field, columns in FIELD_COLUMNS.items():
        present = [column for column in columns if column in by_normalized_name]
        if not present:
            raise OldExtractorError
        fields[field] = _as_text(by_normalized_name[present[0]])
    return fields


def _canonical_fields(record):
    """Keep the cleaning step's seven canonical fields, as text and float.

    Args:
        record: One row from the old cleaning step.

    Returns:
        Map of canonical name to text, None or float. A missing field or an amount that is not a
        number raises from the lookup or the conversion, and the caller names the clean step.

    Side Effects:
        None.
    """
    fields = {field: _as_text(record[field]) for field in CANONICAL_TEXT_FIELDS}
    for field in CANONICAL_AMOUNT_FIELDS:
        fields[field] = float(record[field])
    return fields


def _classified_fields(record):
    """Keep a classified row's receipt number and classification, as text and float.

    Args:
        record: One row from the old entity step.

    Returns:
        Map of field to text, None or float. An old enum member is written as its value. A
        missing field or a cost that is not a number raises, and the caller names the step.

    Side Effects:
        None.
    """
    fields = {
        field: _as_text(getattr(record[field], "value", record[field]))
        for field in CLASSIFIED_TEXT_FIELDS
    }
    for field in CLASSIFIED_AMOUNT_FIELDS:
        fields[field] = float(record[field])
    return fields


def _plain_report(analytics_result):
    """Turn the old analytics result into plain JSON values.

    Args:
        analytics_result: What the old analytics returned: a result object or a map.

    Returns:
        The report as a map of plain values. A number type JSON cannot write, such as a pandas
        sum, is written through its ``item`` method.

    Raises:
        TypeError: If the result is not a map; the caller names the step.

    Side Effects:
        None.
    """
    report = analytics_result
    if hasattr(analytics_result, "to_json_safe"):
        report = analytics_result.to_json_safe()
    if not isinstance(report, dict):
        raise TypeError
    return json.loads(json.dumps(report, default=_plain_number))


def _plain_number(value):
    """Convert one value JSON cannot write.

    Args:
        value: The value.

    Returns:
        Its plain Python value.

    Raises:
        TypeError: If the value has no ``item`` method to give one.

    Side Effects:
        None.
    """
    if hasattr(value, "item"):
        return value.item()
    raise TypeError


def _count_values(report):
    """Count the values in a report, however deeply they sit.

    Args:
        report: A JSON value.

    Returns:
        The number of values that are not themselves a map or a list.

    Side Effects:
        None.
    """
    if isinstance(report, dict):
        return sum(_count_values(inner) for inner in report.values())
    if isinstance(report, list):
        return sum(_count_values(inner) for inner in report)
    return 1


def _normalized(column_name):
    """Normalize an old column name, so punctuation and case do not matter.

    Args:
        column_name: The old column name.

    Returns:
        Lowercase words joined by underscores.

    Side Effects:
        None.
    """
    return re.sub(r"[^a-z0-9]+", "_", str(column_name).lower()).strip("_")


def _as_text(value):
    """Keep a raw value as text; a frame's missing markers become None.

    Args:
        value: The raw value.

    Returns:
        The string unchanged, None for a missing value, or the value's text.

    Side Effects:
        None.
    """
    if value is None or isinstance(value, str):
        return value
    text = str(value)
    return None if text in MISSING_VALUE_TEXTS else text


def _write_owner_only(path, text):
    """Write a file only its owner can read. Permissions tighten before any text is written.

    Args:
        path: The file to create or replace.
        text: The file's text.

    Side Effects:
        Creates or replaces the file.
    """
    descriptor = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, OWNER_ONLY)
    with os.fdopen(descriptor, "w", encoding="utf-8") as baseline:
        os.fchmod(baseline.fileno(), OWNER_ONLY)
        baseline.write(text)


def _print_counts(rows, canonical_rows, classified_rows):
    """Print fixed labels and counts.

    Args:
        rows: The extractor's rows.
        canonical_rows: The cleaning step's rows.
        classified_rows: The classified rows.

    Side Effects:
        Writes to stdout.
    """
    print(f"rows: {len(rows)}")
    for field in FIELD_COLUMNS:
        print(f"filled_{field}: {sum(bool(row[field]) for row in rows)}")
    print(f"canonical_rows: {len(canonical_rows)}")
    print(f"classified_rows: {len(classified_rows)}")


def _print_available_functions(old_repo, step):
    """Print what a failed step's old module offers, so the constants at the top can be corrected.

    Args:
        old_repo: The resolved old repo path.
        step: A key of ``OLD_STEPS``.

    Side Effects:
        Writes function names and signatures to stdout, and reads the module.
    """
    module_name = OLD_STEPS[step][0]
    sink = io.StringIO()
    try:
        with contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
            module = importlib.import_module(module_name)
            signatures = [
                f"{name}{inspect.signature(function)}"
                for name, function in inspect.getmembers(module, inspect.isfunction)
                if function.__module__ == module.__name__
            ]
    except Exception:  # noqa: BLE001 - a module that cannot import is read from its source instead.
        signatures = _function_names_from_source(old_repo, module_name)
    for signature in signatures:
        print(f"function: {signature}")


def _function_names_from_source(old_repo, module_name):
    """List a module's top-level functions without importing it.

    Args:
        old_repo: The resolved old repo path.
        module_name: The dotted module name.

    Returns:
        Function names; empty if the module's source cannot be read.

    Side Effects:
        Reads the module's source.
    """
    source_path = old_repo.joinpath(*module_name.split(".")).with_suffix(".py")
    if not source_path.is_file():
        return []
    tree = ast.parse(source_path.read_bytes())
    return [node.name for node in tree.body if isinstance(node, ast.FunctionDef)]


if __name__ == "__main__":
    sys.exit(main())
