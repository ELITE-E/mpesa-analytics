import os
import re
import shutil
import subprocess
import sys

import pytest

from conftest import REPO, plant
from run_node_tool import PINNED_NODE, resolve_node
from vendor import PINS, PYODIDE_VERSION, VENDOR

RUNNER = REPO / "tools" / "run_pyodide_tests.mjs"
PASSING = "import mpesa_core\n\n\ndef test_core_is_available():\n    assert mpesa_core\n"
FAILING = "def test_broken():\n    assert False\n"
SKIPPED = "import pytest\n\n\n@pytest.mark.skip\ndef test_later():\n    pass\n"
ALLOW = '[[skip]]\ntest = "test_planted.py::test_later"\nreason = "Needs a later checkpoint."\n'


@pytest.fixture(scope="module")
def wheel(tmp_path_factory):
    out_dir = tmp_path_factory.mktemp("wheel")
    subprocess.run(
        ["uv", "build", "--wheel", "--out-dir", str(out_dir), "--quiet"], cwd=REPO, check=True
    )
    return next(out_dir.glob("*.whl"))


def run_runner(*args):
    node = resolve_node(PINNED_NODE, os.environ.get("PATH", ""))
    return subprocess.run(
        [node, str(RUNNER), *map(str, args)], capture_output=True, text=True, cwd=REPO
    )


def planted_tests(root, source, allowlist=""):
    tests = root / "tests"
    tests.mkdir()
    shutil.copy(REPO / "tests" / "conftest.py", tests / "conftest.py")
    plant(root, "tests/skip_allowlist.toml", allowlist)
    plant(root, "tests/core/test_planted.py", source)
    return tests / "core"


def cpython_core_test_count():
    completed = subprocess.run(
        [sys.executable, "-m", "pytest", "tests/core", "--collect-only", "-q"],
        cwd=REPO,
        capture_output=True,
        text=True,
    )
    return int(re.search(r"(\d+) tests? collected", completed.stdout).group(1))


def test_core_tests_pass_under_the_pinned_pyodide_from_the_wheel(wheel):
    completed = run_runner("--wheel", wheel)
    assert completed.returncode == 0, completed.stdout[-2000:] + completed.stderr[-2000:]
    summary = completed.stdout.strip().splitlines()[-1]
    assert f"pyodide={PYODIDE_VERSION}" in summary
    assert "core=wheel" in summary
    assert int(re.search(r"tests=(\d+)", summary).group(1)) == cpython_core_test_count()
    assert "skipped=0" in summary


def test_a_failing_test_fails_the_runner(wheel, tmp_path):
    completed = run_runner("--wheel", wheel, "--tests", planted_tests(tmp_path, FAILING))
    assert completed.returncode != 0


def test_a_skip_off_the_allowlist_fails_the_runner(wheel, tmp_path):
    completed = run_runner("--wheel", wheel, "--tests", planted_tests(tmp_path, SKIPPED))
    assert completed.returncode != 0
    assert "not on the skip allowlist" in completed.stdout


def test_an_allowlisted_skip_passes_the_runner(wheel, tmp_path):
    tests = planted_tests(tmp_path, SKIPPED, ALLOW)
    completed = run_runner("--wheel", wheel, "--tests", tests)
    assert completed.returncode == 0, completed.stdout[-2000:] + completed.stderr[-2000:]
    assert "skipped=1" in completed.stdout


def test_no_tests_at_all_fails_the_runner(wheel, tmp_path):
    tests = planted_tests(tmp_path, PASSING)
    (tests / "test_planted.py").unlink()
    assert run_runner("--wheel", wheel, "--tests", tests).returncode != 0


def test_a_missing_wheel_fails_the_runner(tmp_path):
    assert run_runner("--wheel", tmp_path / "absent.whl").returncode != 0


def test_runner_packages_are_pinned_and_vendored():
    for rel in (rel for rel in PINS if "pytest-" in rel):
        assert (VENDOR / rel).is_file()
    assert any("pytest-" in rel for rel in PINS)


def test_ci_builds_the_wheel_before_running_the_core_tests():
    ci = (REPO / ".github/workflows/ci.yml").read_text(encoding="utf-8")
    assert ci.index("uv build --wheel") < ci.index("run_pyodide_tests.mjs")
