import copy
import json
import os
import re
import subprocess
import sys
import unicodedata

import pytest

from conftest import REPO
from mpesa_core import pipeline
from mpesa_core.analysis import analyze_transactions
from mpesa_core.classification.classify import classify_transactions
from mpesa_core.cleaning.canonicalize import canonicalize_rows
from mpesa_core.errors import AnalysisError, DomainRowError
from synth.generate import FAKE_PASSWORD, ON_DEMAND_FIXTURES, build_outputs
from synth.layout import wrap_details

TOOL = REPO / "tools" / "equivalence" / "compare.py"
FIXTURES = REPO / "tests" / "fixtures" / "synthetic"
SEVEN_FIELDS = (
    "receipt_no",
    "completion_time",
    "details",
    "status",
    "paid_in",
    "withdrawn",
    "balance",
)
GATE_FIELDS = ("completion_time", "paid_in", "withdrawn", "balance")
FAILED = 1
CANNOT_RUN = 2
MARKER = "PLANTED7MARKER"
PATH_MARKER = "SECRETPATHMARKER"
SHARE_LINE = re.compile(r"^[A-Za-z0-9_ .:()=-]*$")
COMMON_STATUS_COUNT = 20


def expected_rows(name):
    fixture = json.loads((FIXTURES / f"{name}.expected.json").read_text(encoding="utf-8"))
    return fixture["rows"]


def baseline_from(name, change=None):
    rows = [{field: row[field] for field in SEVEN_FIELDS} for row in expected_rows(name)]
    return change(rows) or rows if change else rows


def write_baseline(
    tmp_path, rows, canonical_change=None, classified_change=None, report_change=None
):
    path = tmp_path / f"{PATH_MARKER}.json"
    path.write_text(json.dumps({"rows": rows}), encoding="utf-8")
    canonical = old_canonical_rows(rows)
    if canonical_change:
        canonical = canonical_change(canonical) or canonical
    (tmp_path / "canonical.json").write_text(json.dumps({"rows": canonical}), encoding="utf-8")
    classified = old_classified_rows(rows)
    if classified_change:
        classified = classified_change(classified) or classified
    (tmp_path / "classified.json").write_text(json.dumps({"rows": classified}), encoding="utf-8")
    report = old_report(rows)
    if report_change:
        report = report_change(report) or report
    (tmp_path / "report.json").write_text(json.dumps(report), encoding="utf-8")
    return path


def old_report(rows):
    """What export_baseline writes from the old analytics, built here from the new analysis."""
    usable = [
        {**row, "page": 0, "line": 0}
        for row in rows
        if isinstance(row, dict)
        and all(isinstance(row.get(field), str | None) for field in SEVEN_FIELDS)
    ]
    canonical = canonicalize_rows(usable)
    try:
        classified = classify_transactions(canonical)[0]
    except DomainRowError:
        classified = []
        for row in canonical:
            try:
                classified += classify_transactions([row])[0]
            except DomainRowError:
                continue
    try:
        return analyze_transactions(classified)
    except AnalysisError:
        # A planted row with an unreadable date stops the old analytics too (A-3).
        return analyze_transactions(
            [row for row in classified if row["completion_time"][:2] == "20"]
        )


def old_classified_rows(rows):
    """What export_baseline writes from the old classifier and entity step, in its format."""
    usable = [
        {**row, "page": 0, "line": 0}
        for row in rows
        if isinstance(row, dict)
        and all(isinstance(row.get(field), str | None) for field in SEVEN_FIELDS)
    ]
    canonical = canonicalize_rows(usable)
    try:
        classified = classify_transactions(canonical)[0]
    except DomainRowError:
        # A planted row with no amount stops the run; classify the others one by one.
        classified = []
        for row in canonical:
            try:
                classified += classify_transactions([row])[0]
            except DomainRowError:
                continue
    return [
        {
            "receipt_no": row["receipt_no"],
            "event_type": str(row["event_type"]),
            "cash_flow_direction": str(row["cash_flow_direction"]),
            "economic_meaning": str(row["economic_meaning"]),
            "entity": row["entity"] or "NO_ENTITY_IDENTIFIED",
            "total_cost": row["total_cost"],
            "paid_out": row["paid_out"],
        }
        for row in classified
    ]


def old_canonical_rows(rows):
    """What export_baseline writes from the old cleaning step: its names, float amounts."""
    raw_rows = [{**row, "page": 0, "line": 0} for row in rows if isinstance(row, dict)]
    usable = [
        row
        for row in raw_rows
        if all(isinstance(row.get(field), str | None) for field in SEVEN_FIELDS)
    ]
    return [
        {
            "receipt_no": row["receipt_no"],
            "completion_time": row["completion_time"],
            "details": row["details"],
            "transaction_status": row["status"],
            "paid_in": row["paid_in"],
            "withdrawn": row["withdrawn"],
            "balance": row["balance"],
        }
        for row in canonicalize_rows(usable)
    ]


def run_compare(pdf_path, baseline_path, *options, typed=""):
    return subprocess.run(
        [
            sys.executable,
            str(TOOL),
            "--pdf",
            str(pdf_path),
            "--baseline",
            str(baseline_path),
            *options,
        ],
        capture_output=True,
        text=True,
        input=f"{typed}\n",
    )


def compare_fixture(tmp_path, name, change=None, *options, typed=""):
    baseline = write_baseline(tmp_path, baseline_from(name, change))
    return run_compare(FIXTURES / f"{name}.pdf", baseline, "--share", *options, typed=typed)


def counts_of(completed):
    labels = {}
    for line in completed.stdout.splitlines():
        label, separator, value = line.partition(": ")
        if separator:
            labels[label] = value
    return labels


def gates_of(completed):
    return {
        line.split()[1]: line.split()[0]
        for line in completed.stdout.splitlines()
        if line.startswith(("PASS ", "FAIL "))
    }


def test_identical_rows_pass(tmp_path):
    completed = compare_fixture(tmp_path, "F-GOLDEN")
    assert completed.returncode == 0, completed.stdout + completed.stderr
    counts = counts_of(completed)
    assert counts["rows_old"] == "60"
    assert counts["rows_new"] == "60"
    assert counts["matched"] == "60"
    assert counts["old_only"] == "0"
    assert counts["new_only"] == "0"
    for field in SEVEN_FIELDS:
        assert counts[f"mismatch_{field}"] == "0"
    assert set(gates_of(completed).values()) == {"PASS"}
    assert completed.stdout.strip().splitlines()[-1] == "RESULT: PASS"


STAGE_ONE_GATES = (
    "row_count_equal",
    "zero_mismatch_receipt_no",
    "zero_mismatch_completion_time",
    "zero_mismatch_paid_in",
    "zero_mismatch_withdrawn",
    "zero_mismatch_balance",
    "status_mismatches",
    "chain_breaks",
)


def test_final_lines_are_the_agreed_gates(tmp_path):
    gates = gates_of(compare_fixture(tmp_path, "F-GOLDEN"))
    assert set(gates) == {
        "row_count_equal",
        "zero_mismatch_receipt_no",
        "zero_mismatch_completion_time",
        "zero_mismatch_paid_in",
        "zero_mismatch_withdrawn",
        "zero_mismatch_balance",
        "status_mismatches",
        "chain_breaks",
        "canonical_row_count_equal",
        "zero_mismatch_details_normalized",
        "zero_mismatch_amounts",
        "zero_mismatch_status",
        "zero_mismatch_event_type",
        "zero_mismatch_direction",
        "zero_mismatch_meaning",
        "zero_mismatch_entity",
        "zero_mismatch_total_cost",
        "class_count_table_identical",
        "report_paths_equal",
    }


@pytest.mark.parametrize("field", GATE_FIELDS)
def test_a_mismatch_in_a_gated_field_fails(tmp_path, field):
    def change(rows):
        rows[3][field] = "9,999.99"

    completed = compare_fixture(tmp_path, "F-GOLDEN", change)
    assert completed.returncode == FAILED
    assert counts_of(completed)[f"mismatch_{field}"] == "1"
    assert gates_of(completed)[f"zero_mismatch_{field}"] == "FAIL"
    assert completed.stdout.strip().splitlines()[-1] == "RESULT: FAIL"


