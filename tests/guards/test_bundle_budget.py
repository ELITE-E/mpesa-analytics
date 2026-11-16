"""tools/measure_bundle.py: the download budget, enforced on the runtime the browser loads (CP8a-2).

Budgets from ADR 0006: 15 MB gzip with pandas, 8 MB without. Measured over the built runtime's
files, gzip -9, so what is counted is exactly what ships.
"""

import subprocess
import sys

import pytest

from conftest import REPO
from measure_bundle import (
    BUDGET_WITH_PANDAS,
    BUDGET_WITHOUT_PANDAS,
    is_analysis_file,
    measure_runtime,
)
from vendor import build_runtime

TOOL = REPO / "tools" / "measure_bundle.py"


@pytest.fixture(scope="module")
def runtime_root(tmp_path_factory, built_wheel):
    root = tmp_path_factory.mktemp("runtime")
    build_runtime(built_wheel, runtime_root=root)
    return root


def run_tool(runtime_root, *options):
    return subprocess.run(
        [sys.executable, str(TOOL), "--runtime", str(runtime_root), *options],
        capture_output=True,
        text=True,
        check=False,
    )


def test_the_budgets_are_15_mb_with_pandas_and_8_mb_without():
    assert BUDGET_WITH_PANDAS == 15_000_000
    assert BUDGET_WITHOUT_PANDAS == 8_000_000


def test_the_analysis_files_are_numpy_pandas_and_its_dependencies():
    for path in (
        "pyodide/numpy-2.4.6-cp314-cp314-pyemscripten_2026_0_wasm32.whl",
        "pyodide/pandas-3.0.2-cp314-cp314-pyemscripten_2026_0_wasm32.whl",
        "pyodide/python_dateutil-2.9.0.post0-py2.py3-none-any.whl",
        "pyodide/pytz-2026.1.post1-py2.py3-none-any.whl",
        "pyodide/six-1.17.0-py2.py3-none-any.whl",
    ):
        assert is_analysis_file(path), path
    for path in (
        "pyodide/pyodide.asm.wasm",
        "pdfjs/pdf.min.mjs",
        "core/mpesa_core-0.0.0-py3-none-any.whl",
    ):
        assert not is_analysis_file(path), path


def test_the_shipped_runtime_is_within_both_budgets(runtime_root):
    totals = measure_runtime(runtime_root)
    assert 0 < totals["without_pandas_gzip"] < totals["with_pandas_gzip"]
    assert totals["with_pandas_gzip"] <= BUDGET_WITH_PANDAS
    assert totals["without_pandas_gzip"] <= BUDGET_WITHOUT_PANDAS


def test_the_tool_passes_and_prints_counts_within_budget(runtime_root):
    completed = run_tool(runtime_root)
    assert completed.returncode == 0, completed.stdout
    assert "bundle_budget: PASS" in completed.stdout
    assert "NOT ENFORCED" not in completed.stdout


@pytest.mark.parametrize("option", ["--with-pandas-budget", "--without-pandas-budget"])
def test_the_tool_fails_when_a_budget_is_exceeded(runtime_root, option):
    completed = run_tool(runtime_root, option, "1")
    assert completed.returncode == 1
    assert "bundle_budget: FAIL" in completed.stdout


def test_ci_enforces_the_budget_after_building_the_runtime():
    ci = (REPO / ".github/workflows/ci.yml").read_text(encoding="utf-8")
    assert "tools/measure_bundle.py" in ci
    assert ci.index("tools/vendor.py runtime --wheel") < ci.index("tools/measure_bundle.py")
