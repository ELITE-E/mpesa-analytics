import pytest

from conftest import assert_fails_quietly, plant, run_guard

GUARD = "check_function_docstrings.py"
TARGET = "src/mpesa_core/rows.py"
GOOD_BODY = '''    """Count the receipt anchors on one page.

    Side Effects:
        None.
    """
'''

MISSING = {
    "function": "def count_anchors():\n    pass\n",
    "method": (
        'class Counter:\n    """Count anchors."""\n\n    def count_anchors(self):\n        pass\n'
    ),
    "async": "async def count_anchors():\n    pass\n",
    "nested": f"def count_anchors():\n{GOOD_BODY}    def inner_step():\n        pass\n",
}
RESTATES_NAME = {
    "same-words": '"""Count anchors."""',
    "with-article": '"""Count the anchors."""',
    "inflected": '"""Counts anchors."""',
    "this-function": '"""This function counts anchors."""',
    "snake-case": '"""count_anchors"""',
    "stub": '"""TODO"""',
}


@pytest.mark.parametrize("source", MISSING.values(), ids=MISSING.keys())
def test_missing_docstring_fails(clean_tree, source):
    plant(clean_tree, TARGET, source)
    assert_fails_quietly(run_guard(GUARD, "--root", clean_tree), TARGET, "count_anchors")


@pytest.mark.parametrize("docstring", RESTATES_NAME.values(), ids=RESTATES_NAME.keys())
def test_first_line_restating_the_name_fails(clean_tree, docstring):
    plant(clean_tree, TARGET, f"def count_anchors():\n    {docstring}\n")
    assert_fails_quietly(run_guard(GUARD, "--root", clean_tree), TARGET, docstring)


@pytest.mark.parametrize(
    "source",
    [
        'def scale(amount):\n    """Convert to whole cents.\n\n'
        '    Side Effects:\n        None.\n    """\n',
        'def scale():\n    """Convert to whole cents.\n\n'
        '    Side Effects:\n        None.\n    """\n    return 1\n',
        'def scale():\n    """Convert to whole cents.\n\n'
        '    Side Effects:\n        None.\n    """\n    raise ValueError\n',
        'def scale():\n    """Convert to whole cents."""\n',
    ],
    ids=["missing-args", "missing-returns", "missing-raises", "missing-side-effects"],
)
def test_missing_applicable_section_fails(clean_tree, source):
    plant(clean_tree, TARGET, source)
    assert_fails_quietly(run_guard(GUARD, "--root", clean_tree), TARGET)


def test_complete_contract_passes(clean_tree):
    source = '''def scale(amount):
    """Convert a printed amount to whole cents.

    Args:
        amount: Printed amount.

    Returns:
        Whole cents.

    Raises:
        ValueError: If the amount is negative.

    Side Effects:
        None.
    """
    if amount < 0:
        raise ValueError
    return amount * 100
'''
    plant(clean_tree, TARGET, source)
    guard_run = run_guard(GUARD, "--root", clean_tree)
    assert guard_run.returncode == 0, guard_run.stdout


def test_sections_not_demanded_where_not_applicable(clean_tree):
    source = '''class Counter:
    """Hold a running anchor total."""

    def reset(self):
        """Forget every anchor seen so far.

        Side Effects:
            Clears the running total.
        """
        return
'''
    plant(clean_tree, TARGET, source)
    guard_run = run_guard(GUARD, "--root", clean_tree)
    assert guard_run.returncode == 0, guard_run.stdout


def test_nested_raise_does_not_count_for_the_outer_function(clean_tree):
    inner_body = GOOD_BODY.replace("    ", "        ", 1).replace(
        chr(10) + "    ", chr(10) + "        "
    )
    source = f'''def outer_step():
    """Build a checker for later use.

    Returns:
        The checker.

    Side Effects:
        None.
    """
    def inner_step():
{inner_body}        raise ValueError
    return inner_step
'''
    plant(clean_tree, TARGET, source)
    guard_run = run_guard(GUARD, "--root", clean_tree)
    assert guard_run.returncode == 1
    assert f"{TARGET}: 1 " in guard_run.stdout


@pytest.mark.parametrize("rel", ["tools/x.py", "engine/x.py", "src/mpesa_core/analytics/x.py"])
def test_every_source_root_is_checked(clean_tree, rel):
    plant(clean_tree, rel, "def run_step():\n    pass\n")
    assert_fails_quietly(run_guard(GUARD, "--root", clean_tree), rel)


def test_tests_are_exempt(clean_tree):
    plant(clean_tree, "tests/core/test_rows.py", "def test_something():\n    pass\n")
    assert run_guard(GUARD, "--root", clean_tree).returncode == 0


def test_syntax_error_fails_closed(clean_tree):
    plant(clean_tree, TARGET, "def (:\n")
    assert_fails_quietly(run_guard(GUARD, "--root", clean_tree), TARGET)


def test_clean_tree_passes(clean_tree):
    assert run_guard(GUARD, "--root", clean_tree).returncode == 0


def test_real_repo_passes():
    guard_run = run_guard(GUARD)
    assert guard_run.returncode == 0, guard_run.stdout