def test_a_different_receipt_shows_as_old_only_and_new_only_and_fails(tmp_path):
    def change(rows):
        rows[3]["receipt_no"] = "ZZ" + "NOTTHEONE"

    completed = compare_fixture(tmp_path, "F-GOLDEN", change)
    counts = counts_of(completed)
    assert counts["old_only"] == "1"
    assert counts["new_only"] == "1"
    assert counts["matched"] == "59"
    assert gates_of(completed)["row_count_equal"] == "PASS"
    assert gates_of(completed)["zero_mismatch_receipt_no"] == "FAIL"
    assert completed.returncode == FAILED


def test_a_missing_old_row_fails_the_row_count(tmp_path):
    completed = compare_fixture(tmp_path, "F-GOLDEN", lambda rows: rows[1:])
    counts = counts_of(completed)
    assert counts["rows_old"] == "59"
    assert counts["new_only"] == "1"
    assert gates_of(completed)["row_count_equal"] == "FAIL"
    assert completed.returncode == FAILED


def test_an_extra_old_row_fails_the_row_count(tmp_path):
    def change(rows):
        return [*rows, {**rows[0], "receipt_no": "ZZ" + "EXTRAROW1"}]

    completed = compare_fixture(tmp_path, "F-GOLDEN", change)
    assert counts_of(completed)["old_only"] == "1"
    assert gates_of(completed)["row_count_equal"] == "FAIL"


def test_none_and_empty_string_are_equal_after_strip(tmp_path):
    def change(rows):
        for row in rows:
            for field in SEVEN_FIELDS:
                if row[field] is None:
                    row[field] = "   "
                else:
                    row[field] = f"  {row[field]} "

    # The old export writes its report from the real rows, never from padded ones.
    unpadded_report = old_report(baseline_from("F-GOLDEN"))
    baseline = write_baseline(
        tmp_path, baseline_from("F-GOLDEN", change), report_change=lambda _: unpadded_report
    )
    completed = run_compare(FIXTURES / "F-GOLDEN.pdf", baseline, "--share")
    assert completed.returncode == 0, completed.stdout
    assert all(counts_of(completed)[f"mismatch_{field}"] == "0" for field in SEVEN_FIELDS)


def test_details_mismatch_is_counted_and_fails_only_the_canonical_details_gate(tmp_path):
    def change(rows):
        rows[0]["details"] = "something else"

    completed = compare_fixture(tmp_path, "F-GOLDEN", change)
    assert counts_of(completed)["mismatch_details"] == "1"
    gates = gates_of(completed)
    assert all(gates[gate] == "PASS" for gate in STAGE_ONE_GATES)
    assert gates["zero_mismatch_details_normalized"] == "FAIL"


def test_equal_receipts_align_by_occurrence(tmp_path):
    rows = expected_rows("F-TIES")
    assert rows[0]["receipt_no"] == rows[1]["receipt_no"]

    def swap_first_pair(baseline):
        baseline[0], baseline[1] = baseline[1], baseline[0]

    counts = counts_of(compare_fixture(tmp_path, "F-TIES", swap_first_pair))
    assert counts["matched"] == "12"
    assert counts["mismatch_balance"] == "2"
    assert counts["mismatch_details"] == "2"


def test_status_mismatch_passes_when_counted_and_shows_classes(tmp_path):
    def change(rows):
        for row in rows[:COMMON_STATUS_COUNT]:
            row["status"] = "Pending"
        rows[-1]["status"] = "Rare"

    completed = compare_fixture(tmp_path, "F-MULTIPAGE", change)
    counts = counts_of(completed)
    assert counts["mismatch_status"] == str(COMMON_STATUS_COUNT + 1)
    assert counts["status_old_new Pending x Completed"] == str(COMMON_STATUS_COUNT)
    assert counts["status_old_new OTHER x Completed"] == "1"
    assert counts["status_old_new Completed x Completed"] == str(220 - COMMON_STATUS_COUNT - 1)
    failing = {gate for gate, verdict in gates_of(completed).items() if verdict == "FAIL"}
    assert gates_of(completed)["status_mismatches"] == "PASS"
    assert failing == {"zero_mismatch_status"}


@pytest.mark.parametrize(
    ("value", "shown"),
    [
        ("Completed Now", True),
        ("ab", False),
        ("A" * 21, False),
        ("Has 1 digit", False),
        ("Punctuated!", False),
    ],
    ids=["words", "too-short", "too-long", "digit", "punctuation"],
)
def test_common_status_shows_only_if_it_is_short_letters_and_spaces(tmp_path, value, shown):
    def change(rows):
        for row in rows[:COMMON_STATUS_COUNT]:
            row["status"] = value

    completed = compare_fixture(tmp_path, "F-MULTIPAGE", change)
    assert counts_of(completed)["mismatch_status"] == str(COMMON_STATUS_COUNT)
    assert (f"status_old_new {value} x " in completed.stdout) is shown


def test_status_seen_fewer_than_twenty_times_never_shows(tmp_path):
    def change(rows):
        for row in rows[: COMMON_STATUS_COUNT - 1]:
            row["status"] = "Pending"

    completed = compare_fixture(tmp_path, "F-MULTIPAGE", change)
    assert counts_of(completed)["mismatch_status"] == str(COMMON_STATUS_COUNT - 1)
    assert "Pending" not in completed.stdout


def test_chain_breaks_identical_on_both_sides_are_reported_with_their_overlap(tmp_path):
    completed = compare_fixture(tmp_path, "F-CHAIN-BREAK")
    counts = counts_of(completed)
    assert counts["chain_breaks_old"] == "5"
    assert counts["chain_breaks_new"] == "5"
    assert counts["chain_breaks_both"] == "5"
    assert "PASS chain_breaks (identical)" in completed.stdout


def test_chain_breaks_that_differ_are_counted_not_failed(tmp_path):
    def change(rows):
        rows[0]["balance"] = "1.23"

    completed = compare_fixture(tmp_path, "F-TIES", change)
    counts = counts_of(completed)
    assert counts["chain_breaks_old"] == "1"
    assert counts["chain_breaks_new"] == "0"
    assert counts["chain_breaks_both"] == "0"
    assert "PASS chain_breaks (counted)" in completed.stdout


def is_multi_line(row):
    return len(wrap_details(row["details"])) > 1


def test_mismatch_features_are_counted(tmp_path):
    rows = expected_rows("F-MULTIPAGE")
    single_line_inside_page_one = next(
        position
        for position, row in enumerate(rows[:-1])
        if position > 0
        and not is_multi_line(row)
        and rows[position - 1]["page"] == row["page"] == rows[position + 1]["page"] == 1
    )
    wrapped_at_a_later_page_edge = next(
        position
        for position, row in enumerate(rows[:-1])
        if position > 0
        and is_multi_line(row)
        and row["page"] > 1
        and row["page"] in {rows[position - 1]["page"] + 1, rows[position + 1]["page"] - 1}
    )

    def change(baseline):
        baseline[single_line_inside_page_one]["details"] = "changed"
        baseline[wrapped_at_a_later_page_edge]["paid_in"] = "1.00"

    counts = counts_of(compare_fixture(tmp_path, "F-MULTIPAGE", change))
    assert counts["mismatch_rows"] == "2"
    assert counts["mismatch_rows_multi_line"] == "1"
    assert counts["mismatch_rows_first_or_last_on_page"] == "1"
    assert counts["mismatch_rows_page_1"] == "1"


def test_mismatch_on_a_tied_timestamp_is_counted(tmp_path):
    def change(rows):
        rows[0]["details"] = "changed"

    counts = counts_of(compare_fixture(tmp_path, "F-TIES", change))
    assert counts["mismatch_rows_tied_timestamp"] == "1"


