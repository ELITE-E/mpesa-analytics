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


@pytest.fixture
def package(tmp_path):
    shutil.copy(REPO / ".importlinter", tmp_path / ".importlinter")
    for module in ("__init__", "contracts", "rows", "bridge", "normalize"):
        plant(tmp_path, f"src/mpesa_core/{module}.py", "")
    plant(tmp_path, "src/mpesa_core/analytics/__init__.py", "")
    plant(tmp_path, "src/mpesa_core/analytics/summary.py", "")
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


@pytest.mark.parametrize("name", ["bridge", "rows"])
def test_analytics_may_not_import(package, name):
    plant(package, "src/mpesa_core/analytics/summary.py", f"from mpesa_core import {name}\n")
    assert_fails_quietly(run_guard(GUARD, "--root", package), "src/mpesa_core/analytics/summary.py")


def test_analytics_may_not_import_bridge_indirectly(package):
    plant(package, "src/mpesa_core/normalize.py", "from mpesa_core import bridge\n")
    plant(package, "src/mpesa_core/analytics/summary.py", "from mpesa_core import normalize\n")
    assert run_guard(GUARD, "--root", package).returncode == 1


def test_real_repo_passes():
    guard_run = run_guard(GUARD)
    assert guard_run.returncode == 0, guard_run.stdout + guard_run.stderr
