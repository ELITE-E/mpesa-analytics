import json
import os
import pty
import select
import stat
import subprocess
import time

import pytest

from conftest import REPO
from run_node_tool import PINNED_NODE, resolve_node
from synth.generate import FAKE_PASSWORD

TOOL = REPO / "tools" / "pdf_readers" / "extract_pages_cli.mjs"
FIXTURES = REPO / "tests" / "fixtures" / "synthetic"
GOLDEN = FIXTURES / "F-GOLDEN.pdf"
ENCRYPTED = FIXTURES / "F-ENCRYPTED.pdf"
NODE = resolve_node(PINNED_NODE, os.environ.get("PATH", ""))
CANNOT_RUN = 2
OWNER_ONLY = 0o600
PROMPT_TEXT = b"PDF password"
TERMINAL_TIMEOUT_SECONDS = 120


def run_tool(*args, typed=None):
    return subprocess.run(
        [NODE, str(TOOL), *map(str, args)],
        capture_output=True,
        text=True,
        input="" if typed is None else f"{typed}\n",
    )


def recorded_text(name):
    return (FIXTURES / f"{name}.items.json").read_text(encoding="utf-8")


def mode_of(path):
    return stat.S_IMODE(path.stat().st_mode)


def read_until(terminal, marker):
    output = b""
    deadline = time.monotonic() + TERMINAL_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        ready, _, _ = select.select([terminal], [], [], 1)
        if not ready:
            continue
        try:
            chunk = os.read(terminal, 4096)
        except OSError:
            return output
        if not chunk:
            return output
        output += chunk
        if marker and marker in output:
            return output
    return output


def test_writes_the_same_statement_pages_as_the_recording(tmp_path):
    out = tmp_path / "pages.json"
    completed = run_tool(GOLDEN, "--out", out)
    assert completed.returncode == 0, completed.stdout + completed.stderr
    assert out.read_text(encoding="utf-8") == recorded_text("F-GOLDEN")


def test_output_file_is_readable_by_the_owner_only(tmp_path):
    out = tmp_path / "pages.json"
    run_tool(GOLDEN, "--out", out)
    assert mode_of(out) == OWNER_ONLY


def test_existing_output_file_with_loose_permissions_is_tightened(tmp_path):
    out = tmp_path / "pages.json"
    out.write_text("old")
    out.chmod(0o644)
    assert run_tool(GOLDEN, "--out", out).returncode == 0
    assert mode_of(out) == OWNER_ONLY
    assert json.loads(out.read_text(encoding="utf-8"))["pages"]


def test_prints_counts_only(tmp_path):
    out = tmp_path / "SECRETPATHMARKER.json"
    completed = run_tool(GOLDEN, "--out", out)
    output = completed.stdout + completed.stderr
    assert "SECRETPATHMARKER" not in output
    assert "ZZ" not in output
    assert "Example" not in output
    labels = dict(line.split(": ") for line in completed.stdout.strip().splitlines())
    assert set(labels) == {"pages", "items"}
    assert all(value.isdigit() for value in labels.values())


@pytest.mark.parametrize(
    "inside",
    [
        REPO / "planted-pages.json",
        REPO / "tools" / "planted-pages.json",
        REPO / "tools" / ".." / "planted-pages.json",
    ],
    ids=["root", "nested", "dotdot"],
)
def test_refuses_an_output_inside_the_repo(inside):
    completed = run_tool(GOLDEN, "--out", inside)
    assert completed.returncode == CANNOT_RUN
    assert "ERROR" in completed.stdout
    assert not inside.exists()


def test_refuses_a_relative_output_that_lands_inside_the_repo():
    completed = subprocess.run(
        [NODE, str(TOOL), str(GOLDEN), "--out", "planted-pages.json"],
        capture_output=True,
        text=True,
        input="",
        cwd=REPO,
    )
    assert completed.returncode == CANNOT_RUN
    assert not (REPO / "planted-pages.json").exists()