def test_summary_totals_are_reported_as_yes_or_no_per_side(tmp_path):
    counts = counts_of(compare_fixture(tmp_path, "F-SUMMARY-MISMATCH"))
    assert counts["summary_total_paid_in_matches_new"] == "no"
    assert counts["summary_total_paid_out_matches_new"] == "yes"
    assert counts["summary_total_paid_in_matches_old"] == "no"
    assert counts["summary_total_paid_out_matches_old"] == "yes"
    assert counts["summary_type_rows_parsed"] == "7"
    assert not any(label.startswith("summary_new_") for label in counts)


def test_an_unknown_summary_total_reads_not_found():
    from equivalence.compare import _summary_lines

    unknown = {
        "summary_total_paid_in_matches": None,
        "summary_total_paid_out_matches": False,
        "summary_type_rows_parsed": 0,
    }
    assert _summary_lines(unknown, unknown) == [
        "summary_total_paid_in_matches_old: not_found",
        "summary_total_paid_in_matches_new: not_found",
        "summary_total_paid_out_matches_old: no",
        "summary_total_paid_out_matches_new: no",
        "summary_type_rows_parsed: 0",
    ]


def test_layout_counts_answer_the_open_questions(tmp_path):
    counts = counts_of(compare_fixture(tmp_path, "F-CONT-ABOVE"))
    assert int(counts["continuation_lines_above"]) > 0
    assert counts["continuation_lines_below"] == "0"
    assert counts["status_from_non_anchor_line"] == "0"
    assert counts["receipt_length_10"] == "40"


def test_planted_text_never_appears_in_the_output(tmp_path):
    def change(rows):
        for field in SEVEN_FIELDS:
            rows[0][field] = MARKER
            rows[1][field] = f"{MARKER} more words {MARKER}"
        return [*rows, {field: MARKER for field in SEVEN_FIELDS}]

    baseline = write_baseline(tmp_path, baseline_from("F-GOLDEN", change))
    source = FIXTURES / "F-GOLDEN.pdf"
    linked = tmp_path / f"{PATH_MARKER}.pdf"
    linked.symlink_to(source)
    for options in (("--share",), ()):
        completed = run_compare(linked, baseline, *options)
        output = completed.stdout + completed.stderr
        assert counts_of(completed)["old_only"] == "3"
        assert MARKER not in output
        assert PATH_MARKER not in output
        assert "ZZ" not in output
        assert "Example" not in output


def test_share_output_is_only_labels_numbers_and_verdicts(tmp_path):
    completed = compare_fixture(tmp_path, "F-MULTIPAGE")
    assert completed.returncode == 0
    for line in completed.stdout.splitlines():
        assert SHARE_LINE.match(line), "line has an unexpected character"


def test_local_output_adds_positions_and_share_output_does_not(tmp_path):
    def change(rows):
        rows[2]["balance"] = "1.23"

    baseline = write_baseline(tmp_path, baseline_from("F-GOLDEN", change))
    pdf_path = FIXTURES / "F-GOLDEN.pdf"
    assert "mismatch_at" in run_compare(pdf_path, baseline).stdout
    assert "mismatch_at" not in run_compare(pdf_path, baseline, "--share").stdout


def test_encrypted_statement_uses_the_password_prompt(tmp_path):
    completed = compare_fixture(tmp_path, "F-ENCRYPTED", typed=FAKE_PASSWORD)
    assert completed.returncode == 0, completed.stdout + completed.stderr
    assert "PDF password" in completed.stderr
    assert FAKE_PASSWORD not in completed.stdout + completed.stderr


def test_wrong_password_reports_only_a_code(tmp_path):
    completed = compare_fixture(tmp_path, "F-ENCRYPTED", typed="wrong-one")
    assert completed.returncode == CANNOT_RUN
    assert "compare: ERROR (PASSWORD_INCORRECT)" in completed.stdout
    assert "wrong-one" not in completed.stdout + completed.stderr


def test_statement_with_no_anchor_reports_its_code(tmp_path):
    baseline = write_baseline(tmp_path, [])
    completed = run_compare(FIXTURES / "F-NOTABLE.pdf", baseline, "--share")
    assert completed.returncode == CANNOT_RUN
    assert "compare: ERROR (LAYOUT_UNRECOGNIZED)" in completed.stdout


@pytest.mark.parametrize(
    "content",
    ["not json", "[]", '{"rows": 3}', '{"rows": [3]}', '{"rows": [{"receipt_no": "x"}]}'],
    ids=["text", "list", "number", "non-map", "missing-fields"],
)
def test_baseline_of_the_wrong_shape_reports_an_error_without_its_content(tmp_path, content):
    path = tmp_path / f"{PATH_MARKER}.json"
    path.write_text(content)
    completed = run_compare(FIXTURES / "F-GOLDEN.pdf", path, "--share")
    assert completed.returncode == CANNOT_RUN
    assert "compare: ERROR (BASELINE_UNREADABLE)" in completed.stdout
    assert PATH_MARKER not in completed.stdout + completed.stderr


def test_missing_baseline_does_not_repeat_its_path(tmp_path):
    completed = run_compare(FIXTURES / "F-GOLDEN.pdf", tmp_path / f"{PATH_MARKER}.json", "--share")
    assert completed.returncode == CANNOT_RUN
    assert "compare: ERROR" in completed.stdout
    assert PATH_MARKER not in completed.stdout + completed.stderr


@pytest.mark.parametrize("option", ["--password", "--password=x", "--pass"], ids=str)
def test_password_options_are_rejected(tmp_path, option):
    baseline = write_baseline(tmp_path, baseline_from("F-ENCRYPTED"))
    completed = run_compare(FIXTURES / "F-ENCRYPTED.pdf", baseline, option, "secret")
    assert completed.returncode == CANNOT_RUN
    assert "unrecognized arguments" in completed.stderr


def repo_state():
    return subprocess.run(
        ["git", "status", "--porcelain", "--ignored"],
        cwd=REPO,
        capture_output=True,
        text=True,
        check=True,
    ).stdout


def without_bytecode(status):
    return {line for line in status.splitlines() if "__pycache__" not in line}


def test_nothing_is_written_inside_the_repo(tmp_path):
    before = without_bytecode(repo_state())
    assert compare_fixture(tmp_path, "F-GOLDEN").returncode == 0
    assert without_bytecode(repo_state()) == before


def test_extracted_statement_pages_are_deleted_afterwards(tmp_path):
    scratch = tmp_path / "scratch"
    scratch.mkdir()
    baseline = write_baseline(tmp_path, baseline_from("F-GOLDEN"))
    completed = subprocess.run(
        [
            sys.executable,
            str(TOOL),
            "--pdf",
            str(FIXTURES / "F-GOLDEN.pdf"),
            "--baseline",
            str(baseline),
        ],
        capture_output=True,
        text=True,
        input="\n",
        env={**os.environ, "TMPDIR": str(scratch)},
    )
    assert completed.returncode == 0, completed.stdout + completed.stderr
    assert list(scratch.iterdir()) == []


def test_receipts_are_compared_through_a_key_that_changes_every_run(tmp_path):
    first = compare_fixture(tmp_path, "F-GOLDEN")
    second = compare_fixture(tmp_path, "F-GOLDEN")
    assert first.stdout == second.stdout
    source = TOOL.read_text(encoding="utf-8")
    assert "secrets.token_bytes" in source
    assert "hmac.new" in source


def test_lines_outside_rows_are_broken_down_and_none_is_unexplained(tmp_path):
    counts = counts_of(compare_fixture(tmp_path, "F-GOLDEN"))
    assert counts["unattached_header_lines"] == "2"
    assert counts["unattached_footer_lines"] == "4"
    assert counts["unattached_summary_lines"] == "13"
    assert counts["unattached_other_lines"] == "0"
    assert counts["unattached_page_heading_lines"] == "0"
    assert counts["unattached_lines"] == "19"


CANONICAL_GATES = (
    "canonical_row_count_equal",
    "zero_mismatch_details_normalized",
    "zero_mismatch_amounts",
    "zero_mismatch_status",
)
CANONICAL_FIELDS = ("completion_time", "details", "status", "paid_in", "withdrawn", "balance")


