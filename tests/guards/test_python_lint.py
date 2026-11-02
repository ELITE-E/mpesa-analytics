import json
import shutil
import subprocess
import sys
import tomllib
from pathlib import Path

import pytest

from conftest import REPO, plant

BIN = Path(sys.executable).parent
DOC = '"""Run one step.\n\n    Side Effects:\n        None.\n    """'
HEADER = '"""Planted module."""\n\n'


def many_statements(count):
    return "".join(f"    step_{i} = {i}\n" for i in range(count))


def many_branches(count):
    return "".join(f"    if row == {i}:\n        return {i}\n" for i in range(count))


SNIPPETS = {
    "D100": "RATE = 1\n",
    "D103": f"{HEADER}def run_step():\n    pass\n",
    "E711": f"{HEADER}RATE = rows == None\n",
    "F401": f"{HEADER}import math\n",
    "I001": f"{HEADER}import sys\nimport math\n\nRATE = (sys, math)\n",
    "B006": f"{HEADER}def run_step(rows=[]):\n    {DOC}\n",
    "B904": f"{HEADER}try:\n    RATE = 1\nexcept ValueError:\n    raise KeyError('page 1')\n",
    "BLE001": f"{HEADER}try:\n    RATE = 1\nexcept Exception:\n    RATE = 2\n",
    "S110": f"{HEADER}try:\n    RATE = 1\nexcept ValueError:\n    pass\n",
    "E722": f"{HEADER}try:\n    RATE = 1\nexcept:\n    RATE = 2\n",
    "FBT001": f"{HEADER}def run_step(strict: bool):\n    {DOC}\n",
    "FBT002": f"{HEADER}def run_step(strict=True):\n    {DOC}\n",
    "C901": f"{HEADER}def run_step(row):\n    {DOC}\n{many_branches(11)}",
    "PLR0912": f"{HEADER}def run_step(row):\n    {DOC}\n{many_branches(13)}",
    "PLR0913": f"{HEADER}def run_step(a1, a2, a3, a4, a5, a6):\n    {DOC}\n",
    "PLR0915": f"{HEADER}def run_step():\n    {DOC}\n{many_statements(51)}",
    "N802": f"{HEADER}def RunStep():\n    {DOC}\n",
    "T201": f"{HEADER}print('page 1')\n",
}


def ruff_codes(root):
    completed = subprocess.run(
        [
            str(BIN / "ruff"),
            "check",
            "--config",
            str(REPO / "pyproject.toml"),
            "--no-cache",
            "--output-format",
            "json",
            ".",
        ],
        cwd=root,
        capture_output=True,
        text=True,
    )
    return {finding["code"] for finding in json.loads(completed.stdout)}


@pytest.mark.parametrize("code", SNIPPETS.keys())
def test_ruff_rejects_each_planted_rule(tmp_path, code):
    plant(tmp_path, "src/planted.py", SNIPPETS[code])
    assert code in ruff_codes(tmp_path)


def test_tests_are_exempt_from_docstring_rules_only(tmp_path):
    plant(tmp_path, "tests/core/test_planted.py", "def test_step():\n    print('page 1')\n")
    codes = ruff_codes(tmp_path)
    assert "T201" in codes
    assert not any(code.startswith("D") for code in codes)


def test_tools_may_print_but_nothing_else_is_relaxed(tmp_path):
    plant(tmp_path, "tools/planted.py", "def run_step():\n    print('page 1')\n")
    codes = ruff_codes(tmp_path)
    assert "T201" not in codes
    assert "D103" in codes


def test_tools_print_directly_without_a_workaround():
    sources = (path.read_text(encoding="utf-8") for path in (REPO / "tools").rglob("*.py"))
    assert not any("sys.stdout.write" in source for source in sources)


def test_print_stays_banned_outside_tools(tmp_path):
    plant(tmp_path, "web/probe/planted.py", "print('page 1')\n")
    assert "T201" in ruff_codes(tmp_path)


def test_bundle_budget_is_reported_as_not_enforced():
    completed = subprocess.run(
        [sys.executable, str(REPO / "tools" / "measure_bundle.py")],
        capture_output=True,
        text=True,
    )
    assert completed.returncode == 0, completed.stderr
    assert "NOT ENFORCED" in completed.stdout


def test_bundle_budget_is_not_a_ci_gate():
    assert "measure_bundle" not in (REPO / ".github/workflows/ci.yml").read_text(encoding="utf-8")


def pydoclint(root):
    return subprocess.run(
        [str(BIN / "pydoclint"), "--config", str(REPO / "pyproject.toml"), "src"],
        cwd=root,
        capture_output=True,
        text=True,
    )


@pytest.mark.parametrize(
    ("code", "source"),
    [
        ("DOC101", 'def scale(amount):\n    """Convert to cents."""\n'),
        (
            "DOC102",
            'def scale():\n    """Convert to cents.\n\n    Args:\n        amount: Gone.\n    """\n',
        ),
        ("DOC201", 'def scale():\n    """Convert to cents."""\n    return 1\n'),
        ("DOC501", 'def scale():\n    """Convert to cents."""\n    raise ValueError\n'),
    ],
    ids=["undocumented-arg", "stale-arg", "undocumented-return", "undocumented-raise"],
)
def test_pydoclint_rejects_sections_that_do_not_match(tmp_path, code, source):
    plant(tmp_path, "src/planted.py", source)
    completed = pydoclint(tmp_path)
    assert completed.returncode != 0
    assert code in completed.stdout + completed.stderr


def test_pydoclint_accepts_a_standards_shaped_docstring(tmp_path):
    source = '''def build_transaction_rows(statement_pages):
    """Build raw transaction rows from extracted statement pages.

    Args:
        statement_pages: Pages of positioned text items from the PDF engine.

    Returns:
        Transaction rows in print order, one per receipt anchor.

    Raises:
        ValueError: If no receipt anchor rows are found.

    Side Effects:
        None.
    """
    if not statement_pages:
        raise ValueError
    return statement_pages
'''
    plant(tmp_path, "src/planted.py", source)
    completed = pydoclint(tmp_path)
    assert completed.returncode == 0, completed.stdout


def test_real_repo_ruff_is_clean():
    completed = subprocess.run(
        [str(BIN / "ruff"), "check", "--no-cache", "."], cwd=REPO, capture_output=True, text=True
    )
    assert completed.returncode == 0, completed.stdout[:2000]


def test_real_repo_is_ruff_formatted():
    completed = subprocess.run(
        [str(BIN / "ruff"), "format", "--check", "."], cwd=REPO, capture_output=True, text=True
    )
    assert completed.returncode == 0, completed.stdout[:2000]


def test_real_repo_pydoclint_is_clean():
    completed = subprocess.run(
        [str(BIN / "pydoclint"), "src", "tools", "web/probe"],
        cwd=REPO,
        capture_output=True,
        text=True,
    )
    assert completed.returncode == 0, completed.stdout[:2000]


def test_lint_tools_stay_out_of_the_wheel():
    project = tomllib.loads((REPO / "pyproject.toml").read_text(encoding="utf-8"))
    assert project["project"]["dependencies"] == []
    dev = " ".join(project["dependency-groups"]["dev"])
    for tool in ("ruff", "pydoclint"):
        assert tool in dev


def test_node_tooling_is_dev_only():
    package = json.loads((REPO / "package.json").read_text(encoding="utf-8"))
    assert package["private"] is True
    assert "dependencies" not in package
    assert shutil.which("node")
