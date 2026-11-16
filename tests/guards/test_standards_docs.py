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


@pytest.mark.parametrize("change", ["A-1", "A-2", "A-3"])
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


def equivalence_run(heading):
    record = (DECISIONS / "equivalence-results.md").read_text(encoding="utf-8")
    return record.split(f"## {heading}", 1)[1].split("\n## ", 1)[0]


def test_equivalence_results_record_the_cp6_run_in_counts():
    run = equivalence_run("Run 3: CP6")
    assert "All 19 gates passed" in run
    assert "| Report paths equal | 3,977 |" in run
    assert "| Report paths different | 0 |" in run


@pytest.mark.parametrize("open_item", ["blank status", "canonical names"])
def test_open_cp4_items_carry_a_recommended_default(open_item):
    log = (DECISIONS / "behaviour-changes.md").read_text(encoding="utf-8")
    row = next(line for line in log.splitlines() if line.startswith(f"| {open_item} |"))
    assert "Recommended default:" in row


def test_d06_is_done_and_names_the_balances_field():
    log = (DECISIONS / "behaviour-changes.md").read_text(encoding="utf-8")
    row = next(line for line in log.splitlines() if line.startswith("| D-06 |"))
    assert "| Done" in row
    assert "`balances`" in row
    assert "print order" in row


DOCS = REPO / "docs"
OLD_MODULES = [
    "src/clean.py",
    "src/engine.py",
    "src/engine_types.py",
    "src/entity.py",
    "src/event_types.py",
    "src/normalize.py",
    "src/pipeline.py",
    "src/security.py",
    "src/utils.py",
    "src/extract.py",
    "src/analytics/__init__.py",
    "src/analytics/cash_flow.py",
    "src/analytics/fees.py",
    "src/analytics/investments.py",
    "src/analytics/orchestration.py",
    "src/analytics/preparation.py",
    "src/analytics/recurrence.py",
    "src/analytics/result.py",
    "src/analytics/spending.py",
    "src/analytics/transfers.py",
    "src/persistence/identity.py",
    "src/persistence/collisions.py",
    "src/persistence/database.py",
    "src/persistence/models.py",
]


def test_v1_scope_adr_keeps_remember_on_this_device_opt_in_with_merging():
    record = next(DECISIONS.glob("0012-*.md")).read_text(encoding="utf-8")
    for needle in ("Remember on this device", "opt-in", "merging", "CP7b", "CP9", "JSON"):
        assert needle in record
    assert "| 0012 |" in (DECISIONS / "README.md").read_text(encoding="utf-8")


@pytest.mark.parametrize("module", OLD_MODULES)
def test_port_map_names_every_old_module(module):
    assert f"`{module}`" in (DOCS / "PORT_MAP.md").read_text(encoding="utf-8")


@pytest.mark.parametrize("marker", ["D-06", "D-01", "A-3", "New in the rewrite"])
def test_port_map_marks_changed_and_new_behaviour(marker):
    assert marker in (DOCS / "PORT_MAP.md").read_text(encoding="utf-8")


@pytest.mark.parametrize(
    "stage",
    [
        "extract_statement_pages",
        "attest",
        "build_rows",
        "canonicalize_rows",
        "classify_transactions",
        "analyze_transactions",
        "reconcile",
        "measure_balances",
        "pipeline.run",
        "breakpoint",
    ],
)
def test_tour_follows_one_transaction_through_every_stage(stage):
    assert stage in (DOCS / "TOUR.md").read_text(encoding="utf-8")


@pytest.mark.parametrize(
    "needle",
    ["compare.py", "--share", "export_baseline.py", "test_pipeline.py", "test_attest.py", "pytest"],
)
def test_debugging_guide_covers_mismatches_single_stages_and_tests(needle):
    assert needle in (DOCS / "DEBUGGING.md").read_text(encoding="utf-8")


@pytest.mark.parametrize("name", ["TOUR.md", "DEBUGGING.md", "PORT_MAP.md"])
def test_maintainer_docs_use_invented_values_only(name):
    text = (DOCS / name).read_text(encoding="utf-8")
    assert "Example" in text or name == "PORT_MAP.md"
    assert "*****" not in text


def test_test_edit_log_records_the_cp7a_edits():
    assert "## Edits for CP7a" in (DECISIONS / "test-edits.md").read_text(encoding="utf-8")


@pytest.mark.parametrize(
    "name", ["attest", "measure_balances", "Balances", "Period", "AnalysisError"]
)
def test_glossary_names_the_cp7a_terms(name):
    assert name in (DOCS / "glossary.md").read_text(encoding="utf-8")