def test_refuses_a_directory_link_that_leads_into_the_repo(tmp_path):
    link = tmp_path / "link"
    link.symlink_to(REPO, target_is_directory=True)
    completed = run_tool(GOLDEN, "--out", link / "planted-pages.json")
    assert completed.returncode == CANNOT_RUN
    assert not (REPO / "planted-pages.json").exists()


def test_refuses_a_file_link_that_leads_into_the_repo(tmp_path):
    link = tmp_path / "link.json"
    link.symlink_to(REPO / "planted-pages.json")
    completed = run_tool(GOLDEN, "--out", link)
    assert completed.returncode == CANNOT_RUN
    assert not (REPO / "planted-pages.json").exists()


def test_requires_an_output(tmp_path):
    assert run_tool(GOLDEN).returncode == CANNOT_RUN


@pytest.mark.parametrize(
    "option", ["--password", "--password=x", "--password-env", "--pass"], ids=str
)
def test_password_options_are_rejected(tmp_path, option):
    completed = run_tool(ENCRYPTED, "--out", tmp_path / "pages.json", option, "secret")
    assert completed.returncode == CANNOT_RUN
    assert "secret" not in completed.stdout + completed.stderr
    assert not (tmp_path / "pages.json").exists()


def test_encrypted_pdf_opens_with_the_password_on_stdin(tmp_path):
    out = tmp_path / "pages.json"
    completed = run_tool(ENCRYPTED, "--out", out, typed=FAKE_PASSWORD)
    assert completed.returncode == 0, completed.stdout + completed.stderr
    assert out.read_text(encoding="utf-8") == recorded_text("F-ENCRYPTED")
    assert FAKE_PASSWORD not in completed.stdout + completed.stderr


def test_encrypted_pdf_opens_with_a_hidden_prompt_on_a_terminal(tmp_path):
    out = tmp_path / "pages.json"
    pid, terminal = pty.fork()
    if pid == 0:
        os.execv(NODE, [NODE, str(TOOL), str(ENCRYPTED), "--out", str(out)])
    output = read_until(terminal, PROMPT_TEXT)
    os.write(terminal, f"{FAKE_PASSWORD}\r".encode())
    output += read_until(terminal, None)
    os.close(terminal)
    _, status = os.waitpid(pid, 0)
    assert os.waitstatus_to_exitcode(status) == 0
    assert PROMPT_TEXT in output
    assert FAKE_PASSWORD.encode() not in output
    assert out.read_text(encoding="utf-8") == recorded_text("F-ENCRYPTED")


def test_wrong_password_reports_only_a_code(tmp_path):
    out = tmp_path / "pages.json"
    completed = run_tool(ENCRYPTED, "--out", out, typed="wrong-one")
    assert completed.returncode == CANNOT_RUN
    assert "PASSWORD_INCORRECT" in completed.stdout
    assert "wrong-one" not in completed.stdout + completed.stderr
    assert not out.exists()


def test_a_file_that_is_not_a_pdf_reports_only_a_code(tmp_path):
    source = tmp_path / "SECRETPATHMARKER.pdf"
    source.write_text("PLANTEDCONTENT")
    completed = run_tool(source, "--out", tmp_path / "pages.json")
    assert completed.returncode == CANNOT_RUN
    assert "NOT_A_PDF" in completed.stdout
    output = completed.stdout + completed.stderr
    assert "SECRETPATHMARKER" not in output
    assert "PLANTEDCONTENT" not in output


def test_a_missing_file_does_not_repeat_its_path(tmp_path):
    completed = run_tool(tmp_path / "SECRETPATHMARKER.pdf", "--out", tmp_path / "pages.json")
    assert completed.returncode == CANNOT_RUN
    assert "SECRETPATHMARKER" not in completed.stdout + completed.stderr


def test_statement_above_the_app_page_limit_still_extracts(tmp_path):
    out = tmp_path / "pages.json"
    completed = run_tool(FIXTURES / "F-MANY-PAGES.pdf", "--out", out)
    assert completed.returncode == 0, completed.stdout
    assert out.read_text(encoding="utf-8") == recorded_text("F-MANY-PAGES")
