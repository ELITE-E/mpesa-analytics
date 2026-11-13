import ast
import json
import stat
import subprocess
import sys

import pytest

from conftest import REPO

TOOL = REPO / "tools" / "equivalence" / "export_baseline.py"
CANNOT_RUN = 2
OWNER_ONLY = 0o600
MARKER = "PLANTEDROWTEXT"
PATH_MARKER = "SECRETPATHMARKER"
SEVEN_FIELDS = {
    "receipt_no",
    "completion_time",
    "details",
    "status",
    "paid_in",
    "withdrawn",
    "balance",
}
OLDEST_PYTHON = (3, 9)
STANDARD_LIBRARY_ONLY = {
    "argparse",
    "ast",
    "contextlib",
    "getpass",
    "importlib",
    "inspect",
    "io",
    "json",
    "logging",
    "os",
    "pathlib",
    "re",
    "subprocess",
    "sys",
    "warnings",
}
GOOD_ROWS = (
    """[
    {"Receipt No.": "first", "Completion Time": "2026-01-02 10:00:00", "Details": "%s",
     "Transaction Status": "Completed", "Paid In": None, "Withdrawn": "5.00", "Balance": "95.00"},
    {"Receipt No.": "second", "Completion Time": "2026-01-01 10:00:00", "Details": "older",
     "Transaction Status": "Completed", "Paid In": "100.00", "Withdrawn": "", "Balance": "100.00"},
]"""
    % MARKER
)
GOOD_FUNCTION = f"""
def extract_table_from_pdf(pdf_path, password=None):
    return {GOOD_ROWS}
"""
# The old pipeline decrypts in memory before extracting. This stand-in proves the bytes and the
# password reached it, and hands the extractor a stream saying so.
SECURITY_MODULE = """
from io import BytesIO

def decrypt_pdf_in_memory(file_stream, password=None):
    if not file_stream.read().startswith(b"%PDF"):
        raise ValueError("not a PDF")
    return BytesIO(("decrypted with %s" % password).encode())
"""
# A stand-in for the old cleaning step: canonical names, float amounts, details in capitals so a
# test can tell its output from the extractor's.
CLEAN_MODULE = """
import re

def clean_mpesa_dataframe(extracted):
    records = extracted.to_dict("records") if hasattr(extracted, "to_dict") else extracted
    return [_clean(record) for record in records]

def _clean(record):
    cells = {re.sub(r"[^a-z]+", "_", str(name).lower()).strip("_"): value
             for name, value in record.items()}
    return {
        "receipt_no": cells.get("receipt_no"),
        "completion_time": cells.get("completion_time"),
        "details": str(cells.get("details") or "").upper(),
        "transaction_status": cells.get("transaction_status", cells.get("status")),
        "paid_in": _amount(cells.get("paid_in")),
        "withdrawn": _amount(cells.get("withdrawn")),
        "balance": _amount(cells.get("balance")),
    }

def _amount(printed):
    try:
        return float(str(printed).replace(",", ""))
    except ValueError:
        return 0.0
"""


# Stand-ins for the old classifier and entity step. The classes mimic the old str-based enums,
# whose text is not their value, so the export must write each member's value.
ENGINE_MODULE = """
from enum import Enum

class Event(str, Enum):
    AIRTIME_PURCHASE = "AIRTIME_PURCHASE"

class Direction(str, Enum):
    OUTFLOW = "OUTFLOW"

class Meaning(str, Enum):
    CONSUMPTION = "CONSUMPTION"

def process_engine(cleaned):
    with open("diagnostics.jsonl", "a") as log:
        log.write("engine ran")
    return [
        {**row, "paid_out": abs(row["withdrawn"]), "event_type": Event.AIRTIME_PURCHASE,
         "cash_flow_direction": Direction.OUTFLOW, "economic_meaning": Meaning.CONSUMPTION,
         "total_cost": abs(row["withdrawn"])}
        for row in cleaned
    ]
"""
ENTITY_MODULE = """
def enrich_transactions_with_entities(classified):
    return [{**row, "entity": "NO_ENTITY_IDENTIFIED"} for row in classified]
"""


