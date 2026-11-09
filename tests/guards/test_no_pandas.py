import ast

import pytest

from conftest import REPO

CORE = REPO / "src"


def imported_roots(source):
    roots = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            roots.update(alias.name.partition(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.level == 0:
            roots.add((node.module or "").partition(".")[0])
    return roots


@pytest.mark.parametrize(
    "source",
    [
        "import pandas\n",
        "import pandas as pd\n",
        "from pandas import DataFrame\n",
        "import pandas.api\n",
    ],
    ids=["import", "alias", "from", "submodule"],
)
def test_planted_pandas_import_is_detected(source):
    assert "pandas" in imported_roots(source)


@pytest.mark.parametrize(
    "path", sorted(CORE.rglob("*.py")), ids=lambda path: str(path.relative_to(CORE))
)
def test_no_core_module_imports_pandas(path):
    assert "pandas" not in imported_roots(path.read_bytes())


def test_the_core_declares_no_runtime_dependency():
    project = (REPO / "pyproject.toml").read_text(encoding="utf-8")
    assert "\ndependencies = []\n" in project
