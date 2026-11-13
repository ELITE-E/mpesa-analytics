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


def calibration_record():
    return next(DECISIONS.glob("0009-*.md")).read_text(encoding="utf-8")


@pytest.mark.parametrize(
    "needle",
    [
        "RECEIPT_PATTERN",
        "OQ-03",
        "OQ-10",
        "Whitespace",
        "baseline",
        "F-TIES",
        "## Enforcement",
    ],
)
def test_calibration_decisions_are_recorded(needle):
    assert needle in calibration_record()


def test_behaviour_log_marks_d03_done_with_its_test():
    log = (DECISIONS / "behaviour-changes.md").read_text(encoding="utf-8")
    row = next(line for line in log.splitlines() if line.startswith("| D-03 |"))
    assert "test_no_tables_found_raises_layout_unrecognized" in row
    assert "| Done" in row


def test_behaviour_log_asks_the_owner_about_one_sided_statements():
    log = (DECISIONS / "behaviour-changes.md").read_text(encoding="utf-8")
    row = next(line for line in log.splitlines() if line.startswith("| D-10 |"))
    assert "Proposed" in row


def test_test_edit_log_records_the_cp3_edits():
    log = (DECISIONS / "test-edits.md").read_text(encoding="utf-8")
    assert "## Edits for CP3" in log
    assert "COMMITTED" in log


@pytest.mark.parametrize(
    "name",
    ["PrintedLine", "ColumnLayout", "assemble_rows", "LayoutCounts", "continuation line"],
)
def test_glossary_names_the_calibration_terms(name):
    assert name in (REPO / "docs" / "glossary.md").read_text(encoding="utf-8")


def test_module_move_record_no_longer_promises_legacy_table_rows():
    record = next(DECISIONS.glob("0005-*.md")).read_text(encoding="utf-8")
    assert "legacy_table_rows" not in record


@pytest.mark.parametrize(
    "label",
    ["cold_load_seconds", "first_run_seconds", "median_run_seconds", "wasm_memory_bytes", "5,700"],
)
def test_pandas_free_timing_is_recorded(label):
    assert label in next(DECISIONS.glob("0011-*.md")).read_text(encoding="utf-8")


@pytest.mark.parametrize("change", ["D-02", "D-07"])
def test_classification_changes_are_marked_done(change):
    log = (DECISIONS / "behaviour-changes.md").read_text(encoding="utf-8")
    row = next(line for line in log.splitlines() if line.startswith(f"| {change} |"))
    assert "| Done" in row


def test_classification_behaviour_names_the_rule_order_and_d02():
    record = (DECISIONS / "classification-behaviour.md").read_text(encoding="utf-8")
    assert "Event type rules, in order" in record
    assert "D-02" in record
    assert "D-07" in record


@pytest.mark.parametrize("question", ["OQ-01", "OQ-02", "OQ-03", "OQ-10"])
def test_equivalence_results_record_the_open_questions(question):
    assert question in (DECISIONS / "equivalence-results.md").read_text(encoding="utf-8")


@pytest.mark.parametrize(
    "name",
    [
        "classify_transactions",
        "FinancialEvent",
        "extract_entity",
        "EVENT_CLASSIFICATION_UNRESOLVED",
    ],
)
def test_glossary_names_the_classification_terms(name):
    assert name in (REPO / "docs" / "glossary.md").read_text(encoding="utf-8")


@pytest.mark.parametrize("change", ["D-01", "A-4", "A-5"])
def test_analysis_fixes_are_marked_done(change):
    log = (DECISIONS / "behaviour-changes.md").read_text(encoding="utf-8")
    row = next(line for line in log.splitlines() if line.startswith(f"| {change} |"))
    assert "| Done" in row


@pytest.mark.parametrize("change", ["D-06", "A-1", "A-2", "A-3"])
def test_figure_changing_items_are_deferred(change):
    log = (DECISIONS / "behaviour-changes.md").read_text(encoding="utf-8")
    row = next(line for line in log.splitlines() if line.startswith(f"| {change} |"))
    assert "Deferred: changes figures; decide with data" in row


def test_adr_0006_records_the_pandas_decision():
    record = next(DECISIONS.glob("0006-*.md")).read_text(encoding="utf-8")
    assert "Accepted for v1" in record
    assert "26 to 47 hours" in record
    assert "only inside `mpesa_core.analysis`" in record


@pytest.mark.parametrize(
    "needle",
    ["How UNCLASSIFIED rows flow through", "default sort order for ties", "to_json_safe()"],
)
def test_analysis_behaviour_is_recorded(needle):
    assert needle in (DECISIONS / "analysis-behaviour.md").read_text(encoding="utf-8")


@pytest.mark.parametrize(
    "name", ["analyze_transactions", "measure_unclassified", "page heading", "prepared_frame"]
)
def test_glossary_names_the_analysis_terms(name):
    assert name in (REPO / "docs" / "glossary.md").read_text(encoding="utf-8")


def test_test_edit_log_records_the_cp6_edits():
    assert "## Edits for CP6" in (DECISIONS / "test-edits.md").read_text(encoding="utf-8")