# A stand-in for the old analytics. Its figures use a number type that JSON cannot write as it is,
# as pandas sums are, so the export must turn them into plain numbers.
ANALYTICS_MODULE = """
class Figure:
    def __init__(self, amount):
        self.amount = amount

    def item(self):
        return self.amount


class Result:
    def __init__(self, enriched):
        self.enriched = enriched

    def to_json_safe(self):
        return {
            "cash_flow": {"total_outflow": Figure(sum(row["paid_out"] for row in self.enriched))},
            "spending": {
                "largest_purchases": [
                    {"recipient": row["entity"], "amount": row["total_cost"]}
                    for row in self.enriched
                ]
            },
        }


def orchestrate_analytics(enriched):
    return Result(enriched)
"""


@pytest.fixture
def old_repo(tmp_path):
    repo = tmp_path / "old-repo"
    (repo / "src").mkdir(parents=True)
    (repo / "src" / "__init__.py").write_text("")
    (repo / "src" / "extract.py").write_text(GOOD_FUNCTION)
    (repo / "src" / "security.py").write_text(SECURITY_MODULE)
    (repo / "src" / "clean.py").write_text(CLEAN_MODULE)
    (repo / "src" / "engine.py").write_text(ENGINE_MODULE)
    (repo / "src" / "entity.py").write_text(ENTITY_MODULE)
    (repo / "src" / "analytics.py").write_text(ANALYTICS_MODULE)
    subprocess.run(["git", "init", "-q", str(repo)], check=True)
    return repo


@pytest.fixture
def pdf_path(tmp_path):
    path = tmp_path / f"{PATH_MARKER}.pdf"
    path.write_bytes(b"%PDF-1.4 stand-in, the fake old extractor never opens it")
    return path


def run_export(old_repo, pdf_path, out, *extra, typed="", cwd=None):
    return subprocess.run(
        [
            sys.executable,
            str(TOOL),
            "--old-repo",
            str(old_repo),
            "--pdf",
            str(pdf_path),
            "--out",
            str(out),
            *extra,
        ],
        capture_output=True,
        text=True,
        input=f"{typed}\n",
        cwd=cwd,
    )


def baseline_rows(out):
    return json.loads((out / "baseline.json").read_text(encoding="utf-8"))["rows"]


def set_old_module(old_repo, source):
    (old_repo / "src" / "extract.py").write_text(source)


def test_writes_the_seven_raw_fields_per_row_in_print_order(old_repo, pdf_path, tmp_path):
    out = tmp_path / "out"
    completed = run_export(old_repo, pdf_path, out)
    assert completed.returncode == 0, completed.stdout + completed.stderr
    rows = baseline_rows(out)
    assert [row["receipt_no"] for row in rows] == ["first", "second"]
    assert all(set(row) == SEVEN_FIELDS for row in rows)
    assert rows[0]["status"] == "Completed"
    assert rows[0]["paid_in"] is None
    assert rows[1]["withdrawn"] == ""


def test_baseline_is_readable_by_the_owner_only(old_repo, pdf_path, tmp_path):
    out = tmp_path / "out"
    run_export(old_repo, pdf_path, out)
    assert stat.S_IMODE((out / "baseline.json").stat().st_mode) == OWNER_ONLY


def test_existing_baseline_with_loose_permissions_is_tightened(old_repo, pdf_path, tmp_path):
    out = tmp_path / "out"
    out.mkdir()
    (out / "baseline.json").write_text("old")
    (out / "baseline.json").chmod(0o644)
    assert run_export(old_repo, pdf_path, out).returncode == 0
    assert stat.S_IMODE((out / "baseline.json").stat().st_mode) == OWNER_ONLY


def test_prints_counts_only(old_repo, pdf_path, tmp_path):
    completed = run_export(old_repo, pdf_path, tmp_path / "out", typed="typed-secret")
    output = completed.stdout + completed.stderr
    for planted in (MARKER, PATH_MARKER, "typed-secret", "first", "95.00"):
        assert planted not in output
    labels = dict(line.split(": ") for line in completed.stdout.strip().splitlines())
    assert labels["rows"] == "2"
    assert all(value.isdigit() for value in labels.values())


