"""CP10b item 8: tools/release/check_naming.py blocks a release until the owner has chosen a public
name, and that name avoids the M-Pesa trademark and is the one the app shows.

Most tests run it on planted trees: the older layout (a hand-written manifest, a literal title) and
the app's own (the name in web/src/content/brand.ts, imported by manifest.ts and the title). The
last runs it on the repo itself, now that the owner has chosen TallyDesk.
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


def brand_tree(tmp_path, *, chosen, brand=None, manifest_name="APP_NAME", title="APP_NAME"):
    """A tree whose shown name comes from web/src/content/brand.ts, as the app's does."""
    brand = chosen if brand is None else brand
    plant(tmp_path, "docs/NAMING.md", f"# Naming\n\nChosen name: {chosen}\nDomain: x.example.org\n")
    plant(tmp_path, "web/src/content/brand.ts", f'export const APP_NAME = "{brand}";\n')
    plant(
        tmp_path,
        "web/src/app/manifest.ts",
        f"export default function manifest() {{\n  return {{ name: {manifest_name}, "
        f"short_name: {manifest_name} }};\n}}\n",
    )
    plant(
        tmp_path, "web/src/app/layout.tsx", f"export const metadata = {{\n  title: {title},\n}};\n"
    )
    return tmp_path


def test_a_name_from_brand_ts_shown_through_manifest_ts_and_the_title_passes(tmp_path):
    run = check(brand_tree(tmp_path, chosen="Statement Lens"))
    assert run.returncode == 0, run.stdout


def test_a_brand_ts_name_that_is_not_the_chosen_one_fails(tmp_path):
    run = check(brand_tree(tmp_path, chosen="Statement Lens", brand="Old Name"))
    assert run.returncode == 1
    assert "brand.ts" in run.stdout


def test_a_manifest_ts_that_spells_out_another_name_fails(tmp_path):
    run = check(brand_tree(tmp_path, chosen="Statement Lens", manifest_name='"Old Name"'))
    assert run.returncode == 1
    assert "manifest" in run.stdout


def test_a_title_that_spells_out_another_name_fails(tmp_path):
    run = check(brand_tree(tmp_path, chosen="Statement Lens", title='"Old Name"'))
    assert run.returncode == 1
    assert "title" in run.stdout


def test_the_repos_own_naming_is_ready_for_release():
    run = check(REPO)
    assert run.returncode == 0, run.stdout
