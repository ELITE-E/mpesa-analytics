"""CP10b items 7 and 8: CI runs every check that needs no real data; only a version tag deploys.

The workflows are read as text: the steps that matter must be there, and a deploy must be
reachable from a version tag only.
"""

import re

from conftest import REPO

WORKFLOWS = REPO / ".github" / "workflows"
CI = (WORKFLOWS / "ci.yml").read_text(encoding="utf-8")


def release():
    path = WORKFLOWS / "release.yml"
    assert path.is_file(), "release.yml is missing"
    return path.read_text(encoding="utf-8")


def on_block(workflow):
    match = re.search(r"^on:\n((?:[ \t]+.*\n|\n)+)", workflow, re.M)
    assert match, "no 'on:' block"
    return match.group(1)


def test_ci_runs_the_history_scan_the_headers_test_and_the_release_tools_tests():
    for step in (
        "tools/release/scan_history.py",
        "tests/host-headers.test.mjs",
        "tests/release/*.test.mjs",
        "tools/release/third_party_notices.py --check",
    ):
        assert step in CI, step


def test_ci_never_deploys():
    for word in ("wrangler", "netlify deploy", "pages deploy", "gh release"):
        assert word not in CI, word


def test_release_runs_on_version_tags_only():
    trigger = on_block(release())
    assert re.search(r"tags:\s*\[\s*\"v\*\.\*\.\*\"\s*\]", trigger), trigger
    assert "branches" not in trigger
    assert "pull_request" not in trigger
    assert "workflow_dispatch" not in trigger


def test_release_runs_the_ci_checks_before_it_deploys():
    workflow = release()
    assert re.search(r"uses: \./\.github/workflows/ci\.yml", workflow)
    assert re.search(r"needs: \[?checks", workflow)


def test_release_deploys_to_the_chosen_host_only():
    workflow = release()
    assert "DEPLOY_HOST" in workflow
    assert "cloudflare-pages" in workflow
    assert "netlify" in workflow
    assert "node web/scripts/host_headers.mjs --host" in workflow


def test_release_publishes_checksums_in_the_release_notes():
    workflow = release()
    assert "tools/release/release_checksums.mjs" in workflow
    assert re.search(r"gh release create .*--notes-file", workflow)
    assert "sha256sums.txt" in workflow


def test_release_checks_the_public_name_before_deploying():
    workflow = release()
    assert "tools/release/check_naming.py" in workflow
    assert workflow.index("check_naming.py") < workflow.index("Deploy")


def test_ci_can_be_called_by_the_release_workflow():
    assert "workflow_call" in on_block(CI)