def test_what_the_old_code_prints_or_logs_is_silenced(old_repo, pdf_path, tmp_path):
    set_old_module(
        old_repo,
        f"""
import logging
import sys
import warnings

def extract_table_from_pdf(pdf_path, password=None):
    print("{MARKER}")
    print("{MARKER}", file=sys.stderr)
    logging.getLogger("old").error("{MARKER}")
    warnings.warn("{MARKER}")
    return {GOOD_ROWS}
""",
    )
    completed = run_export(old_repo, pdf_path, tmp_path / "out")
    assert completed.returncode == 0
    assert MARKER not in completed.stdout + completed.stderr


def test_files_the_old_code_writes_nearby_land_in_the_output_directory(
    old_repo, pdf_path, tmp_path
):
    set_old_module(
        old_repo,
        f"""
def extract_table_from_pdf(pdf_path, password=None):
    with open("stray.log", "w") as log:
        log.write("{MARKER}")
    return {GOOD_ROWS}
""",
    )
    elsewhere = tmp_path / "started-here"
    elsewhere.mkdir()
    out = tmp_path / "out"
    assert run_export(old_repo, pdf_path, out, cwd=elsewhere).returncode == 0
    assert not (elsewhere / "stray.log").exists()
    assert (out / "stray.log").exists()


def test_old_repo_is_left_without_bytecode(old_repo, pdf_path, tmp_path):
    assert run_export(old_repo, pdf_path, tmp_path / "out").returncode == 0
    assert not list(old_repo.rglob("__pycache__"))


STREAM_ECHO = """
def extract_table_from_pdf(pdf_stream):
    return [dict.fromkeys(["Receipt No", "Completion Time", "Details", "Status", "Paid In",
                           "Withdrawn", "Balance"], pdf_stream.read().decode())]
"""


def test_password_comes_from_the_prompt_and_reaches_the_old_code(old_repo, pdf_path, tmp_path):
    set_old_module(old_repo, STREAM_ECHO)
    out = tmp_path / "out"
    assert run_export(old_repo, pdf_path, out, typed="typed-secret").returncode == 0
    assert baseline_rows(out)[0]["balance"] == "decrypted with typed-secret"


def test_blank_password_reaches_the_old_code_as_none(old_repo, pdf_path, tmp_path):
    set_old_module(old_repo, STREAM_ECHO)
    out = tmp_path / "out"
    assert run_export(old_repo, pdf_path, out).returncode == 0
    assert baseline_rows(out)[0]["balance"] == "decrypted with None"


def test_extractor_receives_the_decrypted_stream_not_a_path(old_repo, pdf_path, tmp_path):
    set_old_module(
        old_repo,
        f"""
import io

def extract_table_from_pdf(pdf_stream):
    assert isinstance(pdf_stream, io.BytesIO)
    return {GOOD_ROWS}
""",
    )
    assert run_export(old_repo, pdf_path, tmp_path / "out").returncode == 0


@pytest.mark.parametrize("option", ["--password", "--password=x", "--pass"], ids=str)
def test_password_options_are_rejected(old_repo, pdf_path, tmp_path, option):
    completed = run_export(old_repo, pdf_path, tmp_path / "out", option, "secret")
    assert completed.returncode == CANNOT_RUN
    assert "unrecognized arguments" in completed.stderr
    assert "secret" not in completed.stdout
    assert not (tmp_path / "out").exists()


def test_frame_like_results_are_read_through_to_dict(old_repo, pdf_path, tmp_path):
    set_old_module(
        old_repo,
        f"""
class Frame:
    def to_dict(self, orient):
        assert orient == "records"
        return {GOOD_ROWS}

def extract_table_from_pdf(pdf_path, password=None):
    return Frame()
""",
    )
    out = tmp_path / "out"
    assert run_export(old_repo, pdf_path, out).returncode == 0
    assert baseline_rows(out)[1]["receipt_no"] == "second"


