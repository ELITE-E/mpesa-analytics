import re

import pytest

from conftest import REPO

DECISIONS = REPO / "docs" / "decisions"
STANDARDS = (REPO / "docs" / "CODING_STANDARDS.md").read_text(encoding="utf-8")
TEMPLATE = REPO / ".github" / "pull_request_template.md"
CHECKBOX = re.compile(r"^- \[ \] .+$", re.MULTILINE)


def review_checklist():
    section = STANDARDS.split("## 13. Code review checklist", 1)[1].split("\n## ", 1)[0]
    return CHECKBOX.findall(section)


def test_standards_checklist_has_the_expected_size():
    assert len(review_checklist()) == 49


# The pack rewords these two items; every other item matches apart from its final period.
DECLARED_REWORDINGS = {
    "Error messages are meaningful": (
        "Error messages are meaningful and carry no statement values"
    ),
    "Existing module boundaries are respected unless a recorded change is justified": (
        "Existing module boundaries are respected unless a recorded change is justified (ADR 0005)"
    ),
}


def template_text():
    return TEMPLATE.read_text(encoding="utf-8")


def test_pull_request_template_has_every_standards_item():
    template_items = {checkbox.rstrip(".") for checkbox in CHECKBOX.findall(template_text())}
    for checkbox in review_checklist():
        wording = checkbox.removeprefix("- [ ] ").rstrip(".")
        assert f"- [ ] {DECLARED_REWORDINGS.get(wording, wording)}" in template_items


def test_pull_request_template_has_the_packs_checklist_size():
    template = template_text()
    assert len(CHECKBOX.findall(template)) == 52
    assert len(CHECKBOX.findall(template.split("## Review checklist", 1)[1])) == 44


def test_pull_request_template_keeps_the_eight_review_groups_and_privacy():
    groups = re.findall(r"^\*\*\d\. .+\*\*$", template_text(), re.MULTILINE)
    assert len(groups) == 8
    privacy = template_text().split("## Privacy", 1)[1].split("\n## ", 1)[0]
    assert len(CHECKBOX.findall(privacy)) == 5


@pytest.mark.parametrize(
    "term",
    ["statement", "transaction", "receipt number", "entity", "event type"],
)
def test_glossary_defines_core_terms(term):
    text = (REPO / "docs" / "glossary.md").read_text(encoding="utf-8").lower()
    assert re.search(rf"^\|\s*{term}\s*\|", text, re.MULTILINE)


def test_glossary_lists_avoid_synonyms():
    assert "avoid" in (REPO / "docs" / "glossary.md").read_text(encoding="utf-8").lower()


@pytest.mark.parametrize(
    ("pattern", "needle"),
    [
        ("0004-*.md", "codes, positions and counts"),
        ("0005-*.md", "mpesa-parser"),
        ("0006-*.md", "Runtime dependencies"),
        ("0007-*.md", "PagesDocument"),
    ],
)
def test_decision_record_exists(pattern, needle):
    records = list(DECISIONS.glob(pattern))
    assert len(records) == 1
    assert needle in records[0].read_text(encoding="utf-8")


@pytest.mark.parametrize("change", ["D-01", "D-02", "D-07"])
def test_behaviour_change_log_lists_planned_changes(change):
    assert change in (DECISIONS / "behaviour-changes.md").read_text(encoding="utf-8")


def test_test_edits_log_has_no_unfilled_fields_and_holds_the_cp0_edit():
    log = (DECISIONS / "test-edits.md").read_text(encoding="utf-8")
    assert "FILL IN" not in log
    assert r"\bsecrets\." in log


def test_behaviour_log_keeps_the_merged_reason():
    log = (DECISIONS / "behaviour-changes.md").read_text(encoding="utf-8")
    assert "porting bug" in log
    assert not list(DECISIONS.glob("*behaviour-changes-log*"))


def test_decision_index_lists_every_adr():
    index = (DECISIONS / "README.md").read_text(encoding="utf-8")
    for record in DECISIONS.glob("[0-9][0-9][0-9][0-9]-*.md"):
        assert f"| {record.name[:4]} |" in index


def test_superseded_adr_files_are_gone():
    assert not (DECISIONS / "0007-test-edits.md").exists()
    assert not (DECISIONS / "0004-error-messages.md").exists()
    assert not (DECISIONS / "0006-statement-pages-name.md").exists()


def test_standards_say_vocabulary_runs_in_pre_commit():
    assert re.search(r"^\| Domain vocabulary \|.*\| pre-commit, CI \|$", STANDARDS, re.MULTILINE)


@pytest.mark.parametrize(
    ("term", "avoid"),
    [
        ("recurring", "repeat, regular, subscription"),
        ("remember on this device", "save, sync, upload, import"),
    ],
)
def test_glossary_restores_owner_approved_terms(term, avoid):
    text = (REPO / "docs" / "glossary.md").read_text(encoding="utf-8")
    assert re.search(rf"^\| {term} \|.*\| {re.escape(avoid)} \|$", text, re.MULTILINE)


def test_adr_0004_names_the_error_message_helper_as_enforcement():
    record = next(DECISIONS.glob("0004-*.md")).read_text(encoding="utf-8")
    enforcement = record.split("## Enforcement", 1)[1]
    assert "tools/guards/error_message_safety.py" in enforcement
    assert "assert_message_is_safe" in enforcement
