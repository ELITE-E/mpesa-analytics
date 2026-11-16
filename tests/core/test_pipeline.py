"""pipeline.run: statement pages to the pipeline_result, as the composition of the stages (CP7a)."""

import copy
import inspect
import json

import pytest
from fresh_imports import pandas_loaded_by_running
from statement_pages import TOKEN, attestable_statement, footer_items, transfer_row

from mpesa_core import pipeline
from mpesa_core.analysis import analyze_transactions
from mpesa_core.classification.classify import classify_transactions
from mpesa_core.cleaning.canonicalize import canonicalize_rows
from mpesa_core.contracts import SCHEMA_VERSION
from mpesa_core.errors import (
    AnalysisCode,
    AnalysisError,
    AttestationCode,
    AttestationError,
    DomainRowError,
    ErrorCode,
    ExtractionError,
)
from mpesa_core.extraction.rows import build_rows
from mpesa_core.reconciliation.account import account_digest
from mpesa_core.reconciliation.attest import attest
from mpesa_core.reconciliation.reconcile import measure_balances, measure_unclassified, reconcile

MONEY_IN = {"paid_in": "10.00", "withdrawn": None}
JSON_TYPES = (str, int, float, bool, type(None), list, dict)
RESULT_FIELDS = {
    "schema_version",
    "verification_token",
    "account_digest",
    "processed_at",
    "period",
    "balances",
    "transactions",
    "report",
    "quality",
    "diagnostics",
}


def composed(statement_pages, processed_at=None):
    """The stages called one by one, as run() is meant to call them."""
    token = attest(statement_pages)
    rows = build_rows(statement_pages)
    transactions, diagnostics = classify_transactions(canonicalize_rows(rows))
    report = analyze_transactions(transactions)
    digest = account_digest(statement_pages)
    quality = {
        **reconcile(statement_pages, rows),
        **measure_unclassified(transactions),
        "account_number_unreadable": digest is None,
    }
    return {
        "schema_version": SCHEMA_VERSION,
        "verification_token": token,
        "account_digest": digest,
        "processed_at": processed_at,
        "period": pipeline.measure_period(transactions),
        "balances": measure_balances(rows, quality["chain_orientation"]),
        "transactions": transactions,
        "report": report,
        "quality": quality,
        "diagnostics": diagnostics,
    }


def assert_json_native(value, path="result"):
    assert type(value) in JSON_TYPES, path
    if isinstance(value, dict):
        for key, element in value.items():
            assert type(key) in (str, int), f"{path} key"
            assert_json_native(element, f"{path}.{key}")
    if isinstance(value, list):
        for position, element in enumerate(value):
            assert_json_native(element, f"{path}[{position}]")


def test_run_equals_the_composition_of_the_stages(printed):
    pages = attestable_statement(printed)
    assert pipeline.run(pages) == composed(pages)


def test_result_has_exactly_the_contract_fields(printed):
    assert set(pipeline.run(attestable_statement(printed))) == RESULT_FIELDS


def test_result_carries_the_verification_token(printed):
    assert pipeline.run(attestable_statement(printed))["verification_token"] == TOKEN


def test_result_carries_the_unclassified_counts_in_quality(printed):
    quality = pipeline.run(attestable_statement(printed))["quality"]
    assert quality["row_count"] == 4
    assert {"unclassified_rows", "unclassified_share"} <= set(quality)


def test_report_keys_are_the_old_ones_and_hold_no_balances_field(printed):
    report = pipeline.run(attestable_statement(printed))["report"]
    assert list(report) == ["cash_flow", "spending", "bills", "investments", "transfers", "fees"]
    assert "balances" not in report
    assert "opening_balance" not in report["cash_flow"]


def test_balances_follow_print_order(printed):
    balances = pipeline.run(attestable_statement(printed))["balances"]
    assert balances == {"opening_balance": 91.0, "closing_balance": 100.0}


def test_period_spans_the_readable_completion_times(printed):
    rows = transfer_row(printed, 0, 100.0, time="2026-02-03 09:00:00", cells={"balance": "90.00"})
    rows += transfer_row(printed, 1, 110.0, time="2026-01-05 10:00:00", cells=MONEY_IN)
    rows += printed.calibrating_rows(120.0, first_position=2)
    period = pipeline.run(attestable_statement(printed, rows))["period"]
    assert period == {"start": "2026-01-05 10:00:00", "end": "2026-02-03 09:00:00"}


def test_period_skips_times_that_cannot_be_read():
    transactions = [
        {"completion_time": "2026-01-05 10:00:00"},
        {"completion_time": "2026-13-45 99:99:99"},
        {"completion_time": "2026-01-07 10:00:00"},
    ]
    assert pipeline.measure_period(transactions) == {
        "start": "2026-01-05 10:00:00",
        "end": "2026-01-07 10:00:00",
    }


