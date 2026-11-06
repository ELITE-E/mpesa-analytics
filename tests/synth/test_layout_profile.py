import ast
import json
import os
import pty
import re
import select
import subprocess
import sys
import time
import tomllib

import pytest

from conftest import REPO
from synth.layout import COLUMNS, lay_out_statement
from synth.render import render_pdf

PROFILER = REPO / "tools" / "equivalence" / "layout_profile.py"
FIXTURES = REPO / "tests" / "fixtures" / "synthetic"
GOLDEN = FIXTURES / "F-GOLDEN.pdf"
MARKER = "PLANTEDMARKERTEXT"
OUTPUT_LINE = re.compile(r"^[a-z0-9_]+: [-0-9., x:{}\[\]]*$")
PROMPT_TEXT = b"PDF password"
TERMINAL_TIMEOUT_SECONDS = 120
ENCRYPTED = FIXTURES / "F-ENCRYPTED.pdf"
RECORD = REPO / "docs" / "decisions" / "0008-layout-profile-synthetic.md"


def run_profiler(*args, env=None, typed=None):
    # Without typed input, stdin is empty, so a prompt can never wait for the test runner.
    return subprocess.run(
        [sys.executable, str(PROFILER), *map(str, args)],
        capture_output=True,
        text=True,
        env={**os.environ, **(env or {})},
        input="" if typed is None else f"{typed}\n",
    )


def fake_password():
    manifest = tomllib.loads((FIXTURES / "MANIFEST.toml").read_text(encoding="utf-8"))
    return manifest["fake_password"]


def run_on_a_terminal(path, typed):
    """Run the profiler on a real pseudo-terminal and type at its prompt."""
    pid, terminal = pty.fork()
    if pid == 0:
        os.execv(sys.executable, [sys.executable, str(PROFILER), str(path)])
    output = read_terminal_until(terminal, PROMPT_TEXT)
    os.write(terminal, f"{typed}\n".encode())
    output += read_terminal_until(terminal, None)
    os.close(terminal)
    _, status = os.waitpid(pid, 0)
    return os.waitstatus_to_exitcode(status), output.decode()


def read_terminal_until(terminal, wanted):
    output = b""
    deadline = time.monotonic() + TERMINAL_TIMEOUT_SECONDS
    while time.monotonic() < deadline and (wanted is None or wanted not in output):
        ready, _, _ = select.select([terminal], [], [], 1.0)
        if not ready:
            continue
        try:
            chunk = os.read(terminal, 4096)
        except OSError:
            break
        if not chunk:
            break
        output += chunk
    assert wanted is None or wanted in output, "the prompt never appeared"
    return output


def profile_of(path, *args, env=None):
    completed = run_profiler(path, *args, env=env)
    assert completed.returncode == 0, completed.stderr[-500:]
    return dict(line.split(": ", 1) for line in completed.stdout.strip().splitlines())


def expected_for(name):
    return json.loads((FIXTURES / f"{name}.expected.json").read_text(encoding="utf-8"))


def planted_row(details):
    labels = [column.label for column in COLUMNS]
    values = ["ZZ" + "AB12CD34", "2026-01-01 08:00:00", details, MARKER, None, "1.00", "2.00"]
    return dict(zip(labels, values, strict=True))


@pytest.fixture
def planted_pdf(tmp_path):
    rows = [planted_row(f"{MARKER} wraps across {MARKER} several {MARKER} lines {MARKER}")] * 5
    summary = (("Customer Name", MARKER), (MARKER, "1"))
    pages, _ = lay_out_statement(rows, summary, seed_text="profile", split_datetime=False)
    path = tmp_path / f"{MARKER}.pdf"
    path.write_bytes(render_pdf(pages))
    return path


def test_planted_marker_never_appears_in_the_output(planted_pdf):
    completed = run_profiler(planted_pdf)
    assert completed.returncode == 0, completed.stderr[-500:]
    assert MARKER not in completed.stdout
    assert MARKER not in completed.stderr
    assert completed.stdout.strip()


def test_output_is_numbers_and_fixed_labels_only(planted_pdf):
    for line in run_profiler(planted_pdf).stdout.strip().splitlines():
        assert OUTPUT_LINE.match(line)


