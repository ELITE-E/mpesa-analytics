"""Skip policy: a skipped test fails the run unless the allowlist gives a reason.

This runs under CPython and Pyodide, so neither can hide a test the other runs.
"""

import tomllib
from pathlib import Path

ALLOWLIST_PATH = Path(__file__).with_name("skip_allowlist.toml")
_skipped_ids = []
_unexplained_ids = []


def pytest_runtest_logreport(report):
    if report.skipped:
        _skipped_ids.append(report.nodeid)


def pytest_collectreport(report):
    if report.skipped:
        _skipped_ids.append(report.nodeid)


def pytest_sessionfinish(session):
    allowed = _reasoned_entries()
    _unexplained_ids.extend(
        nodeid for nodeid in _skipped_ids if _allowlist_key(nodeid) not in allowed
    )
    if _unexplained_ids:
        session.exitstatus = 1


def pytest_terminal_summary(terminalreporter):
    if _unexplained_ids:
        terminalreporter.write_line(
            f"{len(_unexplained_ids)} skipped test(s) not on the skip allowlist:"
        )
        for nodeid in _unexplained_ids:
            terminalreporter.write_line(f"  {nodeid}")


def _reasoned_entries():
    entries = tomllib.loads(ALLOWLIST_PATH.read_text(encoding="utf-8")).get("skip", [])
    return {entry["test"] for entry in entries if entry.get("reason", "").strip()}


def _allowlist_key(nodeid):
    # The root differs between CPython and Pyodide, so entries name the file, not its path.
    path, _, test = nodeid.partition("::")
    return f"{Path(path).name}::{test}"