def test_missing_values_and_non_text_become_none_or_text(old_repo, pdf_path, tmp_path):
    set_old_module(
        old_repo,
        """
def extract_table_from_pdf(pdf_path, password=None):
    return [{"Receipt No": 12, "Completion Time": float("nan"), "Details": None,
             "Status": "Completed", "Paid In": 1.5, "Withdrawn": float("nan"), "Balance": "2.00"}]
""",
    )
    out = tmp_path / "out"
    assert run_export(old_repo, pdf_path, out).returncode == 0
    row = baseline_rows(out)[0]
    assert row["receipt_no"] == "12"
    assert row["completion_time"] is None
    assert row["details"] is None
    assert row["paid_in"] == "1.5"
    assert row["withdrawn"] is None


def assert_refused(completed):
    assert completed.returncode == CANNOT_RUN
    assert "export_baseline: ERROR (--out must be outside both repos)" in completed.stdout


def assert_lists_names_and_signatures_only(completed, *expected):
    assert completed.returncode == CANNOT_RUN
    assert "export_baseline: ERROR" in completed.stdout
    output = completed.stdout + completed.stderr
    for text in expected:
        assert text in output
    for planted in (MARKER, PATH_MARKER, "Traceback"):
        assert planted not in output


def test_missing_function_lists_the_module_functions(old_repo, pdf_path, tmp_path):
    set_old_module(
        old_repo,
        f"""
def something_else(pdf_file, *, secret_word=None):
    return "{MARKER}"

def _private_one():
    return None
""",
    )
    completed = run_export(old_repo, pdf_path, tmp_path / "out")
    assert_lists_names_and_signatures_only(
        completed, "something_else(pdf_file, *, secret_word=None)", "_private_one()"
    )
    assert not (tmp_path / "out" / "baseline.json").exists()


def test_call_that_fails_lists_the_signature_and_never_the_error_text(old_repo, pdf_path, tmp_path):
    set_old_module(
        old_repo,
        f"""
def extract_table_from_pdf(pdf_path, password=None):
    raise ValueError("{MARKER} from {{}}".format(pdf_path))
""",
    )
    completed = run_export(old_repo, pdf_path, tmp_path / "out")
    assert_lists_names_and_signatures_only(
        completed, "extract_table_from_pdf(pdf_path, password=None)"
    )


def test_module_that_cannot_import_lists_its_function_names_from_source(
    old_repo, pdf_path, tmp_path
):
    set_old_module(
        old_repo,
        f"""
import a_module_that_is_not_installed

def extract_table_from_pdf(pdf_path, password=None):
    return "{MARKER}"
""",
    )
    completed = run_export(old_repo, pdf_path, tmp_path / "out")
    assert_lists_names_and_signatures_only(completed, "extract_table_from_pdf")


def test_module_that_does_not_exist_fails_with_no_names(old_repo, pdf_path, tmp_path):
    (old_repo / "src" / "extract.py").unlink()
    completed = run_export(old_repo, pdf_path, tmp_path / "out")
    assert_lists_names_and_signatures_only(completed)


def test_result_with_missing_columns_fails_and_writes_nothing(old_repo, pdf_path, tmp_path):
    set_old_module(
        old_repo,
        f"""
def extract_table_from_pdf(pdf_path, password=None):
    return [{{"{MARKER}": "1"}}]
""",
    )
    completed = run_export(old_repo, pdf_path, tmp_path / "out")
    assert_lists_names_and_signatures_only(completed, "extract_table_from_pdf(")
    assert not (tmp_path / "out" / "baseline.json").exists()


def test_empty_result_fails_and_writes_nothing(old_repo, pdf_path, tmp_path):
    set_old_module(
        old_repo, "def extract_table_from_pdf(pdf_path, password=None):\n    return []\n"
    )
    completed = run_export(old_repo, pdf_path, tmp_path / "out")
    assert completed.returncode == CANNOT_RUN
    assert "rows: 0" in completed.stdout
    assert not (tmp_path / "out" / "baseline.json").exists()


def test_result_of_an_unknown_shape_fails(old_repo, pdf_path, tmp_path):
    set_old_module(
        old_repo, f'def extract_table_from_pdf(pdf_path, password=None):\n    return "{MARKER}"\n'
    )
    assert_lists_names_and_signatures_only(
        run_export(old_repo, pdf_path, tmp_path / "out"), "extract_table_from_pdf("
    )