def test_golden_output_is_numbers_and_fixed_labels_only():
    completed = run_profiler(GOLDEN)
    assert completed.stdout.strip()
    for line in completed.stdout.strip().splitlines():
        assert OUTPUT_LINE.match(line)
    for row in expected_for("F-GOLDEN")["rows"][:10]:
        assert row["receipt_no"] not in completed.stdout


def test_page_count_and_size_are_reported():
    profile = profile_of(GOLDEN)
    pages = {row["page"] for row in expected_for("F-GOLDEN")["rows"]}
    assert profile["page_count"] == str(max(pages))
    assert profile["page_size"] == "595 x 848"


def test_line_pitch_median_and_spread_are_reported():
    profile = profile_of(GOLDEN)
    assert float(profile["line_pitch_median"]) in (6.0, 10.0)
    assert float(profile["line_pitch_spread"]) >= 0


def test_anchor_rows_match_the_ledger():
    expected = expected_for("F-GOLDEN")
    assert profile_of(GOLDEN)["anchor_row_count"] == str(expected["row_count"])


def test_receipt_length_histogram_counts_every_anchor():
    expected = expected_for("F-GOLDEN")
    assert profile_of(GOLDEN)["receipt_length_histogram"] == f"{{10: {expected['row_count']}}}"


def test_multi_line_share_matches_the_layout_model():
    model = json.loads((FIXTURES / "F-GOLDEN.items.json").read_text(encoding="utf-8"))
    expected = expected_for("F-GOLDEN")
    column = COLUMNS[2]
    lines = 0
    for page in model["pages"]:
        tops = {
            text_item["top"]
            for text_item in page["items"]
            if column.x0 <= text_item["x0"]
            and text_item["x1"] <= column.x1
            and text_item["top"] < 810
            and text_item["text"] != column.label
        }
        lines += len(tops)
    wrapped_lines = lines - expected["row_count"]
    assert wrapped_lines > 0
    share = float(profile_of(GOLDEN)["multi_line_row_share"])
    assert 0 < share < 1
    assert share * expected["row_count"] <= wrapped_lines


def test_header_to_data_offset_is_within_the_generators_limit():
    profile = profile_of(GOLDEN)
    assert 30 <= float(profile["header_to_data_x0_offset_max"]) <= 38.5
    assert len(profile["header_to_data_x0_offset_by_column"].split(", ")) == 7


def test_column_clusters_find_the_left_edges_and_right_edges():
    profile = profile_of(GOLDEN)
    left_edges = [float(edge) for edge in profile["column_x0_clusters"].strip("[]").split(", ")]
    right_edges = [float(edge) for edge in profile["column_x1_clusters"].strip("[]").split(", ")]
    assert any(abs(edge - COLUMNS[0].text_x0) <= 1.0 for edge in left_edges)
    assert any(abs(edge - COLUMNS[6].text_x1) <= 1.0 for edge in right_edges)


def test_split_datetime_is_still_anchored():
    expected = expected_for("F-SPLIT")
    profile = profile_of(FIXTURES / "F-SPLIT.pdf")
    assert profile["anchor_row_count"] == str(expected["row_count"])


def test_encrypted_pdf_profiles_correctly_with_the_password_on_stdin():
    completed = run_profiler(ENCRYPTED, typed=fake_password())
    assert completed.returncode == 0, completed.stdout + completed.stderr[-500:]
    profile = dict(line.split(": ", 1) for line in completed.stdout.strip().splitlines())
    expected = expected_for("F-ENCRYPTED")
    assert profile["anchor_row_count"] == str(expected["row_count"])
    assert profile["receipt_length_histogram"] == f"{{10: {expected['row_count']}}}"
    assert profile["page_size"] == "595 x 848"


def test_password_on_stdin_never_appears_in_the_output():
    completed = run_profiler(ENCRYPTED, typed=fake_password())
    assert completed.returncode == 0
    assert fake_password() not in completed.stdout + completed.stderr


def test_prompt_goes_to_stderr_and_stdout_stays_numbers_only():
    completed = run_profiler(ENCRYPTED, typed=fake_password())
    assert PROMPT_TEXT.decode() in completed.stderr
    for line in completed.stdout.strip().splitlines():
        assert OUTPUT_LINE.match(line)


