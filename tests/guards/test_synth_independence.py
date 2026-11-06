import ast
import shutil

import pytest

from conftest import REPO, assert_fails_quietly, plant, run_guard

GUARD = "check_imports.py"
SYNTH = REPO / "tools" / "synth"


@pytest.fixture
def package(tmp_path):
    shutil.copy(REPO / ".importlinter", tmp_path / ".importlinter")
    for module in ("__init__", "contracts", "extraction/__init__", "extraction/rows", "bridge"):
        plant(tmp_path, f"src/mpesa_core/{module}.py", "")
    plant(tmp_path, "src/mpesa_core/analysis/__init__.py", "")
    plant(tmp_path, "tools/synth/__init__.py", "")
    plant(tmp_path, "tools/synth/ledger.py", "")
    return tmp_path


def imported_roots(path):
    tree = ast.parse(path.read_bytes())
    roots = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            roots.update(alias.name.partition(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            roots.add((node.module or "").partition(".")[0])
    return roots


def test_clean_synth_package_passes(package):
    guard_run = run_guard(GUARD, "--root", package)
    assert guard_run.returncode == 0, guard_run.stdout + guard_run.stderr


@pytest.mark.parametrize(
    "source",
    [
        "import mpesa_core\n",
        "from mpesa_core.extraction import rows\n",
        "from mpesa_core.extraction.rows import x\n",
    ],
    ids=["import", "from", "from-module"],
)
def test_synth_importing_the_core_fails_the_contract(package, source):
    plant(package, "tools/synth/ledger.py", source)
    assert_fails_quietly(run_guard(GUARD, "--root", package), "tools/synth/ledger.py")


def test_contract_is_declared_for_the_synth_package():
    config = (REPO / ".importlinter").read_text(encoding="utf-8")
    assert "root_packages" in config
    assert "source_modules =\n    synth\n" in config


def test_real_repo_has_no_synth_to_core_import():
    guard_run = run_guard(GUARD)
    assert guard_run.returncode == 0, guard_run.stdout + guard_run.stderr


def test_ledger_imports_only_the_standard_library():
    assert imported_roots(SYNTH / "ledger.py") <= {"decimal", "datetime"}


@pytest.mark.parametrize("path", sorted(SYNTH.glob("*.py")), ids=lambda path: path.name)
def test_no_synth_module_imports_the_core(path):
    assert "mpesa_core" not in imported_roots(path)
