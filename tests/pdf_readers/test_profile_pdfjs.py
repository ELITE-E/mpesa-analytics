import json
import os
import pty
import re
import select
import subprocess
import time
import tomllib

import pytest

from conftest import REPO
from run_node_tool import PINNED_NODE, resolve_node
from synth.layout import COLUMNS, lay_out_statement
from synth.render import render_pdf

TOOL = REPO / "tools" / "pdf_readers" / "profile_pdfjs.mjs"
FIXTURES = REPO / "tests" / "fixtures" / "synthetic"
ENCRYPTED = FIXTURES / "F-ENCRYPTED.pdf"
GOLDEN = FIXTURES / "F-GOLDEN.pdf"
SPLIT = FIXTURES / "F-SPLIT.pdf"
MARKER = "PLANTEDMARKERTEXT"
PROMPT_TEXT = b"PDF password"
OUTPUT_LINE = re.compile(r"^[a-z_]+: [0-9.]+$")
TERMINAL_TIMEOUT_SECONDS = 120
LABELS = {
    "page_count",
    "item_count",
    "elapsed_seconds",
    "whitespace_only_items",
    "whitespace_only_share",
    "anchor_lines",
    "date_time_one_item_share",
    "date_time_two_items_share",
}
NODE = resolve_node(PINNED_NODE, os.environ.get("PATH", ""))


def run_tool(*args, typed=None, env=None):
    return subprocess.run(
        [NODE, str(TOOL), *map(str, args)],
        capture_output=True,
        text=True,
        input="" if typed is None else f"{typed}\n",
        env={**os.environ, **(env or {})},
    )


def profile_of(completed):
    assert completed.returncode == 0, completed.stdout + completed.stderr[-500:]
    return dict(line.split(": ", 1) for line in completed.stdout.strip().splitlines())


def fake_password():
    manifest = tomllib.loads((FIXTURES / "MANIFEST.toml").read_text(encoding="utf-8"))
    return manifest["fake_password"]


def recorded(name):
    return json.loads((FIXTURES / f"{name}.items.json").read_text(encoding="utf-8"))


def expected(name):
    return json.loads((FIXTURES / f"{name}.expected.json").read_text(encoding="utf-8"))


def all_items(statement_pages):
    return [entry for page in statement_pages["pages"] for entry in page["items"]]


def run_on_a_terminal(path, typed):
    pid, terminal = pty.fork()
    if pid == 0:
        os.execv(NODE, [NODE, str(TOOL), str(path)])
    output = read_until(terminal, PROMPT_TEXT)
    os.write(terminal, f"{typed}\r".encode())
    output += read_until(terminal, None)
    os.close(terminal)
    _, status = os.waitpid(pid, 0)
    return os.waitstatus_to_exitcode(status), output.decode()


def read_until(terminal, wanted):
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


@pytest.fixture
def planted_pdf(tmp_path):
    labels = [column.label for column in COLUMNS]
    values = ["ZZ" + "AB12CD34", "2026-01-01 08:00:00", MARKER, MARKER, None, "1.00", "2.00"]
    rows = [dict(zip(labels, values, strict=True))] * 3
    pages, _ = lay_out_statement(
        rows, (("Customer Name", MARKER),), seed_text="profile", split_datetime=False
    )
    path = tmp_path / f"{MARKER}.pdf"
    path.write_bytes(render_pdf(pages))
    return path


def test_output_has_exactly_the_agreed_labels():
    assert set(profile_of(run_tool(GOLDEN))) == LABELS


def test_counts_match_the_recorded_items():
    statement_pages = recorded("F-GOLDEN")
    items = all_items(statement_pages)
    whitespace = [entry for entry in items if not entry["text"].strip()]
    profile = profile_of(run_tool(GOLDEN))
    assert profile["page_count"] == str(len(statement_pages["pages"]))
    assert profile["item_count"] == str(len(items))
    assert profile["whitespace_only_items"] == str(len(whitespace))
    assert float(profile["whitespace_only_share"]) == pytest.approx(
        len(whitespace) / len(items), abs=0.001
    )


def test_elapsed_seconds_is_a_positive_number():
    assert float(profile_of(run_tool(GOLDEN))["elapsed_seconds"]) > 0