def compare_with_canonical(tmp_path, name, canonical_change):
    baseline = write_baseline(tmp_path, baseline_from(name), canonical_change)
    return run_compare(FIXTURES / f"{name}.pdf", baseline, "--share")


def test_canonical_rows_that_agree_pass_every_canonical_gate(tmp_path):
    completed = compare_fixture(tmp_path, "F-GOLDEN")
    counts = counts_of(completed)
    assert counts["canonical_rows_old"] == "60"
    assert counts["canonical_rows_new"] == "60"
    assert counts["canonical_matched"] == "60"
    for field in CANONICAL_FIELDS:
        assert counts[f"canonical_mismatch_{field}"] == "0"
    gates = gates_of(completed)
    assert all(gates[gate] == "PASS" for gate in CANONICAL_GATES)
    assert completed.returncode == 0


@pytest.mark.parametrize(
    ("field", "value", "gate"),
    [
        ("details", "something else", "zero_mismatch_details_normalized"),
        ("paid_in", 1.25, "zero_mismatch_amounts"),
        ("withdrawn", 1.25, "zero_mismatch_amounts"),
        ("balance", 1.25, "zero_mismatch_amounts"),
        ("transaction_status", "Pending", "zero_mismatch_status"),
    ],
)
def test_a_canonical_mismatch_fails_its_gate(tmp_path, field, value, gate):
    def change(canonical):
        canonical[3][field] = value

    completed = compare_with_canonical(tmp_path, "F-GOLDEN", change)
    counted_as = "status" if field == "transaction_status" else field
    assert counts_of(completed)[f"canonical_mismatch_{counted_as}"] == "1"
    assert gates_of(completed)[gate] == "FAIL"
    assert completed.returncode == FAILED


def test_amounts_are_compared_exactly_as_floats(tmp_path):
    def change(canonical):
        canonical[0]["balance"] = canonical[0]["balance"] + 1e-9

    completed = compare_with_canonical(tmp_path, "F-GOLDEN", change)
    assert counts_of(completed)["canonical_mismatch_balance"] == "1"


def test_completion_time_mismatch_is_counted_but_is_not_a_gate(tmp_path):
    def change(canonical):
        canonical[0]["completion_time"] = "2000-01-01 00:00:00"

    completed = compare_with_canonical(tmp_path, "F-GOLDEN", change)
    assert counts_of(completed)["canonical_mismatch_completion_time"] == "1"
    assert completed.returncode == 0


def test_a_missing_canonical_row_fails_the_canonical_row_count(tmp_path):
    completed = compare_with_canonical(tmp_path, "F-GOLDEN", lambda canonical: canonical[1:])
    counts = counts_of(completed)
    assert counts["canonical_rows_old"] == "59"
    assert gates_of(completed)["canonical_row_count_equal"] == "FAIL"
    assert gates_of(completed)["row_count_equal"] == "PASS"


def test_missing_canonical_file_reports_an_error(tmp_path):
    baseline = write_baseline(tmp_path, baseline_from("F-GOLDEN"))
    (tmp_path / "canonical.json").unlink()
    completed = run_compare(FIXTURES / "F-GOLDEN.pdf", baseline, "--share")
    assert completed.returncode == CANNOT_RUN
    assert "compare: ERROR (CANONICAL_UNREADABLE)" in completed.stdout


def test_canonical_text_never_appears_in_the_output(tmp_path):
    def change(canonical):
        for field in ("details", "transaction_status", "completion_time"):
            canonical[0][field] = MARKER

    completed = compare_with_canonical(tmp_path, "F-GOLDEN", change)
    assert counts_of(completed)["canonical_mismatch_details"] == "1"
    assert MARKER not in completed.stdout + completed.stderr


def test_other_lines_are_broken_down_by_page_and_offset_counts_only(tmp_path):
    counts = counts_of(compare_fixture(tmp_path, "F-GOLDEN"))
    assert counts["unattached_other_pages"] == "0"
    assert not [label for label in counts if label.startswith("unattached_other_offset_")]


CLASSIFIED_GATES = (
    "zero_mismatch_event_type",
    "zero_mismatch_direction",
    "zero_mismatch_meaning",
    "zero_mismatch_entity",
    "zero_mismatch_total_cost",
    "class_count_table_identical",
)


def compare_with_classified(tmp_path, name, classified_change):
    baseline = write_baseline(tmp_path, baseline_from(name), classified_change=classified_change)
    return run_compare(FIXTURES / f"{name}.pdf", baseline, "--share")


def test_classification_that_agrees_passes_every_classification_gate(tmp_path):
    completed = compare_fixture(tmp_path, "F-GOLDEN")
    counts = counts_of(completed)
    assert counts["classified_rows_old"] == "60"
    assert counts["classified_rows_new"] == "60"
    for field in (
        "event_type",
        "cash_flow_direction",
        "economic_meaning",
        "entity",
        "total_cost",
        "paid_out",
    ):
        assert counts[f"classified_mismatch_{field}"] == "0"
    gates = gates_of(completed)
    assert all(gates[gate] == "PASS" for gate in CLASSIFIED_GATES)
    assert completed.returncode == 0


@pytest.mark.parametrize(
    ("field", "value", "gate"),
    [
        ("event_type", "DEPOSIT", "zero_mismatch_event_type"),
        ("cash_flow_direction", "INFLOW", "zero_mismatch_direction"),
        ("economic_meaning", "UNKNOWN", "zero_mismatch_meaning"),
        ("entity", "Example Other Entity", "zero_mismatch_entity"),
        ("total_cost", 12345.0, "zero_mismatch_total_cost"),
    ],
)
def test_a_classification_mismatch_fails_its_gate(tmp_path, field, value, gate):
    def change(classified):
        classified[3][field] = value

    completed = compare_with_classified(tmp_path, "F-GOLDEN", change)
    assert counts_of(completed)[f"classified_mismatch_{field}"] == "1"
    assert gates_of(completed)[gate] == "FAIL"
    assert completed.returncode == FAILED


def test_a_changed_class_changes_the_class_count_table(tmp_path):
    def change(classified):
        classified[3]["event_type"] = "DEPOSIT"

    completed = compare_with_classified(tmp_path, "F-GOLDEN", change)
    counts = counts_of(completed)
    assert counts["class_count_old_event_type DEPOSIT"] == "1"
    assert "class_count_new_event_type DEPOSIT" not in counts
    assert gates_of(completed)["class_count_table_identical"] == "FAIL"


def test_class_count_tables_name_classes_only(tmp_path):
    def change(classified):
        classified[0]["event_type"] = MARKER

    completed = compare_with_classified(tmp_path, "F-GOLDEN", change)
    counts = counts_of(completed)
    assert counts["class_count_old_event_type OTHER"] == "1"
    assert MARKER not in completed.stdout


def test_the_no_entity_marker_equals_no_entity(tmp_path):
    completed = compare_fixture(tmp_path, "F-GOLDEN")
    assert counts_of(completed)["classified_mismatch_entity"] == "0"


def test_entity_values_never_appear_in_the_output(tmp_path):
    def change(classified):
        for row in classified:
            row["entity"] = MARKER

    completed = compare_with_classified(tmp_path, "F-GOLDEN", change)
    assert counts_of(completed)["classified_mismatch_entity"] == "60"
    assert MARKER not in completed.stdout + completed.stderr


def test_total_cost_mismatches_beyond_half_a_cent_are_counted_separately(tmp_path):
    def change(classified):
        classified[0]["total_cost"] += 0.001
        classified[1]["total_cost"] += 1.0

    counts = counts_of(compare_with_classified(tmp_path, "F-GOLDEN", change))
    assert counts["classified_mismatch_total_cost"] == "2"
    assert counts["classified_mismatch_total_cost_over_half_cent"] == "1"


def test_chain_breaks_are_split_by_the_event_type_of_the_row_after_the_break(tmp_path):
    counts = counts_of(compare_fixture(tmp_path, "F-CHAIN-BREAK"))
    split = {
        label: int(value)
        for label, value in counts.items()
        if label.startswith("chain_breaks_new_after_")
    }
    assert sum(split.values()) == 5
    assert all(label.removeprefix("chain_breaks_new_after_").isupper() for label in split)


