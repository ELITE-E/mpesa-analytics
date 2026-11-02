import pytest

from conftest import assert_fails_quietly, plant, run_guard

GUARD = "check_core_purity.py"
CORE = "src/mpesa_core"

BANNED = {
    "os": "import os\n",
    "os.path": "import os.path\n",
    "os.environ": "import os\nvalue = os.environ\n",
    "from-os": "from os import environ\n",
    "sys": "import sys\n",
    "socket": "import socket\n",
    "subprocess": "from subprocess import run\n",
    "pathlib": "from pathlib import Path\n",
    "urllib": "import urllib.request\n",
    "http": "from http import client\n",
    "open-call": "open('x')\n",
    "open-alias": "reader = open\n",
    "dunder-import": "__import__('x')\n",
    "eval": "eval('1')\n",
    "exec": "exec('1')\n",
    "print": "print('x')\n",
    "js-outside-bridge": "import js\n",
    "from-js-outside-bridge": "from js import fetch\n",
    "pyodide-outside-bridge": "from pyodide.ffi import create_proxy\n",
}


@pytest.mark.parametrize("source", BANNED.values(), ids=BANNED.keys())
def test_banned_construct_fails(clean_tree, source):
    plant(clean_tree, f"{CORE}/contracts.py", source)
    assert_fails_quietly(
        run_guard(GUARD, "--root", clean_tree), f"{CORE}/contracts.py", source.strip()
    )


def test_nested_module_is_checked(clean_tree):
    plant(clean_tree, f"{CORE}/analytics/summary.py", "import os\n")
    assert_fails_quietly(run_guard(GUARD, "--root", clean_tree), f"{CORE}/analytics/summary.py")


def test_function_scope_is_checked(clean_tree):
    plant(clean_tree, f"{CORE}/rows.py", "def f():\n    import socket\n    return socket\n")
    assert_fails_quietly(run_guard(GUARD, "--root", clean_tree), f"{CORE}/rows.py")


def test_count_is_reported(clean_tree):
    plant(clean_tree, f"{CORE}/rows.py", "import os\nimport sys\nprint(1)\n")
    assert f"{CORE}/rows.py: 3 " in run_guard(GUARD, "--root", clean_tree).stdout


@pytest.mark.parametrize(
    "source", ["import js\n", "from js import fetch\n", "import pyodide.ffi\n"]
)
def test_js_and_pyodide_allowed_in_bridge(clean_tree, source):
    plant(clean_tree, f"{CORE}/bridge.py", source)
    guard_run = run_guard(GUARD, "--root", clean_tree)
    assert guard_run.returncode == 0, guard_run.stdout


def test_bridge_still_bans_the_rest(clean_tree):
    plant(clean_tree, f"{CORE}/bridge.py", "import os\n")
    assert_fails_quietly(run_guard(GUARD, "--root", clean_tree), f"{CORE}/bridge.py")


def test_only_top_level_bridge_gets_the_exemption(clean_tree):
    plant(clean_tree, f"{CORE}/analytics/bridge.py", "import js\n")
    assert_fails_quietly(run_guard(GUARD, "--root", clean_tree), f"{CORE}/analytics/bridge.py")


def test_syntax_error_fails_closed(clean_tree):
    plant(clean_tree, f"{CORE}/rows.py", "def (:\n")
    assert_fails_quietly(run_guard(GUARD, "--root", clean_tree), f"{CORE}/rows.py")


@pytest.mark.parametrize(
    "source",
    ["class A:\n    def open(self):\n        return self.print\n", "import math\nx = math.pi\n"],
    ids=["attribute-names", "pure-stdlib"],
)
def test_allowed_code_passes(clean_tree, source):
    plant(clean_tree, f"{CORE}/rows.py", source)
    guard_run = run_guard(GUARD, "--root", clean_tree)
    assert guard_run.returncode == 0, guard_run.stdout


def test_clean_tree_passes(clean_tree):
    assert run_guard(GUARD, "--root", clean_tree).returncode == 0


def test_real_repo_passes():
    assert run_guard(GUARD).returncode == 0