def test_one_string_dates_are_counted_as_one_item():
    profile = profile_of(run_tool(GOLDEN))
    assert profile["anchor_lines"] == str(expected("F-GOLDEN")["row_count"])
    assert float(profile["date_time_one_item_share"]) == 1
    assert float(profile["date_time_two_items_share"]) == 0


def test_split_dates_are_counted_as_two_items():
    profile = profile_of(run_tool(SPLIT))
    assert profile["anchor_lines"] == str(expected("F-SPLIT")["row_count"])
    assert float(profile["date_time_one_item_share"]) == 0
    assert float(profile["date_time_two_items_share"]) == 1


def test_encrypted_fixture_profiles_with_the_password_on_stdin():
    completed = run_tool(ENCRYPTED, typed=fake_password())
    profile = profile_of(completed)
    assert profile["page_count"] == str(len(recorded("F-ENCRYPTED")["pages"]))
    assert profile["item_count"] == str(len(all_items(recorded("F-ENCRYPTED"))))
    assert fake_password() not in completed.stdout + completed.stderr


def test_prompt_goes_to_stderr_only_when_needed():
    assert PROMPT_TEXT.decode() in run_tool(ENCRYPTED, typed=fake_password()).stderr
    assert PROMPT_TEXT.decode() not in run_tool(GOLDEN, typed="never-read").stderr


def test_password_typed_on_a_terminal_is_hidden_and_works():
    exit_code, output = run_on_a_terminal(ENCRYPTED, fake_password())
    assert exit_code == 0, output[-500:]
    assert fake_password() not in output
    assert f"page_count: {len(recorded('F-ENCRYPTED')['pages'])}" in output


def test_wrong_password_on_a_terminal_reports_a_code_and_hides_it():
    typed = "not-the-" + "right-value"
    exit_code, output = run_on_a_terminal(ENCRYPTED, typed)
    assert exit_code == 2
    assert "PASSWORD_INCORRECT" in output
    assert typed not in output


def test_missing_password_reports_a_code():
    completed = run_tool(ENCRYPTED)
    assert completed.returncode == 2
    assert "PASSWORD_REQUIRED" in completed.stdout


@pytest.mark.parametrize(
    "arguments",
    [("--password", "x"), ("--password=x",), ("--password-env", "X"), ("extra-argument",)],
    ids=["password", "equals", "env-option", "extra"],
)
def test_anything_beyond_the_path_is_rejected(arguments):
    completed = run_tool(ENCRYPTED, *arguments, typed=fake_password())
    assert completed.returncode == 2
    assert "item_count" not in completed.stdout


def test_a_password_in_the_environment_is_ignored():
    completed = run_tool(
        ENCRYPTED, env={"PDF_PASSWORD": fake_password(), "PASSWORD": fake_password()}
    )
    assert completed.returncode == 2


def test_the_tool_never_reads_the_environment():
    assert "process.env" not in TOOL.read_text(encoding="utf-8")


def test_planted_marker_never_appears(planted_pdf):
    completed = run_tool(planted_pdf)
    assert completed.returncode == 0, completed.stderr[-500:]
    assert MARKER not in completed.stdout + completed.stderr


def test_every_output_line_is_a_label_and_a_number(planted_pdf):
    completed = run_tool(planted_pdf)
    assert completed.stdout.strip()
    for line in completed.stdout.strip().splitlines():
        assert OUTPUT_LINE.match(line)


def test_a_file_that_is_not_a_pdf_reports_a_code_without_echoing(tmp_path):
    path = tmp_path / f"{MARKER}.pdf"
    path.write_text(f"{MARKER} is not a PDF", encoding="utf-8")
    completed = run_tool(path)
    assert completed.returncode == 2
    assert "NOT_A_PDF" in completed.stdout
    assert MARKER not in completed.stdout + completed.stderr


def test_a_missing_file_stops_without_echoing_its_name(tmp_path):
    completed = run_tool(tmp_path / f"{MARKER}.pdf")
    assert completed.returncode == 2
    assert "profile_pdfjs: ERROR" in completed.stdout
    assert MARKER not in completed.stdout + completed.stderr