def test_missing_classification_file_reports_an_error(tmp_path):
    baseline = write_baseline(tmp_path, baseline_from("F-GOLDEN"))
    (tmp_path / "classified.json").unlink()
    completed = run_compare(FIXTURES / "F-GOLDEN.pdf", baseline, "--share")
    assert completed.returncode == CANNOT_RUN
    assert "compare: ERROR (CLASSIFIED_UNREADABLE)" in completed.stdout


def compare_with_report(tmp_path, name, report_change):
    baseline = write_baseline(tmp_path, baseline_from(name), report_change=report_change)
    return run_compare(FIXTURES / f"{name}.pdf", baseline, "--share")


def report_lines(completed):
    return [line for line in completed.stdout.splitlines() if line.startswith("report_")]


def test_reports_that_agree_pass_the_report_gate(tmp_path):
    completed = compare_fixture(tmp_path, "F-GOLDEN")
    counts = counts_of(completed)
    assert int(counts["report_paths_total"]) > 50
    assert counts["report_paths_equal"] == counts["report_paths_total"]
    assert counts["report_paths_different"] == "0"
    assert counts["report_paths_different_below_half_cent"] == "0"
    assert gates_of(completed)["report_paths_equal"] == "PASS"
    assert completed.returncode == 0


def test_a_changed_figure_is_reported_by_its_path_never_its_value(tmp_path):
    def change(report):
        report["cash_flow"]["total_inflow"] = 123456.78
        report["transfers"]["largest_transfers"][2]["amount"] = 98765.43

    completed = compare_with_report(tmp_path, "F-GOLDEN", change)
    counts = counts_of(completed)
    assert counts["report_paths_different"] == "2"
    assert "report_path_different: cash_flow.total_inflow" in completed.stdout
    assert "report_path_different: transfers.largest_transfers[2].amount" in completed.stdout
    assert "123456" not in completed.stdout
    assert "98765" not in completed.stdout
    assert gates_of(completed)["report_paths_equal"] == "FAIL"
    assert completed.returncode == FAILED


def test_a_difference_below_half_a_cent_is_counted_on_its_own(tmp_path):
    def change(report):
        report["cash_flow"]["total_outflow"] += 0.001

    counts = counts_of(compare_with_report(tmp_path, "F-GOLDEN", change))
    assert counts["report_paths_different"] == "1"
    assert counts["report_paths_different_below_half_cent"] == "1"


def test_a_path_on_one_side_only_counts_as_different(tmp_path):
    def change(report):
        report["spending"]["largest_purchases"].append({"recipient": MARKER, "amount": 1.0})

    completed = compare_with_report(tmp_path, "F-GOLDEN", change)
    counts = counts_of(completed)
    assert counts["report_paths_different"] == "2"
    assert MARKER not in completed.stdout


def test_a_key_outside_the_schema_is_masked(tmp_path):
    def change(report):
        report["cash_flow"][MARKER] = 1.0

    completed = compare_with_report(tmp_path, "F-GOLDEN", change)
    assert "report_path_different: cash_flow.<key>" in completed.stdout
    assert MARKER not in completed.stdout + completed.stderr


def test_report_text_values_never_appear(tmp_path):
    def change(report):
        for transfer in report["transfers"]["largest_transfers"]:
            transfer["recipient"] = MARKER

    completed = compare_with_report(tmp_path, "F-GOLDEN", change)
    assert int(counts_of(completed)["report_paths_different"]) > 0
    assert MARKER not in completed.stdout + completed.stderr


def test_missing_report_file_reports_an_error(tmp_path):
    baseline = write_baseline(tmp_path, baseline_from("F-GOLDEN"))
    (tmp_path / "report.json").unlink()
    completed = run_compare(FIXTURES / "F-GOLDEN.pdf", baseline, "--share")
    assert completed.returncode == CANNOT_RUN
    assert "compare: ERROR (REPORT_UNREADABLE)" in completed.stdout


def test_every_report_line_is_a_label_a_path_or_a_count(tmp_path):
    def change(report):
        report["cash_flow"]["total_inflow"] = 1.0

    completed = compare_with_report(tmp_path, "F-GOLDEN", change)
    for line in report_lines(completed):
        assert re.fullmatch(r"report_[a-z_]+: [a-z_.<>\[\]0-9]+", line), line


def test_attestation_and_the_full_pipeline_run_are_reported(tmp_path):
    counts = counts_of(compare_fixture(tmp_path, "F-GOLDEN"))
    assert counts["attestation"] == "PASS"
    assert counts["pipeline_run"] == "PASS"


def test_balances_are_reported_as_yes_or_no_never_as_amounts(tmp_path):
    completed = compare_fixture(tmp_path, "F-GOLDEN")
    counts = counts_of(completed)
    assert counts["balances_orientation"] == "newest_first"
    assert counts["balances_opening_found"] == "yes"
    assert counts["balances_closing_found"] == "yes"
    assert counts["balances_closing_equals_old_report"] == "yes"
    assert counts["balances_closing_equals_new_report"] == "yes"
    assert counts["balances_identity_holds"] == "yes"
    expected = json.loads((FIXTURES / "F-GOLDEN.expected.json").read_text(encoding="utf-8"))
    for figure in ("opening_balance", "closing_balance"):
        assert expected[figure] not in completed.stdout
        assert f"{float(expected[figure]):,.2f}" not in completed.stdout


def test_balances_disagreeing_with_the_old_report_read_no(tmp_path):
    def shift_closing(report):
        report["cash_flow"]["closing_balance"] += 1.0

    baseline = write_baseline(tmp_path, baseline_from("F-GOLDEN"), report_change=shift_closing)
    completed = run_compare(FIXTURES / "F-GOLDEN.pdf", baseline, "--share")
    assert counts_of(completed)["balances_closing_equals_old_report"] == "no"


def test_a_broken_chain_breaks_the_balance_identity(tmp_path):
    counts = counts_of(compare_fixture(tmp_path, "F-CHAIN-BREAK"))
    assert counts["balances_identity_holds"] == "no"
    assert counts["balances_closing_found"] == "yes"


def test_identity_and_residual_lines_on_a_clean_chain(tmp_path):
    counts = counts_of(compare_fixture(tmp_path, "F-GOLDEN"))
    assert counts["identity_gap_zero_within_half_cent"] == "yes"
    assert counts["identity_gap_bucket"] == "lt_1"
    assert counts["break_residuals_total"] == "0"
    assert counts["break_residuals_paired_adjacent"] == "0"
    assert counts["break_residuals_unpaired"] == "0"
    assert counts["chain_breaks_raw"] == "0"
    assert counts["chain_breaks_after_reorder"] == "0"
    assert counts["chain_breaks_resolved_by_group_reorder"] == "0"
    assert counts["chain_breaks_resolved_by_receipt_groups"] == "0"
    assert counts["chain_breaks_resolved_by_time_groups"] == "0"
    assert counts["reorder_groups_too_large"] == "0"
    assert counts["remaining_breaks_on_page_boundary"] == "0"
    assert counts["remaining_break_residuals_matching_nearby_amount"] == "0"
    assert not any(label.startswith("remaining_breaks_after_") for label in counts)


def test_the_removed_and_duplicate_diagnostic_lines_are_gone(tmp_path):
    counts = counts_of(compare_fixture(tmp_path, "F-CHAIN-BREAK"))
    assert "break_residuals_unpaired_sum_equals_gap" not in counts
    assert "chain_breaks_remaining_after_group_reorder" not in counts


def test_group_sizes_are_printed_as_a_histogram(tmp_path):
    counts = counts_of(compare_fixture(tmp_path, "F-TIES"))
    sizes = {
        int(label.removeprefix("reorder_group_size_")): int(value)
        for label, value in counts.items()
        if label.startswith("reorder_group_size_")
    }
    assert sizes
    assert all(size >= 2 and count > 0 for size, count in sizes.items())


