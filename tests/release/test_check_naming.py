"""CP10b item 8: tools/release/check_naming.py blocks a release until the owner has chosen a public
name, and that name avoids the M-Pesa trademark and is the one the app shows.

The repo itself still names the app after M-Pesa, so the gate fails here until the owner decides;
these tests run it on planted trees.
"""

import json
import subprocess
import sys

import pytest

from conftest import REPO, plant

SCRIPT = REPO / "tools" / "release" / "check_naming.py"


def tree(tmp_path, *, chosen, shown=None, domain="ledger.example.org"):
    shown = chosen if shown is None else shown
    plant(tmp_path, "docs/NAMING.md", f"# Naming\n\nChosen name: {chosen}\nDomain: {domain}\n")
    manifest = {"name": shown, "short_name": shown}
    plant(tmp_path, "web/public/manifest.webmanifest", json.dumps(manifest))
    plant(
        tmp_path,
        "web/src/app/layout.tsx",
        f'export const metadata = {{\n  title: "{shown}",\n}};\n',
    )
    return tmp_path


def check(root):
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--root", str(root)], capture_output=True, text=True
    )


def test_a_chosen_name_shown_everywhere_passes(tmp_path):
    run = check(tree(tmp_path, chosen="Statement Lens"))
    assert run.returncode == 0, run.stdout


def test_a_pending_choice_fails(tmp_path):
    run = check(tree(tmp_path, chosen="(pending: the owner decides)", shown="Anything"))
    assert run.returncode == 1
    assert "pending" in run.stdout


@pytest.mark.parametrize("name", ["M-Pesa Analytics", "MPESA Lens", "m pesa view", "Mpesa"])
def test_a_name_using_the_trademark_fails(tmp_path, name):
    run = check(tree(tmp_path, chosen=name))
    assert run.returncode == 1
    assert "trademark" in run.stdout


def test_a_domain_using_the_trademark_fails(tmp_path):
    run = check(tree(tmp_path, chosen="Statement Lens", domain="mpesa-lens.example.org"))
    assert run.returncode == 1
    assert "domain" in run.stdout


def test_an_app_that_shows_another_name_fails(tmp_path):
    run = check(tree(tmp_path, chosen="Statement Lens", shown="Old Name"))
    assert run.returncode == 1
    assert "manifest" in run.stdout or "title" in run.stdout
