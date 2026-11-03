import importlib
import pkgutil

import mpesa_core


def core_module_names():
    prefix = f"{mpesa_core.__name__}."
    return [module.name for module in pkgutil.walk_packages(mpesa_core.__path__, prefix)]


def test_every_core_module_imports():
    names = core_module_names()
    assert "mpesa_core.errors" in names
    assert "mpesa_core.contracts" in names
    for name in names:
        importlib.import_module(name)


def test_core_needs_nothing_outside_the_standard_library():
    assert mpesa_core.__doc__
