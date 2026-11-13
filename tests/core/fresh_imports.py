"""Import core modules as if for the first time, to see what importing them loads.

Works in one process, so it also runs under Pyodide, which cannot start a subprocess. The modules
already loaded are put back afterwards, so other tests keep the classes they imported.
"""

import importlib
import pkgutil
import sys

import mpesa_core

WATCHED_ROOTS = ("mpesa_core", "pandas")
ANALYSIS = "mpesa_core.analysis"


def core_module_names():
    prefix = f"{mpesa_core.__name__}."
    return [module.name for module in pkgutil.walk_packages(mpesa_core.__path__, prefix)]


def modules_outside_analysis():
    """List every core module except the insides of analysis; its package must itself be lazy."""
    return [name for name in core_module_names() if not name.startswith(f"{ANALYSIS}.")]


def is_watched(name):
    return name.partition(".")[0] in WATCHED_ROOTS


def pandas_loaded_by_importing(names):
    saved = {name: module for name, module in sys.modules.items() if is_watched(name)}
    for name in saved:
        del sys.modules[name]
    try:
        for name in names:
            importlib.import_module(name)
        return "pandas" in sys.modules
    finally:
        for name in [name for name in sys.modules if is_watched(name)]:
            del sys.modules[name]
        sys.modules.update(saved)
