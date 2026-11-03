import shutil
import subprocess
import sys

import pytest

from conftest import REPO, plant

SKIPPED = "import pytest\n\n\n@pytest.mark.skip\ndef test_later():\n    pass\n"
XFAILED = "import pytest\n\n\n@pytest.mark.xfail\ndef test_later():\n    assert False\n"
MODULE_SKIP = "import pytest\n\npytest.skip('later', allow_module_level=True)\n"
PASSING = "def test_now():\n    pass\n"
ENTRY = '[[skip]]\ntest = "test_planted.py::test_later"\nreason = "Needs a later checkpoint."\n'


def run_planted(root, source, allowlist=""):
    tests = root / "tests"
    tests.mkdir()
    shutil.copy(REPO / "tests" / "conftest.py", tests / "conftest.py")
    plant(root, "tests/skip_allowlist.toml", allowlist)
    plant(root, "tests/core/test_planted.py", source)
    return subprocess.run(
        [
            sys.executable,
            "-m",
            "pytest",
            "tests/core",
            "-q",
            "-p",
            "no:cacheprovider",
            "--import-mode=importlib",
            "--rootdir",
            str(root),
        ],
        cwd=root,
        capture_output=True,
        text=True,
    )


def test_passing_tests_pass(tmp_path):
    assert run_planted(tmp_path, PASSING).returncode == 0


@pytest.mark.parametrize("source", [SKIPPED, XFAILED, MODULE_SKIP], ids=["skip", "xfail", "module"])
def test_a_skip_not_on_the_allowlist_fails_the_run(tmp_path, source):
    completed = run_planted(tmp_path, source)
    assert completed.returncode != 0
    assert "not on the skip allowlist" in completed.stdout


def test_an_allowlisted_skip_with_a_reason_passes(tmp_path):
    completed = run_planted(tmp_path, SKIPPED, ENTRY)
    assert completed.returncode == 0, completed.stdout


@pytest.mark.parametrize(
    "entry",
    [
        '[[skip]]\ntest = "test_planted.py::test_later"\nreason = "  "\n',
        '[[skip]]\ntest = "test_planted.py::test_later"\n',
    ],
    ids=["blank-reason", "no-reason"],
)
def test_an_allowlist_entry_without_a_reason_fails_the_run(tmp_path, entry):
    completed = run_planted(tmp_path, SKIPPED, entry)
    assert completed.returncode != 0


def test_an_allowlist_entry_for_another_test_does_not_help(tmp_path):
    other = ENTRY.replace("test_later", "test_other")
    assert run_planted(tmp_path, SKIPPED, other).returncode != 0


def test_a_failing_test_still_fails_with_an_allowlist_present(tmp_path):
    source = "def test_now():\n    assert False\n"
    assert run_planted(tmp_path, source, ENTRY).returncode != 0


def test_the_real_allowlist_is_empty_or_reasoned():
    import tomllib

    entries = tomllib.loads((REPO / "tests" / "skip_allowlist.toml").read_text())
    assert all(entry["reason"].strip() for entry in entries.get("skip", []))