def test_period_without_a_readable_time_is_empty():
    assert pipeline.measure_period([]) == {"start": None, "end": None}


def test_an_injected_time_is_carried_and_no_clock_is_read(printed):
    pages = attestable_statement(printed)
    assert pipeline.run(pages)["processed_at"] is None
    stamped = pipeline.run(pages, processed_at="2026-11-13T09:00:00Z")
    assert stamped["processed_at"] == "2026-11-13T09:00:00Z"
    assert pipeline.run(pages) == pipeline.run(pages)


def test_result_is_json_serializable_with_plain_values_only(printed):
    pipeline_result = pipeline.run(attestable_statement(printed))
    assert_json_native(pipeline_result)
    json.dumps(pipeline_result, allow_nan=False)


def test_result_holds_no_bytes_or_password_even_if_the_pages_carry_them(printed):
    pages = {
        **attestable_statement(printed),
        "password": "planted-password",
        "pdf_bytes": b"%PDF-planted",
    }
    pipeline_result = pipeline.run(pages)
    assert "planted-password" not in repr(pipeline_result)
    assert "PDF-planted" not in repr(pipeline_result)
    assert_json_native(pipeline_result)


def test_run_takes_no_pdf_bytes_and_no_password():
    parameters = inspect.signature(pipeline.run).parameters
    assert list(parameters) == ["statement_pages", "processed_at"]
    assert parameters["processed_at"].kind is inspect.Parameter.KEYWORD_ONLY


def test_run_does_not_change_the_pages(printed):
    pages = attestable_statement(printed)
    before = copy.deepcopy(pages)
    pipeline.run(pages)
    assert pages == before


def test_unbranded_pages_raise_an_attestation_error_before_rows_are_read(printed):
    pages = attestable_statement(printed, [], footer=footer_items(printed, text="Example footer"))
    with pytest.raises(AttestationError) as caught:
        pipeline.run(pages)
    assert caught.value.code is AttestationCode.BRAND_MISSING


def test_pages_without_rows_raise_layout_unrecognized(printed):
    with pytest.raises(ExtractionError) as caught:
        pipeline.run(attestable_statement(printed, []))
    assert caught.value.code is ErrorCode.LAYOUT_UNRECOGNIZED


def test_a_row_with_both_amounts_raises_a_domain_row_error(printed):
    rows = printed.calibrating_rows()
    rows += printed.row_items(9, 140.0, cells={"paid_in": "1.00", "withdrawn": "1.00"})
    with pytest.raises(DomainRowError):
        pipeline.run(attestable_statement(printed, rows))


def test_an_unreadable_date_raises_an_analysis_error(printed):
    rows = transfer_row(printed, 0, 100.0, time="2026-01-05 10:00:00", cells={"balance": "90.00"})
    rows += transfer_row(printed, 1, 110.0, time="2026-13-45 99:99:99", cells=MONEY_IN)
    rows += printed.calibrating_rows(120.0, first_position=2)
    with pytest.raises(AnalysisError) as caught:
        pipeline.run(attestable_statement(printed, rows))
    assert caught.value.code is AnalysisCode.DATE_UNREADABLE


def test_importing_the_pipeline_leaves_pandas_unloaded():
    assert not pandas_loaded_by_running(lambda load: load("mpesa_core.pipeline"))


def test_a_run_that_stops_before_analysis_leaves_pandas_unloaded(printed):
    pages = attestable_statement(printed, [])

    def run_until_it_stops(load):
        core_error = load("mpesa_core.errors").CoreError
        with pytest.raises(core_error):
            load("mpesa_core.pipeline").run(pages)

    assert not pandas_loaded_by_running(run_until_it_stops)


def test_a_run_that_reaches_analysis_loads_pandas(printed):
    pages = attestable_statement(printed)
    assert pandas_loaded_by_running(lambda load: load("mpesa_core.pipeline").run(pages))


def with_mobile_number(statement_pages, printed, text):
    page_one = statement_pages["pages"][0]
    page_one["items"].append(printed.left_item(f"Mobile Number: {text}", 20.0, 20.0))
    return statement_pages


def test_result_carries_the_digest_of_page_one_mobile_number(printed):
    number = "07000000" + "03"
    pages = with_mobile_number(attestable_statement(printed), printed, number)
    pipeline_result = pipeline.run(pages)
    assert pipeline_result["account_digest"] == account_digest(pages)
    assert pipeline_result["account_digest"] is not None
    assert pipeline_result["quality"]["account_number_unreadable"] is False
    assert number not in repr(pipeline_result)
    assert number[1:] not in repr(pipeline_result)


def test_an_unreadable_mobile_number_gives_no_digest_and_a_quality_flag(printed):
    pipeline_result = pipeline.run(attestable_statement(printed))
    assert pipeline_result["account_digest"] is None
    assert pipeline_result["quality"]["account_number_unreadable"] is True
