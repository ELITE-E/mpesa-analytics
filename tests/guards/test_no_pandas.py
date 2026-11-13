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


ANALYSIS = CORE / "mpesa_core" / "analysis"
OUTSIDE_ANALYSIS = sorted(path for path in CORE.rglob("*.py") if ANALYSIS not in path.parents)


@pytest.mark.parametrize("path", OUTSIDE_ANALYSIS, ids=lambda path: str(path.relative_to(CORE)))
def test_no_core_module_outside_analysis_imports_pandas(path):
    assert "pandas" not in imported_roots(path.read_bytes())


def test_the_analysis_package_itself_loads_pandas_only_when_called():
    tree = ast.parse((ANALYSIS / "__init__.py").read_bytes())
    top_level = [node for node in tree.body if isinstance(node, ast.Import | ast.ImportFrom)]
    assert top_level == []


def test_pandas_is_used_inside_analysis():
    users = [
        path for path in ANALYSIS.glob("*.py") if "pandas" in imported_roots(path.read_bytes())
    ]
    assert users


def test_pandas_is_an_optional_extra_pinned_to_the_pyodide_runtime():
    import tomllib

    from vendor import PINS

    project = tomllib.loads((REPO / "pyproject.toml").read_text(encoding="utf-8"))["project"]
    assert project["optional-dependencies"] == {"analysis": ["pandas==3.0.2"]}
    assert any("pandas-3.0.2-" in pinned for pinned in PINS)


def test_the_core_declares_no_runtime_dependency():
    project = (REPO / "pyproject.toml").read_text(encoding="utf-8")
    assert "\ndependencies = []\n" in project
