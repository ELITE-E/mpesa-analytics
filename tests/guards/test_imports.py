import shutil

import pytest

from conftest import REPO, assert_fails_quietly, plant, run_guard

GUARD = "check_imports.py"
EXTERNAL = [
    "fastapi",
    "sqlalchemy",
    "requests",
    "httpx",
    "urllib3",
    "pydantic",
    "streamlit",
    "pdfplumber",
    "pypdf",
]
PLANTED_MODULES = (
    "__init__",
    "contracts",
    "bridge",
    "extraction/__init__",
    "extraction/rows",
    "cleaning/__init__",
    "cleaning/normalize",
    "classification/__init__",
    "reconciliation/__init__",
    "errors",
    "pipeline",
    "types",
)


@pytest.fixture
def package(tmp_path):
    shutil.copy(REPO / ".importlinter", tmp_path / ".importlinter")
    for module in PLANTED_MODULES:
        plant(tmp_path, f"src/mpesa_core/{module}.py", "")
    plant(tmp_path, "src/mpesa_core/analysis/__init__.py", "")
    plant(tmp_path, "src/mpesa_core/analysis/summary.py", "")
    return tmp_path


def test_clean_package_passes(package):
    guard_run = run_guard(GUARD, "--root", package)
    assert guard_run.returncode == 0, guard_run.stdout + guard_run.stderr


@pytest.mark.parametrize("name", EXTERNAL)
def test_forbidden_external_import_fails(package, name):
    plant(package, "src/mpesa_core/contracts.py", f"import {name}\n")
    assert_fails_quietly(
        run_guard(GUARD, "--root", package), "src/mpesa_core/contracts.py", f"-> {name}"
    )


@pytest.mark.parametrize(
    "source",
    ["from mpesa_core import bridge\n", "from mpesa_core.extraction import rows\n"],
    ids=["bridge", "rows"],
)
def test_analysis_may_not_import(package, source):
    plant(package, "src/mpesa_core/analysis/summary.py", source)
    assert_fails_quietly(run_guard(GUARD, "--root", package), "src/mpesa_core/analysis/summary.py")


def test_analysis_may_not_import_bridge_indirectly(package):
    plant(package, "src/mpesa_core/cleaning/normalize.py", "from mpesa_core import bridge\n")
    plant(
        package, "src/mpesa_core/analysis/summary.py", "from mpesa_core.cleaning import normalize\n"
    )
    assert run_guard(GUARD, "--root", package).returncode == 1


def test_real_repo_passes():
    guard_run = run_guard(GUARD)
    assert guard_run.returncode == 0, guard_run.stdout + guard_run.stderr


@pytest.mark.parametrize(
    "rel",
    [
        "src/mpesa_core/cleaning/normalize.py",
        "src/mpesa_core/extraction/rows.py",
        "src/mpesa_core/classification/__init__.py",
        "src/mpesa_core/reconciliation/__init__.py",
        "src/mpesa_core/pipeline.py",
        "src/mpesa_core/bridge.py",
    ],
)
def test_pandas_outside_analysis_fails(package, rel):
    plant(package, rel, "import pandas\n")
    assert_fails_quietly(run_guard(GUARD, "--root", package), rel, "-> pandas")


def test_pandas_inside_analysis_passes(package):
    plant(package, "src/mpesa_core/analysis/summary.py", "import pandas\n")
    guard_run = run_guard(GUARD, "--root", package)
    assert guard_run.returncode == 0, guard_run.stdout + guard_run.stderr


def test_the_pipeline_may_call_analysis_that_uses_pandas(package):
    plant(package, "src/mpesa_core/analysis/summary.py", "import pandas\n")
    plant(package, "src/mpesa_core/pipeline.py", "from mpesa_core.analysis import summary\n")
    guard_run = run_guard(GUARD, "--root", package)
    assert guard_run.returncode == 0, guard_run.stdout + guard_run.stderr