def test_password_typed_on_a_terminal_is_hidden_and_works():
    exit_code, output = run_on_a_terminal(ENCRYPTED, fake_password())
    assert exit_code == 0, output[-500:]
    assert fake_password() not in output
    assert f"anchor_row_count: {expected_for('F-ENCRYPTED')['row_count']}" in output


def test_wrong_password_on_a_terminal_stops_without_echoing_it():
    typed = "not-the-" + "right-value"
    exit_code, output = run_on_a_terminal(ENCRYPTED, typed)
    assert exit_code == 2
    assert "layout_profile: ERROR" in output
    assert typed not in output


def test_wrong_password_on_stdin_stops_without_echoing_it():
    typed = "not-the-" + "right-value"
    completed = run_profiler(ENCRYPTED, typed=typed)
    assert completed.returncode == 2
    assert "layout_profile: ERROR" in completed.stdout
    assert "anchor_row_count" not in completed.stdout
    assert typed not in completed.stdout + completed.stderr


def test_no_password_given_stops_without_printing_text():
    completed = run_profiler(ENCRYPTED)
    assert completed.returncode == 2
    assert "layout_profile: ERROR" in completed.stdout
    assert PROMPT_TEXT.decode() in completed.stderr
    assert "F-ENCRYPTED" not in completed.stdout + completed.stderr


def test_a_pdf_with_no_password_never_prompts():
    completed = run_profiler(GOLDEN, typed="this-is-never-read")
    assert completed.returncode == 0
    assert PROMPT_TEXT.decode() not in completed.stderr


def test_a_file_that_is_not_a_pdf_never_prompts(tmp_path):
    path = tmp_path / "plain.pdf"
    path.write_text("not a PDF", encoding="utf-8")
    completed = run_profiler(path, typed="this-is-never-read")
    assert completed.returncode == 2
    assert PROMPT_TEXT.decode() not in completed.stderr


@pytest.mark.parametrize(
    "arguments",
    [
        ("--password", "x"),
        ("--password=x",),
        ("--password-env", "PROFILE_PASSWORD"),
        ("--pass", "x"),
    ],
    ids=["password", "password-equals", "password-env", "abbreviated"],
)
def test_password_options_are_rejected_on_the_command_line(arguments):
    completed = run_profiler(ENCRYPTED, *arguments, typed=fake_password())
    assert completed.returncode == 2
    assert "anchor_row_count" not in completed.stdout
    assert "unrecognized arguments" in completed.stderr


@pytest.mark.parametrize("variable", ["PROFILE_PASSWORD", "PDF_PASSWORD", "PASSWORD"])
def test_a_password_in_the_environment_is_ignored(variable):
    completed = run_profiler(ENCRYPTED, env={variable: fake_password()})
    assert completed.returncode == 2
    assert "anchor_row_count" not in completed.stdout


def test_the_tool_never_touches_the_environment():
    tree = ast.parse(PROFILER.read_bytes())
    modules = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            modules.update(alias.name for alias in node.names)
    attributes = {node.attr for node in ast.walk(tree) if isinstance(node, ast.Attribute)}
    assert "os" not in modules
    assert not attributes & {"environ", "getenv"}


def test_a_file_that_is_not_a_pdf_stops_without_echoing_it(tmp_path):
    path = tmp_path / f"{MARKER}.pdf"
    path.write_text(f"{MARKER} is not a PDF", encoding="utf-8")
    completed = run_profiler(path)
    assert completed.returncode == 2
    assert "layout_profile: ERROR" in completed.stdout
    assert MARKER not in completed.stdout + completed.stderr


def test_a_missing_file_stops_without_echoing_its_name(tmp_path):
    completed = run_profiler(tmp_path / f"{MARKER}.pdf")
    assert completed.returncode == 2
    assert "layout_profile: ERROR" in completed.stdout
    assert MARKER not in completed.stdout + completed.stderr


def test_decision_record_holds_the_current_golden_output():
    assert run_profiler(GOLDEN).stdout.strip() in RECORD.read_text(encoding="utf-8")
