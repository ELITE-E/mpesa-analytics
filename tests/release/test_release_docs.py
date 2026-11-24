"""CP10b items 3, 5, 6 and 8: the release documents say what they must, and every claim has a test.

The README's privacy and security claims table names, for each claim, a test file and the exact
test name; each must exist. Versions agree with the changelog. Nothing here picks a licence or a
public name: those are the owner's.
"""

import json
import re
import tomllib

from conftest import REPO

README = (REPO / "README.md").read_text(encoding="utf-8")
CI = (REPO / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
CLAIM_ROW = re.compile(r"^\| (?P<claim>[^|]+?) \| `(?P<file>[^`]+)` \| (?P<test>.+?) \|$")
NEVER_ATTACH = re.compile(r"never attach.{0,80}statement", re.IGNORECASE | re.DOTALL)


def text_of(rel):
    path = REPO / rel
    assert path.is_file(), f"{rel} is missing"
    return path.read_text(encoding="utf-8")


def readme_section(heading):
    match = re.search(rf"^## {re.escape(heading)}\n(.*?)(?=^## |\Z)", README, re.M | re.S)
    assert match, f"README has no '## {heading}' section"
    return match.group(1)


def claim_rows():
    rows = [
        CLAIM_ROW.match(line)
        for line in readme_section("Privacy and security claims").splitlines()
        if line.startswith("| ") and not line.startswith("| Claim") and "---" not in line
    ]
    assert all(rows), "every claims row is '| claim | `file` | test name |'"
    return [row.groupdict() for row in rows]


def test_the_readme_claims_table_covers_the_promises():
    claims = " ".join(row["claim"].lower() for row in claim_rows())
    for promise in (
        "leaves",
        "csp",
        "third-party",
        "encrypt",
        "never saved",
        "delete",
        "lock",
        "offline",
        "headers",
        "history",
    ):
        assert promise in claims, promise
    assert len(claim_rows()) >= 12


def test_every_readme_claim_names_a_test_that_exists():
    for row in claim_rows():
        source = text_of(row["file"])
        name = row["test"].strip().strip('"')
        if row["file"].endswith(".py"):
            assert re.search(rf"^def {re.escape(name)}\(", source, re.M), name
        else:
            assert f'"{name}"' in source or f"`{name}`" in source, (row["file"], name)


def test_the_readme_states_the_limits():
    limits = readme_section("Limits").lower()
    for limit in (
        "desktop only",
        "phone",
        "unverified",
        "24%",
        "uncategorised",
        "about a minute",
        "not proof",
        "authentic",
        "verification instruction",
        "printed on the statement",
    ):
        assert limit in limits, limit


def test_the_readme_says_what_is_stored_when_remember_is_on():
    stored = readme_section("What is stored when Remember is on").lower()
    for fact in ("encrypted", "hint", "salt", "never", "pdf", "passphrase", "delete"):
        assert fact in stored, fact


def test_the_readme_says_not_affiliated_with_safaricom():
    assert re.search(r"not affiliated with Safaricom", README, re.I)


def test_licence_is_pending_and_names_no_choice():
    pending = text_of("LICENSE.pending")
    assert re.search(r"not (yet )?(been )?chosen", pending, re.I)
    assert "owner" in pending.lower()
    assert "SPDX-License-Identifier" not in pending
    assert "THIRD_PARTY_NOTICES.md" in pending


def test_security_policy_says_how_to_report_privately():
    security = text_of("SECURITY.md")
    assert re.search(r"privately", security, re.I)
    assert re.search(r"security advisor|private vulnerability report", security, re.I)
    assert NEVER_ATTACH.search(security)
    assert re.search(r"file path", security, re.I)


def test_contributing_states_the_rules_and_every_suite():
    contributing = text_of("CONTRIBUTING.md")
    for rule in (r"red first", r"CODING_STANDARDS\.md", r"synthetic", r"real statement"):
        assert re.search(rule, contributing, re.I), rule
    for command in (
        "uv run pytest",
        "node --test tests/pdf_readers/*.test.js",
        "node --test --test-concurrency=1 tests/browser/*.test.js",
        "node tools/run_pyodide_tests.mjs",
        "npm run build --prefix web",
        "node --import ./tests/support/register.mjs --test",
        "node --test --test-concurrency=1 tests/release/*.test.mjs",
        "uv run python tools/release/scan_history.py",
        "uv run pre-commit run --all-files",
    ):
        assert command in contributing, command


def test_issue_templates_tell_reporters_never_to_attach_a_statement():
    folder = REPO / ".github" / "ISSUE_TEMPLATE"
    config = (folder / "config.yml").read_text(encoding="utf-8")
    assert re.search(r"^blank_issues_enabled: false$", config, re.M)
    assert "security" in config.lower()
    templates = sorted(folder.glob("*.yml"))
    templates = [path for path in templates if path.name != "config.yml"]
    assert len(templates) >= 2
    for template in templates:
        body = template.read_text(encoding="utf-8")
        assert NEVER_ATTACH.search(body), template.name
        assert "required: true" in body, template.name


def test_release_checklist_has_automated_and_manual_gates():
    checklist = text_of("docs/RELEASE_CHECKLIST.md")
    automated, manual = re.split(r"^## Part 2", checklist, maxsplit=1, flags=re.M)
    assert re.search(r"^## Part 1", automated, re.M)
    for script in re.findall(r"(tools/[\w/.-]+\.(?:py|mjs|js))", automated):
        assert (REPO / script).is_file(), script
    for gate in (
        "export_baseline.py",
        "compare.py",
        "--share",
        "browser_run.mjs",
        "ui_run.mjs",
        "--remember",
        "pdf_signature_probe.mjs",
        "check_deployed.mjs",
        "OQ-17",
        "rm -rf",
        "exposure",
    ):
        assert gate in manual, gate
    assert "git tag" in manual.lower()


def test_versions_agree_with_the_changelog_at_1_0_0():
    pyproject = tomllib.loads(text_of("pyproject.toml"))["project"]["version"]
    web = json.loads(text_of("web/package.json"))["version"]
    web_lock = json.loads(text_of("web/package-lock.json"))
    uv_lock = tomllib.loads(text_of("uv.lock"))
    (core_lock,) = [pkg for pkg in uv_lock["package"] if pkg["name"] == "mpesa-core"]
    changelog = re.search(r"^## \[(\d+\.\d+\.\d+)\]", text_of("CHANGELOG.md"), re.M)
    assert changelog, "CHANGELOG has a '## [x.y.z]' entry"
    versions = {
        "pyproject": pyproject,
        "web": web,
        "web lock": web_lock["version"],
        "web lock root": web_lock["packages"][""]["version"],
        "uv lock": core_lock["version"],
        "changelog": changelog.group(1),
    }
    assert set(versions.values()) == {"1.0.0"}, versions


def test_ci_names_the_wheel_by_glob_not_by_version():
    assert "mpesa_core-0.0.0" not in CI


def test_naming_document_states_the_trademark_rule_and_the_owners_choice():
    naming = text_of("docs/NAMING.md")
    assert re.search(r"^Chosen name: .+$", naming, re.M)
    assert re.search(r"trademark", naming, re.I)
    assert re.search(r"not affiliated with Safaricom", naming, re.I)
    assert re.search(r"domain", naming, re.I)