def test_planted_breaks_are_unpaired_and_add_up_to_the_gap(tmp_path):
    completed = compare_fixture(tmp_path, "F-CHAIN-BREAK")
    counts = counts_of(completed)
    breaks = int(counts["break_residuals_total"])
    assert breaks == 5
    assert counts["break_residuals_paired_adjacent"] == "0"
    assert counts["break_residuals_unpaired"] == "5"
    assert counts["identity_gap_zero_within_half_cent"] == "no"
    assert counts["identity_gap_bucket"] == "lt_10000"
    assert counts["chain_breaks_raw"] == "5"
    resolved = int(counts["chain_breaks_resolved_by_group_reorder"])
    remaining = int(counts["chain_breaks_after_reorder"])
    assert resolved + remaining == breaks
    after_types = sum(
        int(value) for label, value in counts.items() if label.startswith("remaining_breaks_after_")
    )
    assert after_types == remaining
    assert int(counts["remaining_breaks_on_page_boundary"]) <= remaining
    assert int(counts["remaining_break_residuals_matching_nearby_amount"]) <= remaining
    for planted_shift in ("777.00", "777.0", "3885", "3,885"):
        assert planted_shift not in completed.stdout


@pytest.mark.parametrize(
    ("gap", "bucket"),
    [
        (0.0, "lt_1"),
        (-0.99, "lt_1"),
        (-1.0, "lt_100"),
        (99.5, "lt_100"),
        (100.0, "lt_10000"),
        (-9999.99, "lt_10000"),
        (10000.0, "gte_10000"),
        (None, "not_found"),
    ],
)
def test_identity_gap_bucket_uses_the_size_without_its_sign(gap, bucket):
    from equivalence.compare import _gap_bucket

    assert _gap_bucket(gap) == bucket


@pytest.mark.parametrize(
    ("residuals", "paired", "unpaired"),
    [
        ([], 0, 0),
        ([5.0, -5.0], 2, 0),
        ([5.0, -5.0, 7.0], 2, 1),
        ([5.0, 7.0, -7.0, -5.0], 2, 2),
        ([5.0, 5.0], 0, 2),
        ([5.0, -5.004], 2, 0),
        ([5.0, -5.006], 0, 2),
        ([3.0, -3.0, 3.0, -3.0], 4, 0),
    ],
)
def test_neighbouring_breaks_with_opposite_residuals_pair_up(residuals, paired, unpaired):
    from equivalence.compare import _pair_residuals

    assert _pair_residuals(residuals) == (paired, unpaired)


def run_labels(name, *options):
    return subprocess.run(
        [sys.executable, str(TOOL), "--pdf", str(FIXTURES / f"{name}.pdf"), "--labels", *options],
        capture_output=True,
        text=True,
        input="\n",
    )


IDENTITY_WORDS = ("@", "Customer", "Mobile", "Email", "Name", "Example Person")


def test_labels_prints_the_summary_block_with_digits_masked():
    completed = run_labels("F-GOLDEN")
    assert completed.returncode == 0, completed.stdout + completed.stderr
    lines = completed.stdout.splitlines()
    assert lines[0] == "SUMMARY"
    assert len(lines) == 9
    assert lines[1] == "SEND MONEY: " + lines[1].removeprefix("SEND MONEY: ")
    assert lines[-1].startswith("TOTAL: ")
    assert "DETAILED STATEMENT" not in completed.stdout
    assert not any(character.isdigit() for character in completed.stdout)
    assert "#" in completed.stdout


def test_labels_never_prints_the_lines_above_the_summary():
    completed = run_labels("F-GOLDEN")
    assert completed.returncode == 0
    for line in completed.stdout.splitlines():
        for word in IDENTITY_WORDS:
            assert word not in line


def test_labels_prints_nothing_and_exits_2_without_the_markers():
    completed = run_labels("F-NOTABLE")
    assert completed.returncode == 2
    assert completed.stdout == ""


def test_labels_prints_nothing_else():
    completed = run_labels("F-GOLDEN")
    assert "RESULT" not in completed.stdout
    assert "PASS" not in completed.stdout
    assert completed.stderr == ""


def test_labels_cannot_be_combined_with_share():
    completed = run_labels("F-GOLDEN", "--share")
    assert completed.returncode == 2
    assert "SEND MONEY" not in completed.stdout + completed.stderr


def test_a_report_without_labels_still_needs_a_baseline():
    completed = subprocess.run(
        [sys.executable, str(TOOL), "--pdf", str(FIXTURES / "F-GOLDEN.pdf"), "--share"],
        capture_output=True,
        text=True,
    )
    assert completed.returncode == 2


# compare.py --browser-result: the browser engine's output against the baseline (CP8a item 8).
# The directory is what tools/equivalence/browser_run.mjs writes: the browser's statement pages
# and its pipeline result, without the account digest.

PROCESSED_AT = "2026-11-16T09:00:00Z"
BROWSER_GATE = "browser_result_equals_cpython"


def write_browser_result(directory, name, change=None, pages_change=None):
    """Write pages.json and result.json as browser_run.mjs does, from the recorded pages.

    ``pages_change`` alters the pages before the result is computed from them; ``change`` alters
    the result afterwards, as a browser that disagreed with CPython would.
    """
    directory.mkdir()
    pages = json.loads((FIXTURES / f"{name}.items.json").read_text(encoding="utf-8"))
    if pages_change:
        pages_change(pages)
    pages_text = json.dumps(pages)
    (directory / "pages.json").write_text(pages_text, encoding="utf-8")
    pipeline_result = json.loads(
        json.dumps(pipeline.run(json.loads(pages_text), processed_at=PROCESSED_AT))
    )
    present = pipeline_result.pop("account_digest") is not None
    if change:
        change(pipeline_result)
    browser_result = {
        "processed_at": PROCESSED_AT,
        "pipeline_result": pipeline_result,
        "account_digest_present": present,
    }
    (directory / "result.json").write_text(json.dumps(browser_result), encoding="utf-8")
    return directory


def run_with_browser_result(tmp_path, name, change=None, *options, pages_change=None):
    baseline = write_baseline(tmp_path, baseline_from(name))
    browser = write_browser_result(tmp_path / "browser", name, change, pages_change)
    return subprocess.run(
        [
            sys.executable,
            str(TOOL),
            "--browser-result",
            str(browser),
            "--baseline",
            str(baseline),
            "--share",
            *options,
        ],
        capture_output=True,
        text=True,
        check=False,
    )


def test_a_matching_browser_result_passes_every_gate_and_the_browser_gate(tmp_path):
    completed = run_with_browser_result(tmp_path, "F-GOLDEN")
    assert completed.returncode == 0, completed.stdout + completed.stderr
    gates = gates_of(completed)
    assert gates[BROWSER_GATE] == "PASS"
    assert set(gates.values()) == {"PASS"}
    assert completed.stdout.strip().splitlines()[-1] == "RESULT: PASS"


def test_the_lines_are_the_pdf_runs_lines_plus_the_browser_gate(tmp_path):
    (tmp_path / "pdf").mkdir()
    from_pdf = compare_fixture(tmp_path / "pdf", "F-GOLDEN")
    from_browser = run_with_browser_result(tmp_path, "F-GOLDEN")
    pdf_lines = from_pdf.stdout.strip().splitlines()
    browser_lines = from_browser.stdout.strip().splitlines()
    # Every line the browser comparison adds names "browser_".
    assert [line for line in browser_lines if "browser_" not in line] == pdf_lines


def test_a_browser_result_that_differs_from_cpython_fails_its_gate(tmp_path):
    def change(pipeline_result):
        pipeline_result["transactions"][0]["paid_out"] += 1.0

    completed = run_with_browser_result(tmp_path, "F-GOLDEN", change)
    assert completed.returncode == 1
    assert gates_of(completed)[BROWSER_GATE] == "FAIL"
    assert completed.stdout.strip().splitlines()[-1] == "RESULT: FAIL"


