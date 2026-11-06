import json
import os
import re
import subprocess
import sys

import pytest

from conftest import REPO
from synth.generate import FAKE_PASSWORD
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


def write_baseline(tmp_path, rows):
    path = tmp_path / f"{PATH_MARKER}.json"
    path.write_text(json.dumps({"rows": rows}), encoding="utf-8")
    return path


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

    completed = compare_fixture(tmp_path, "F-GOLDEN", change)
    assert completed.returncode == 0, completed.stdout
    assert all(counts_of(completed)[f"mismatch_{field}"] == "0" for field in SEVEN_FIELDS)


def test_details_mismatch_is_counted_but_is_not_a_gate(tmp_path):
    def change(rows):
        rows[0]["details"] = "something else"

    completed = compare_fixture(tmp_path, "F-GOLDEN", change)
    assert counts_of(completed)["mismatch_details"] == "1"
    assert completed.returncode == 0


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
    assert gates_of(completed)["status_mismatches"] == "PASS"
    assert completed.returncode == 0


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
    wrapped_inside_a_page = next(
        position
        for position, row in enumerate(rows)
        if is_multi_line(row)
        and rows[position - 1]["page"] == row["page"] == 1
        and rows[position + 1]["page"] == row["page"]
        and position > 0
    )
    single_line_last_on_a_later_page = next(
        position
        for position, row in enumerate(rows[:-1])
        if not is_multi_line(row) and row["page"] > 1 and rows[position + 1]["page"] != row["page"]
    )

    def change(baseline):
        baseline[wrapped_inside_a_page]["details"] = "changed"
        baseline[single_line_last_on_a_later_page]["paid_in"] = "1.00"

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


def test_summary_reconciliation_is_reported_per_label(tmp_path):
    counts = counts_of(compare_fixture(tmp_path, "F-SUMMARY-MISMATCH"))
    assert counts["summary_new_total_paid_in"] == "false"
    assert counts["summary_new_closing_balance"] == "false"
    assert counts["summary_new_total_withdrawn"] == "true"
    assert counts["summary_old_total_paid_in"] == "false"


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