def test_equivalence_results_say_what_the_identity_compares_and_its_tolerance():
    record = (DECISIONS / "equivalence-results.md").read_text(encoding="utf-8")
    section = record.split("## Balance identity", 1)[1].split("\n## ", 1)[0]
    for needle in ("balances_identity_holds", "half a cent", "0.005", "A-08", "not float `==`"):
        assert needle in section


@pytest.mark.parametrize(
    "line",
    [
        "identity_gap_bucket",
        "break_residuals_paired_adjacent",
        "chain_breaks_resolved_by_group_reorder",
        "--labels",
    ],
)
def test_equivalence_results_explain_the_chain_diagnostics(line):
    assert line in (DECISIONS / "equivalence-results.md").read_text(encoding="utf-8")


def test_adr_0006_is_accepted_with_pandas_lazy_and_optional_in_analysis_only():
    record = next(DECISIONS.glob("0006-*.md")).read_text(encoding="utf-8")
    status = record.splitlines()[2]
    assert status.startswith("Status: Accepted")
    for needle in ("`analysis/`", "lazily", "optional extra", "plain-Python rewrite", "v1.1"):
        assert needle in status
    row = next(
        line
        for line in (DECISIONS / "README.md").read_text(encoding="utf-8").splitlines()
        if line.startswith("| 0006 |")
    )
    assert "| Accepted" in row


IDENTITY_RECORD = DECISIONS / "identity-behaviour.md"
IMPORT_PLAN_RECORD = DECISIONS / "import-plan-behaviour.md"


@pytest.mark.parametrize(
    "needle",
    [
        "candidate key",
        "material fields",
        "`transaction_status`",
        "`total_cost`",
        "fingerprint",
        "NEW",
        "MATCH",
        "COLLISION",
        "several candidates",
        "provenance",
        "observation",
        "snapshot",
        "one database transaction",
    ],
)
def test_identity_behaviour_is_recorded(needle):
    assert needle in IDENTITY_RECORD.read_text(encoding="utf-8")


def test_identity_behaviour_is_in_words_only():
    text = IDENTITY_RECORD.read_text(encoding="utf-8")
    assert "```" not in text
    assert "def " not in text


def test_identity_behaviour_says_total_cost_is_not_material():
    text = IDENTITY_RECORD.read_text(encoding="utf-8")
    assert "`total_cost` is not" in text


@pytest.mark.parametrize(
    "needle",
    [
        "plan_statement_import",
        "validate_import_plan",
        "insert",
        "link",
        "preserve",
        "one IndexedDB transaction",
        "Python decides, JavaScript persists",
        "bridge",
        "ImportPlanError",
    ],
)
def test_import_plan_behaviour_is_recorded(needle):
    assert needle in IMPORT_PLAN_RECORD.read_text(encoding="utf-8")


@pytest.mark.parametrize(
    ("document", "needle"),
    [
        ("PORT_MAP.md", "reconciliation/import_plan.py"),
        ("PORT_MAP.md", "`plan_statement_import`"),
        ("TOUR.md", "plan_statement_import"),
        ("DEBUGGING.md", "test_identity.py"),
        ("DEBUGGING.md", "test_import_plan.py"),
        ("DEBUGGING.md", "ImportPlanError"),
    ],
)
def test_maintainer_docs_cover_identity_and_the_import_plan(document, needle):
    assert needle in (DOCS / document).read_text(encoding="utf-8")


@pytest.mark.parametrize(
    "name",
    ["candidate key", "material fingerprint", "collision", "import plan", "resolve_identity"],
)
def test_glossary_names_the_cp7b_terms(name):
    assert name in (DOCS / "glossary.md").read_text(encoding="utf-8")


def test_decision_index_lists_the_identity_and_import_plan_records():
    index = (DECISIONS / "README.md").read_text(encoding="utf-8")
    assert "identity-behaviour.md" in index
    assert "import-plan-behaviour.md" in index


def test_cp8_notes_record_the_measured_desktop_limits():
    notes = (DECISIONS / "cp8-notes.md").read_text(encoding="utf-8")
    section = notes.split("## Desktop limits (CP8a)", 1)[1].split("\n## ", 1)[0]
    for needle in ("F-LARGE", "5,700", "peak_rss_bytes", "10 MiB", "300 pages", "600 s", "phone"):
        assert needle in section


def test_readme_says_phone_unverified():
    assert "phone unverified" in (REPO / "README.md").read_text(encoding="utf-8").lower()


def test_decision_index_lists_the_csp_record():
    record = next(DECISIONS.glob("0013-*.md")).read_text(encoding="utf-8")
    assert "'unsafe-eval'" in record
    assert "OQ-08" in record
    assert "0013" in (DECISIONS / "README.md").read_text(encoding="utf-8")
