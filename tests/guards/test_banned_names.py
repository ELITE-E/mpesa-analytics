import tomllib

import pytest

from conftest import GUARDS, assert_fails_quietly, plant, run_guard

GUARD = "check_banned_names.py"
TARGET = "src/mpesa_core/extraction/rows.py"
GENERIC = [
    "data",
    "result",
    "temp",
    "tmp",
    "info",
    "item",
    "obj",
    "ref",
    "flag",
    "res",
    "ret",
    "val",
]
VOCABULARY = "import_mpesa_" + "statement"

BINDINGS = {
    "assignment": "{name} = 1\n",
    "parameter": "def run_step({name}):\n    pass\n",
    "keyword-only": "def run_step(*, {name}):\n    pass\n",
    "function": "def {name}():\n    pass\n",
    "class": "class {name}:\n    pass\n",
    "attribute": "class Row:\n    def __init__(self):\n        self.{name} = 1\n",
    "for-loop": "for {name} in []:\n    pass\n",
    "comprehension": "rows = [{name} for {name} in []]\n",
    "except": "try:\n    pass\nexcept ValueError as {name}:\n    pass\n",
    "with": "with open('x') as {name}:\n    pass\n",
    "import-alias": "import math as {name}\n",
    "walrus": "if ({name} := 1):\n    pass\n",
}


@pytest.mark.parametrize("name", GENERIC)
def test_every_generic_name_fails(clean_tree, name):
    plant(clean_tree, TARGET, f"{name} = 1\n")
    assert_fails_quietly(run_guard(GUARD, "--root", clean_tree), TARGET, f"{name} =")


@pytest.mark.parametrize("template", BINDINGS.values(), ids=BINDINGS.keys())
def test_every_binding_form_is_checked(clean_tree, template):
    plant(clean_tree, TARGET, template.format(name="result"))
    assert run_guard(GUARD, "--root", clean_tree).returncode == 1


@pytest.mark.parametrize(
    "source",
    [
        "q = 1\n",
        "x = 1\n",
        "def run_step(i):\n    pass\n",
        "def f():\n    pass\n",
        "for q in []:\n    pass\n",
        "rows = [q for q in []]\n",
        "scale = lambda q: q\n",
    ],
    ids=[
        "assign",
        "assign-allowed-letter",
        "param-allowed-letter",
        "function",
        "for-other-letter",
        "comprehension-other-letter",
        "lambda",
    ],
)
def test_single_letter_outside_allowed_loop_use_fails(clean_tree, source):
    plant(clean_tree, TARGET, source)
    assert_fails_quietly(run_guard(GUARD, "--root", clean_tree), TARGET)


@pytest.mark.parametrize(
    "source",
    [
        "for i in []:\n    pass\n",
        "for i, j in []:\n    pass\n",
        "rows = [x for x in []]\n",
        "rows = {k: y for k, y in []}\n",
        "for _ in []:\n    pass\n",
        "for transaction_row in []:\n    pass\n",
        "response = fetch(payload=1)\nfetch(data=response.data)\n",
    ],
    ids=["for", "tuple", "list-comp", "dict-comp", "underscore", "descriptive", "external-names"],
)
def test_allowed_names_pass(clean_tree, source):
    plant(clean_tree, TARGET, source)
    guard_run = run_guard(GUARD, "--root", clean_tree)
    assert guard_run.returncode == 0, guard_run.stdout


@pytest.mark.parametrize(
    "source",
    [
        f"def {VOCABULARY}():\n    pass\n",
        f"{VOCABULARY}()\n",
        f"module.{VOCABULARY}()\n",
        f"from module import {VOCABULARY}\n",
    ],
    ids=["definition", "call", "attribute", "import"],
)
def test_vocabulary_ban_covers_uses_as_well_as_definitions(clean_tree, source):
    plant(clean_tree, TARGET, source)
    assert_fails_quietly(run_guard(GUARD, "--root", clean_tree), TARGET, VOCABULARY)


def test_vocabulary_is_seeded_in_guards_toml():
    config = tomllib.loads((GUARDS / "guards.toml").read_text(encoding="utf-8"))
    assert VOCABULARY in config["names"]["banned_names"]


@pytest.mark.parametrize(
    "rel", ["tools/x.py", "pdf_reader/x.py", "tests/core/test_x.py", "web/probe/x.py"]
)
def test_every_python_root_is_checked(clean_tree, rel):
    plant(clean_tree, rel, "result = 1\n")
    assert_fails_quietly(run_guard(GUARD, "--root", clean_tree), rel)


def test_count_is_reported(clean_tree):
    plant(clean_tree, TARGET, "result = 1\ndata = 2\nq = 3\n")
    assert f"{TARGET}: 3 " in run_guard(GUARD, "--root", clean_tree).stdout


def write_config(tmp_path, allow_lines):
    source = (GUARDS / "guards.toml").read_text(encoding="utf-8")
    return plant(tmp_path, "cfg/guards.toml", f"{source}\n{allow_lines}\n")


def test_allowlist_entry_with_reason_passes(clean_tree):
    plant(clean_tree, TARGET, "result = 1\n")
    entry = (
        f'[[names.allow]]\nname = "result"\npath = "{TARGET}"\n'
        'reason = "Mirrors an upstream field."'
    )
    config = write_config(clean_tree, entry)
    guard_run = run_guard(GUARD, "--root", clean_tree, "--config", config)
    assert guard_run.returncode == 0, guard_run.stdout


def test_allowlist_is_scoped_to_its_path(clean_tree):
    plant(clean_tree, "tools/other.py", "result = 1\n")
    entry = (
        f'[[names.allow]]\nname = "result"\npath = "{TARGET}"\n'
        'reason = "Mirrors an upstream field."'
    )
    config = write_config(clean_tree, entry)
    assert_fails_quietly(
        run_guard(GUARD, "--root", clean_tree, "--config", config), "tools/other.py"
    )


@pytest.mark.parametrize(
    "reason_line", ['reason = ""', 'reason = "   "', ""], ids=["empty", "blank", "absent"]
)
def test_allowlist_entry_without_reason_fails(clean_tree, reason_line):
    plant(clean_tree, TARGET, "pass\n")
    entry = f'[[names.allow]]\nname = "result"\npath = "{TARGET}"\n{reason_line}'
    config = write_config(clean_tree, entry)
    assert_fails_quietly(run_guard(GUARD, "--root", clean_tree, "--config", config), "guards.toml")


def test_syntax_error_fails_closed(clean_tree):
    plant(clean_tree, TARGET, "def (:\n")
    assert_fails_quietly(run_guard(GUARD, "--root", clean_tree), TARGET)


def test_clean_tree_passes(clean_tree):
    assert run_guard(GUARD, "--root", clean_tree).returncode == 0


def test_real_repo_passes():
    guard_run = run_guard(GUARD)
    assert guard_run.returncode == 0, guard_run.stdout