def test_a_browser_result_holding_the_account_digest_is_refused(tmp_path):
    def change(pipeline_result):
        pipeline_result["account_digest"] = "0" * 64

    completed = run_with_browser_result(tmp_path, "F-GOLDEN", change)
    assert completed.returncode == 2
    assert completed.stdout == "compare: ERROR (BROWSER_RESULT_HOLDS_DIGEST)\n"


def test_a_missing_browser_result_cannot_run(tmp_path):
    baseline = write_baseline(tmp_path, baseline_from("F-GOLDEN"))
    completed = subprocess.run(
        [
            sys.executable,
            str(TOOL),
            "--browser-result",
            str(tmp_path / "absent"),
            "--baseline",
            str(baseline),
            "--share",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert completed.returncode == 2
    assert completed.stdout == "compare: ERROR (BROWSER_RESULT_UNREADABLE)\n"


def test_digest_presence_is_reported_but_excluded_from_the_gate(tmp_path):
    completed = run_with_browser_result(tmp_path, "F-GOLDEN")
    result_path = tmp_path / "browser" / "result.json"
    browser_result = json.loads(result_path.read_text(encoding="utf-8"))
    flipped = copy.deepcopy(browser_result)
    flipped["account_digest_present"] = not browser_result["account_digest_present"]
    result_path.write_text(json.dumps(flipped), encoding="utf-8")
    rerun = subprocess.run(
        [
            sys.executable,
            str(TOOL),
            "--browser-result",
            str(tmp_path / "browser"),
            "--baseline",
            str(tmp_path / "SECRETPATHMARKER.json"),
            "--share",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert completed.returncode == 0
    # account_digest is left out of the browser output by design, so it is excluded from the
    # comparison; whether both sides read one is still reported.
    assert gates_of(rerun)[BROWSER_GATE] == "PASS"
    assert counts_of(rerun)["browser_vs_cpython_account_digest_present_agrees"] == "no"


def test_labels_cannot_be_combined_with_a_browser_result(tmp_path):
    completed = subprocess.run(
        [
            sys.executable,
            str(TOOL),
            "--browser-result",
            str(tmp_path),
            "--pdf",
            "x.pdf",
            "--labels",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert completed.returncode == 2
    assert "--labels" in completed.stderr


def test_shared_browser_output_is_labels_and_counts_only(tmp_path):
    completed = run_with_browser_result(tmp_path, "F-GOLDEN")
    assert completed.returncode == 0
    for line in completed.stdout.splitlines():
        assert SHARE_LINE.fullmatch(line), line
    assert "SECRETPATHMARKER" not in completed.stdout
    assert str(tmp_path) not in completed.stdout


# CP8a-2 item 6: why browser_result_equals_cpython fails, in counts only.

TOP_LEVEL_KEYS = (
    "balances",
    "diagnostics",
    "period",
    "processed_at",
    "quality",
    "report",
    "schema_version",
    "transactions",
    "verification_token",
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
PLANTED_TILL = "Merchant Payment Example Till 110"
PLANTED_CAFE = unicodedata.normalize("NFC", "Merchant Payment Example Caf\u00e9 110")


def plant_cafe(pages):
    for page in pages["pages"]:
        for text_item in page["items"]:
            if text_item["text"] == PLANTED_TILL:
                text_item["text"] = PLANTED_CAFE
                return
    raise AssertionError("planted item not found")


def run_browser_and_pdf(tmp_path, pages_change=None):
    baseline = write_baseline(tmp_path, baseline_from("F-GOLDEN"))
    browser = write_browser_result(tmp_path / "browser", "F-GOLDEN", None, pages_change)
    return subprocess.run(
        [
            sys.executable,
            str(TOOL),
            "--browser-result",
            str(browser),
            "--pdf",
            str(FIXTURES / "F-GOLDEN.pdf"),
            "--baseline",
            str(baseline),
            "--share",
        ],
        capture_output=True,
        text=True,
        check=False,
        input="\n",
    )


def test_a_matching_browser_result_counts_no_differing_path_under_any_top_level_key(tmp_path):
    counts = counts_of(run_with_browser_result(tmp_path, "F-GOLDEN"))
    for key in TOP_LEVEL_KEYS:
        assert counts[f"browser_vs_cpython_paths_differing {key}"] == "0", key
        assert counts[f"browser_vs_cpython_paths_below_half_cent {key}"] == "0", key
    assert "browser_vs_cpython_paths_differing account_digest" not in counts


def test_differing_paths_are_counted_per_top_level_key_with_those_below_half_a_cent(tmp_path):
    def change(pipeline_result):
        pipeline_result["report"]["cash_flow"]["total_inflow"] += 1e-9
        pipeline_result["quality"]["row_count"] += 1
        pipeline_result["transactions"][2]["paid_out"] += 1.0

    completed = run_with_browser_result(tmp_path, "F-GOLDEN", change)
    counts = counts_of(completed)
    assert counts["browser_vs_cpython_paths_differing report"] == "1"
    assert counts["browser_vs_cpython_paths_below_half_cent report"] == "1"
    assert counts["browser_vs_cpython_paths_differing quality"] == "1"
    assert counts["browser_vs_cpython_paths_below_half_cent quality"] == "0"
    assert counts["browser_vs_cpython_paths_differing transactions"] == "1"
    assert counts["browser_vs_cpython_paths_differing diagnostics"] == "0"
    assert gates_of(completed)[BROWSER_GATE] == "FAIL"


def test_rows_are_counted_per_field_with_whether_normalisation_clears_them(tmp_path):
    def change(pipeline_result):
        rows = pipeline_result["transactions"]
        cafe = next(row for row in rows if row["details"] == PLANTED_CAFE)
        cafe["details"] = unicodedata.normalize("NFD", PLANTED_CAFE)
        rows[0]["status"] = rows[0]["status"] + "  "
        rows[1]["paid_out"] += 1.0
        rows[3]["entity"] = "Example Person 99"

    completed = run_with_browser_result(tmp_path, "F-GOLDEN", change, pages_change=plant_cafe)
    counts = counts_of(completed)
    assert counts["browser_vs_cpython_row_count_equal"] == "yes"
    assert counts["browser_vs_cpython_rows_differing details"] == "1"
    assert counts["browser_vs_cpython_rows_equal_after_normalisation details"] == "yes"
    assert counts["browser_vs_cpython_rows_differing status"] == "1"
    assert counts["browser_vs_cpython_rows_equal_after_normalisation status"] == "yes"
    assert counts["browser_vs_cpython_rows_differing paid_out"] == "1"
    assert counts["browser_vs_cpython_rows_equal_after_normalisation paid_out"] == "no"
    assert counts["browser_vs_cpython_rows_differing entity"] == "1"
    assert counts["browser_vs_cpython_rows_equal_after_normalisation entity"] == "no"
    for field in set(ROW_FIELDS) - {"details", "status", "paid_out", "entity"}:
        assert counts[f"browser_vs_cpython_rows_differing {field}"] == "0", field
        assert f"browser_vs_cpython_rows_equal_after_normalisation {field}" not in counts
    assert "Caf" not in completed.stdout
    assert "Example Person 99" not in completed.stdout


def test_a_browser_result_with_fewer_rows_says_the_row_counts_differ(tmp_path):
    def change(pipeline_result):
        pipeline_result["transactions"].pop()

    counts = counts_of(run_with_browser_result(tmp_path, "F-GOLDEN", change))
    assert counts["browser_vs_cpython_row_count_equal"] == "no"


def test_the_account_digest_is_left_out_by_design_and_excluded_explicitly(tmp_path):
    # browser_run writes only whether a digest was read; the verification token is kept.
    counts = counts_of(run_with_browser_result(tmp_path, "F-GOLDEN"))
    assert counts["browser_output_omits_account_digest"] == "yes"
    assert counts["browser_output_omits_verification_token"] == "no"
    assert counts["browser_vs_cpython_excluded_by_design"] == "account_digest"
    assert counts["browser_vs_cpython_account_digest_present_agrees"] == "yes"


def test_without_a_pdf_the_browser_pages_are_not_compared_with_the_node_reader(tmp_path):
    counts = counts_of(run_with_browser_result(tmp_path, "F-GOLDEN"))
    assert counts["browser_vs_node_pages_compared"] == "no"


def test_with_the_pdf_the_browser_pages_are_compared_with_the_node_readers_pages(tmp_path):
    completed = run_browser_and_pdf(tmp_path)
    assert completed.returncode == 0, completed.stdout + completed.stderr
    counts = counts_of(completed)
    assert counts["browser_vs_node_pages_compared"] == "yes"
    assert counts["browser_vs_node_pages_browser"] == counts["browser_vs_node_pages_node"] == "2"
    items = sum(
        len(page["items"])
        for page in json.loads((FIXTURES / "F-GOLDEN.items.json").read_text(encoding="utf-8"))[
            "pages"
        ]
    )
    assert (
        counts["browser_vs_node_items_browser"]
        == counts["browser_vs_node_items_node"]
        == str(items)
    )
    assert counts["browser_vs_node_items_differing"] == "0"
    assert counts["browser_vs_node_items_differing_after_normalisation"] == "0"


def test_page_items_that_differ_only_in_text_normalisation_are_counted_apart(tmp_path):
    def pages_change(pages):
        items = pages["pages"][0]["items"]
        till = next(text_item for text_item in items if text_item["text"] == PLANTED_TILL)
        till["text"] = PLANTED_TILL.replace(" ", "  ")
        items[0]["x0"] += 0.01

    counts = counts_of(run_browser_and_pdf(tmp_path, pages_change))
    assert counts["browser_vs_node_items_differing"] == "2"
    assert counts["browser_vs_node_items_differing_after_normalisation"] == "1"


# CP8a-3: which report paths differ, masked, and whether only tie order differs.

REPORT_PATH_LINE = re.compile(
    r"^browser_vs_cpython_report_path: [a-z_.<>\[\]0-9]+ type=(number|string|null) "
    r"parent_list_reordered=(yes|no)( magnitude=(lt_1|lt_100|lt_10000|gte))?$"
)


def report_path_lines(completed):
    return [
        line
        for line in completed.stdout.splitlines()
        if line.startswith("browser_vs_cpython_report_path:")
    ]


def swap_first_two_purchases(pipeline_result):
    purchases = pipeline_result["report"]["spending"]["largest_purchases"]
    purchases[0], purchases[1] = purchases[1], purchases[0]


def test_a_reordered_report_list_prints_masked_paths_with_type_and_reordered_yes(tmp_path):
    completed = run_with_browser_result(tmp_path, "F-GOLDEN", swap_first_two_purchases)
    lines = report_path_lines(completed)
    assert lines
    for line in lines:
        assert REPORT_PATH_LINE.fullmatch(line), line
        assert "parent_list_reordered=yes" in line
        assert line.split()[1].startswith("spending.largest_purchases[")
    assert any("type=string" in line for line in lines)
    assert "Example" not in completed.stdout
    assert "ZZ" not in completed.stdout


def test_a_changed_report_number_prints_its_magnitude_and_reordered_no(tmp_path):
    def change(pipeline_result):
        pipeline_result["report"]["cash_flow"]["total_inflow"] += 1.0

    lines = report_path_lines(run_with_browser_result(tmp_path, "F-GOLDEN", change))
    assert len(lines) == 1
    path, kind, reordered, magnitude = lines[0].split()[1:]
    assert path == "cash_flow.total_inflow"
    assert (kind, reordered) == ("type=number", "parent_list_reordered=no")
    assert magnitude in {"magnitude=lt_10000", "magnitude=gte"}


def test_a_report_key_taken_from_data_is_masked(tmp_path):
    def change(pipeline_result):
        pipeline_result["report"]["spending"]["Example Person 77"] = None

    completed = run_with_browser_result(tmp_path, "F-GOLDEN", change)
    assert report_path_lines(completed) == [
        "browser_vs_cpython_report_path: spending.<key> type=null parent_list_reordered=no"
    ]
    assert "Example Person 77" not in completed.stdout


def run_browser_only(tmp_path, *options):
    browser = write_browser_result(tmp_path / "browser", "F-GOLDEN")
    return subprocess.run(
        [
            sys.executable,
            str(TOOL),
            "--browser-result",
            str(browser),
            "--skip-baseline",
            "--share",
            *options,
        ],
        capture_output=True,
        text=True,
        check=False,
    )


def test_skip_baseline_runs_only_the_browser_against_cpython_part(tmp_path):
    completed = run_browser_only(tmp_path)
    assert completed.returncode == 0, completed.stdout + completed.stderr
    counts = counts_of(completed)
    assert "rows_old" not in counts
    assert counts["browser_vs_cpython_paths_differing report"] == "0"
    assert gates_of(completed) == {BROWSER_GATE: "PASS"}
    assert completed.stdout.strip().splitlines()[-1] == "RESULT: PASS"


def test_skip_baseline_needs_a_browser_result(tmp_path):
    completed = subprocess.run(
        [sys.executable, str(TOOL), "--pdf", "x.pdf", "--skip-baseline"],
        capture_output=True,
        text=True,
        check=False,
    )
    assert completed.returncode == 2
    assert "--skip-baseline" in completed.stderr


@pytest.fixture(scope="module")
def tied_statement(tmp_path_factory):
    seed, options = ON_DEMAND_FIXTURES["F-TIED"]
    outputs = build_outputs(seed, options)
    directory = tmp_path_factory.mktemp("tied")
    (directory / "F-TIED.pdf").write_bytes(outputs[".pdf"])
    rows = json.loads(outputs[".expected.json"])["rows"]
    return directory / "F-TIED.pdf", [{field: row[field] for field in SEVEN_FIELDS} for row in rows]


def compare_tied(tmp_path, tied_statement, report_change):
    pdf_path, rows = tied_statement
    baseline = write_baseline(tmp_path, rows, report_change=report_change)
    return run_compare(pdf_path, baseline, "--share")


def swap_tied_purchases(report):
    purchases = report["spending"]["largest_purchases"]
    first = next(
        index
        for index in range(len(purchases) - 1)
        if purchases[index]["amount"] == purchases[index + 1]["amount"]
    )
    purchases[first], purchases[first + 1] = purchases[first + 1], purchases[first]


def test_an_old_report_differing_only_in_tie_order_passes_and_is_counted_per_path_class(
    tmp_path, tied_statement
):
    completed = compare_tied(tmp_path, tied_statement, swap_tied_purchases)
    counts = counts_of(completed)
    assert int(counts["report_paths_tie_order_only"]) >= 1
    assert int(counts["report_tie_order_only spending.largest_purchases[].transaction"]) >= 1
    assert counts["report_paths_tie_order_only"] == counts["report_paths_different"]
    assert gates_of(completed)["report_paths_equal"] == "PASS"


def test_an_old_report_whose_sort_values_differ_still_fails(tmp_path, tied_statement):
    # F-TIED ties every one of the ten largest purchases, so an untied swap is made by changing
    # one amount: the sort values then differ position by position.
    def swap_untied(report):
        report["spending"]["largest_purchases"][0]["amount"] += 1.0

    completed = compare_tied(tmp_path, tied_statement, swap_untied)
    assert counts_of(completed)["report_paths_tie_order_only"] == "0"
    assert gates_of(completed)["report_paths_equal"] == "FAIL"


def test_an_old_closing_balance_from_another_row_at_the_tied_latest_time_is_tie_order_only(
    tmp_path, tied_statement
):
    _, rows = tied_statement
    latest = max(row["completion_time"] for row in rows)
    tied_balances = {row["balance"] for row in rows if row["completion_time"] == latest}

    def change(report):
        current = report["cash_flow"]["closing_balance"]
        other = next(
            float(balance.replace(",", ""))
            for balance in sorted(tied_balances)
            if float(balance.replace(",", "")) != current
        )
        report["cash_flow"]["closing_balance"] = other

    completed = compare_tied(tmp_path, tied_statement, change)
    counts = counts_of(completed)
    assert counts["report_tie_order_only cash_flow.closing_balance"] == "1"
    assert gates_of(completed)["report_paths_equal"] == "PASS"
