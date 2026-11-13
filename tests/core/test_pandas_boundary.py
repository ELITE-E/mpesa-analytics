import sys

from fresh_imports import ANALYSIS, modules_outside_analysis, pandas_loaded_by_importing

from mpesa_core import errors
from mpesa_core.analysis import analyze_transactions


def test_importing_every_module_outside_analysis_leaves_pandas_unloaded():
    names = modules_outside_analysis()
    assert "mpesa_core.cleaning.canonicalize" in names
    assert ANALYSIS in names
    assert not pandas_loaded_by_importing(names)


def test_the_check_notices_a_module_that_does_load_pandas():
    assert pandas_loaded_by_importing([f"{ANALYSIS}.frame"])


def test_calling_the_analysis_is_what_loads_pandas():
    analyze_transactions([])
    assert "pandas" in sys.modules


def test_loaded_modules_are_put_back_afterwards():
    before = sys.modules[errors.__name__]
    pandas_loaded_by_importing(modules_outside_analysis())
    assert sys.modules[errors.__name__] is before
    assert before is errors