def test_refuses_an_output_inside_the_old_repo(old_repo, pdf_path):
    out = old_repo / "nested" / "out"
    assert_refused(run_export(old_repo, pdf_path, out))
    assert not (old_repo / "nested").exists()


def test_refuses_an_output_inside_the_old_repo_when_given_its_subdirectory(old_repo, pdf_path):
    out = old_repo / "nested"
    assert_refused(run_export(old_repo / "src" / "..", pdf_path, out))
    assert not out.exists()


def test_refuses_an_output_inside_this_repo(old_repo, pdf_path):
    out = REPO / "planted-baseline-dir"
    assert_refused(run_export(old_repo, pdf_path, out))
    assert not out.exists()


def test_refuses_a_link_that_leads_into_a_repo(old_repo, pdf_path, tmp_path):
    link = tmp_path / "link"
    link.symlink_to(REPO, target_is_directory=True)
    assert_refused(run_export(old_repo, pdf_path, link / "planted-baseline-dir"))
    assert not (REPO / "planted-baseline-dir").exists()


def test_tool_runs_on_an_older_python_than_this_repo():
    ast.parse(TOOL.read_text(encoding="utf-8"), feature_version=OLDEST_PYTHON)


def test_tool_uses_only_the_standard_library_so_the_old_python_can_run_it():
    tree = ast.parse(TOOL.read_bytes())
    roots = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            roots.update(alias.name.partition(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            roots.add((node.module or "").partition(".")[0])
    assert roots <= STANDARD_LIBRARY_ONLY


def test_old_module_and_function_are_named_constants():
    source = TOOL.read_text(encoding="utf-8")
    assert 'OLD_MODULE = "src.extract"' in source
    assert 'OLD_FUNCTION = "extract_table_from_pdf"' in source
    assert 'OLD_DECRYPT_MODULE = "src.security"' in source
    assert 'OLD_DECRYPT_FUNCTION = "decrypt_pdf_in_memory"' in source
    assert 'OLD_CLEAN_MODULE = "src.clean"' in source
    assert 'OLD_CLEAN_FUNCTION = "clean_mpesa_dataframe"' in source


def canonical_rows(out):
    return json.loads((out / "canonical.json").read_text(encoding="utf-8"))["rows"]


CANONICAL_FIELDS = {
    "receipt_no",
    "completion_time",
    "details",
    "transaction_status",
    "paid_in",
    "withdrawn",
    "balance",
}


def test_writes_the_old_clean_steps_rows_beside_the_baseline(old_repo, pdf_path, tmp_path):
    out = tmp_path / "out"
    completed = run_export(old_repo, pdf_path, out)
    assert completed.returncode == 0, completed.stdout + completed.stderr
    rows = canonical_rows(out)
    assert [row["receipt_no"] for row in rows] == ["first", "second"]
    assert all(set(row) == CANONICAL_FIELDS for row in rows)
    assert rows[0]["details"] == MARKER.upper()
    assert rows[0]["withdrawn"] == 5.0
    assert rows[1]["paid_in"] == 100.0
    assert rows[0]["transaction_status"] == "Completed"


def test_canonical_rows_are_readable_by_the_owner_only(old_repo, pdf_path, tmp_path):
    out = tmp_path / "out"
    assert run_export(old_repo, pdf_path, out).returncode == 0
    assert stat.S_IMODE((out / "canonical.json").stat().st_mode) == OWNER_ONLY


def test_counts_include_the_canonical_rows(old_repo, pdf_path, tmp_path):
    labels = dict(
        line.split(": ")
        for line in run_export(old_repo, pdf_path, tmp_path / "out").stdout.strip().splitlines()
    )
    assert labels["canonical_rows"] == "2"


def test_clean_step_that_fails_lists_its_functions_and_writes_neither_file(
    old_repo, pdf_path, tmp_path
):
    (old_repo / "src" / "clean.py").write_text(
        f'def clean_mpesa_dataframe(extracted, strict=True):\n    raise ValueError("{MARKER}")\n'
    )
    out = tmp_path / "out"
    completed = run_export(old_repo, pdf_path, out)
    assert_lists_names_and_signatures_only(
        completed, "clean_mpesa_dataframe(extracted, strict=True)"
    )
    assert "clean step" in completed.stdout
    assert not (out / "baseline.json").exists()
    assert not (out / "canonical.json").exists()


def test_clean_result_without_the_canonical_fields_fails(old_repo, pdf_path, tmp_path):
    (old_repo / "src" / "clean.py").write_text(
        f'def clean_mpesa_dataframe(extracted):\n    return [{{"{MARKER}": 1}}]\n'
    )
    completed = run_export(old_repo, pdf_path, tmp_path / "out")
    assert_lists_names_and_signatures_only(completed, "clean_mpesa_dataframe(extracted)")


def test_decrypt_step_that_fails_lists_its_functions(old_repo, pdf_path, tmp_path):
    failing_decrypt = (
        "def decrypt_pdf_in_memory(file_stream, password=None):\n"
        f'    raise ValueError("{MARKER}")\n'
    )
    (old_repo / "src" / "security.py").write_text(failing_decrypt)
    completed = run_export(old_repo, pdf_path, tmp_path / "out", typed="typed-secret")
    assert_lists_names_and_signatures_only(
        completed, "decrypt_pdf_in_memory(file_stream, password=None)"
    )
    assert "decrypt step" in completed.stdout
    assert "typed-secret" not in completed.stdout + completed.stderr


def test_missing_pdf_says_so_and_writes_nothing(old_repo, tmp_path):
    missing = tmp_path / f"{PATH_MARKER}.pdf"
    out = tmp_path / "out"
    completed = run_export(old_repo, missing, out)
    assert completed.returncode == CANNOT_RUN
    assert "export_baseline: ERROR (PDF not found)" in completed.stdout
    assert "rows: 0" not in completed.stdout
    assert PATH_MARKER not in completed.stdout + completed.stderr
    assert not out.exists()


def test_missing_pdf_is_reported_before_any_password_prompt(old_repo, tmp_path):
    completed = run_export(old_repo, tmp_path / "absent.pdf", tmp_path / "out")
    assert "PDF password" not in completed.stderr


CLASSIFIED_FIELDS = {
    "receipt_no",
    "event_type",
    "cash_flow_direction",
    "economic_meaning",
    "entity",
    "total_cost",
    "paid_out",
}


def classified_rows(out):
    return json.loads((out / "classified.json").read_text(encoding="utf-8"))["rows"]


def test_old_classifier_and_entity_constants_are_named():
    source = TOOL.read_text(encoding="utf-8")
    assert 'OLD_ENGINE_MODULE = "src.engine"' in source
    assert 'OLD_ENGINE_FUNCTION = "process_engine"' in source
    assert 'OLD_ENTITY_MODULE = "src.entity"' in source
    assert 'OLD_ENTITY_FUNCTION = "enrich_transactions_with_entities"' in source


def test_writes_the_old_classification_beside_the_baseline(old_repo, pdf_path, tmp_path):
    out = tmp_path / "out"
    completed = run_export(old_repo, pdf_path, out)
    assert completed.returncode == 0, completed.stdout + completed.stderr
    rows = classified_rows(out)
    assert [row["receipt_no"] for row in rows] == ["first", "second"]
    assert all(set(row) == CLASSIFIED_FIELDS for row in rows)
    assert rows[0]["event_type"] == "AIRTIME_PURCHASE"
    assert rows[0]["cash_flow_direction"] == "OUTFLOW"
    assert rows[0]["economic_meaning"] == "CONSUMPTION"
    assert rows[0]["entity"] == "NO_ENTITY_IDENTIFIED"
    assert rows[0]["total_cost"] == 5.0
    assert rows[0]["paid_out"] == 5.0


def test_classification_is_readable_by_the_owner_only(old_repo, pdf_path, tmp_path):
    out = tmp_path / "out"
    assert run_export(old_repo, pdf_path, out).returncode == 0
    assert stat.S_IMODE((out / "classified.json").stat().st_mode) == OWNER_ONLY


def test_counts_include_the_classified_rows(old_repo, pdf_path, tmp_path):
    labels = dict(
        line.split(": ")
        for line in run_export(old_repo, pdf_path, tmp_path / "out").stdout.strip().splitlines()
    )
    assert labels["classified_rows"] == "2"


def test_old_classifier_log_lands_in_the_output_directory(old_repo, pdf_path, tmp_path):
    elsewhere = tmp_path / "started-here"
    elsewhere.mkdir()
    out = tmp_path / "out"
    assert run_export(old_repo, pdf_path, out, cwd=elsewhere).returncode == 0
    assert (out / "diagnostics.jsonl").exists()
    assert not (elsewhere / "diagnostics.jsonl").exists()


@pytest.mark.parametrize(
    "failing_step",
    [
        ("engine.py", "def process_engine(cleaned):", "classify"),
        ("entity.py", "def enrich_transactions_with_entities(classified):", "entities"),
    ],
    ids=["classify", "entities"],
)
def test_classification_step_that_fails_lists_its_functions_and_writes_nothing(
    old_repo, pdf_path, tmp_path, failing_step
):
    module, function, step = failing_step
    (old_repo / "src" / module).write_text(f'{function}\n    raise ValueError("{MARKER}")\n')
    out = tmp_path / "out"
    completed = run_export(old_repo, pdf_path, out)
    assert_lists_names_and_signatures_only(completed, function[4:-1])
    assert f"old {step} step" in completed.stdout
    for name in ("baseline.json", "canonical.json", "classified.json"):
        assert not (out / name).exists()


def old_report(out):
    return json.loads((out / "report.json").read_text(encoding="utf-8"))


def test_old_analytics_constants_are_named():
    source = TOOL.read_text(encoding="utf-8")
    assert 'OLD_ANALYTICS_MODULE = "src.analytics"' in source
    assert 'OLD_ANALYTICS_FUNCTION = "orchestrate_analytics"' in source


def test_writes_the_old_report_beside_the_baseline(old_repo, pdf_path, tmp_path):
    out = tmp_path / "out"
    completed = run_export(old_repo, pdf_path, out)
    assert completed.returncode == 0, completed.stdout + completed.stderr
    report = old_report(out)
    assert report["cash_flow"] == {"total_outflow": 5.0}
    assert report["spending"]["largest_purchases"][0] == {
        "recipient": "NO_ENTITY_IDENTIFIED",
        "amount": 5.0,
    }


def test_old_report_is_readable_by_the_owner_only(old_repo, pdf_path, tmp_path):
    out = tmp_path / "out"
    assert run_export(old_repo, pdf_path, out).returncode == 0
    assert stat.S_IMODE((out / "report.json").stat().st_mode) == OWNER_ONLY


def test_counts_include_the_report_values(old_repo, pdf_path, tmp_path):
    labels = dict(
        line.split(": ")
        for line in run_export(old_repo, pdf_path, tmp_path / "out").stdout.strip().splitlines()
    )
    assert labels["report_values"] == "5"


def test_analytics_step_that_fails_lists_its_functions_and_writes_nothing(
    old_repo, pdf_path, tmp_path
):
    failing_analytics = (
        "def orchestrate_analytics(enriched, *, period_start=None):\n"
        f'    raise ValueError("{MARKER}")\n'
    )
    (old_repo / "src" / "analytics.py").write_text(failing_analytics)
    out = tmp_path / "out"
    completed = run_export(old_repo, pdf_path, out)
    assert_lists_names_and_signatures_only(
        completed, "orchestrate_analytics(enriched, *, period_start=None)"
    )
    assert "old analyze step" in completed.stdout
    for name in ("baseline.json", "canonical.json", "classified.json", "report.json"):
        assert not (out / name).exists()


def test_report_that_is_not_a_map_fails(old_repo, pdf_path, tmp_path):
    (old_repo / "src" / "analytics.py").write_text(
        f'def orchestrate_analytics(enriched):\n    return "{MARKER}"\n'
    )
    completed = run_export(old_repo, pdf_path, tmp_path / "out")
    assert_lists_names_and_signatures_only(completed, "orchestrate_analytics(enriched)")
