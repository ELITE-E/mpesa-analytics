"""The bridge: run and import plan calls, JSON text in and out, errors with no values."""

import importlib
import json
import sys

import pytest
from statement_pages import attestable_statement, footer_items
from synthetic_records import record, statement

from mpesa_core import bridge, pipeline
from mpesa_core.errors import ImportPlanCode, ImportPlanError
from mpesa_core.reconciliation.import_plan import plan_statement_import


def request(incoming_rows, existing_transactions, **extra):
    return json.dumps(
        {
            "incoming_rows": incoming_rows,
            "existing_transactions": existing_transactions,
            **extra,
        }
    )


def test_the_bridge_returns_the_core_plan_as_json_text():
    incoming, existing = [record(1, balance=9.0), *statement(2, 4)], statement(1, 3)
    answer = bridge.plan_statement_import_json(request(incoming, existing))
    assert type(answer) is str
    assert json.loads(answer) == plan_statement_import(incoming, existing)


def test_the_bridge_validates_a_plan_it_is_given():
    incoming, existing = statement(1, 3), statement(2, 2)
    plan = plan_statement_import(incoming, existing)
    answer = bridge.validate_import_plan_json(request(incoming, existing, plan=plan))
    assert json.loads(answer) == {"valid": True}


def test_the_bridge_rejects_a_tampered_plan_with_a_typed_error():
    incoming, existing = statement(1, 2), []
    plan = plan_statement_import(incoming, existing)
    plan["actions"][1]["action"] = "preserve"
    with pytest.raises(ImportPlanError) as caught:
        bridge.validate_import_plan_json(request(incoming, existing, plan=plan))
    assert caught.value.code is ImportPlanCode.PRESERVE_NOT_COLLISION


@pytest.mark.parametrize(
    "text",
    [
        "not json " + "ZZ" + "REC00001",
        json.dumps(["ZZ" + "REC00001"]),
        json.dumps({"incoming_rows": []}),
        json.dumps({"incoming_rows": "ZZ" + "REC00001", "existing_transactions": []}),
        json.dumps({"incoming_rows": [], "existing_transactions": [], "extra": 1}),
    ],
)
def test_a_malformed_request_is_a_typed_error_that_repeats_nothing(text):
    with pytest.raises(ImportPlanError) as caught:
        bridge.plan_statement_import_json(text)
    assert caught.value.code is ImportPlanCode.REQUEST_INVALID
    assert "ZZREC" not in str(caught.value)


def test_a_validation_request_without_a_plan_is_malformed():
    with pytest.raises(ImportPlanError) as caught:
        bridge.validate_import_plan_json(request([], []))
    assert caught.value.code is ImportPlanCode.REQUEST_INVALID


def test_a_bad_row_inside_a_request_keeps_its_own_code():
    broken = record(1)
    del broken["details"]
    with pytest.raises(ImportPlanError) as caught:
        bridge.plan_statement_import_json(request([broken], []))
    assert caught.value.code is ImportPlanCode.INCOMING_ROW_INVALID


# run_json: statement pages JSON text in, an envelope of JSON text out (CP8a).


def run_envelope(statement_pages, processed_at=None):
    answer = bridge.run_json(json.dumps(statement_pages), processed_at)
    assert type(answer) is str
    return json.loads(answer)


def test_run_json_returns_the_pipeline_result_in_an_ok_envelope(printed):
    pages = attestable_statement(printed)
    envelope = run_envelope(pages, "2026-11-16T09:00:00Z")
    assert envelope == {
        "ok": True,
        # Through JSON, as the browser sees it: integer keys become text.
        "pipeline_result": json.loads(
            json.dumps(pipeline.run(pages, processed_at="2026-11-16T09:00:00Z"))
        ),
    }


def test_run_json_turns_an_attestation_error_into_its_code(printed):
    pages = attestable_statement(printed, footer=footer_items(printed, text="Example footer"))
    envelope = run_envelope(pages)
    assert envelope == {"ok": False, "error": {"code": "BRAND_MISSING", "row_index": None}}


def test_run_json_turns_layout_unrecognized_into_its_code(printed):
    envelope = run_envelope(attestable_statement(printed, []))
    assert envelope["error"] == {"code": "LAYOUT_UNRECOGNIZED", "row_index": None}


def test_run_json_turns_a_domain_row_error_into_its_position_only(printed):
    rows = printed.calibrating_rows()
    rows += printed.row_items(9, 140.0, cells={"paid_in": "1.00", "withdrawn": "1.00"})
    envelope = run_envelope(attestable_statement(printed, rows))
    assert envelope == {"ok": False, "error": {"code": "DOMAIN_ROW", "row_index": 4}}


@pytest.mark.parametrize(
    "text",
    ["not json " + "ZZ" + "REC00001", json.dumps(["ZZ" + "REC00001"]), json.dumps({"pages": 1})],
)
def test_run_json_answers_a_malformed_request_with_a_code_and_repeats_nothing(text):
    answer = bridge.run_json(text, None)
    assert json.loads(answer) == {
        "ok": False,
        "error": {"code": "REQUEST_INVALID", "row_index": None},
    }
    assert "ZZREC" not in answer


def test_run_json_says_when_the_analysis_runtime_is_not_loaded_yet(printed):
    pages = json.dumps(attestable_statement(printed))
    watched = [name for name in sys.modules if name.partition(".")[0] in ("mpesa_core", "pandas")]
    saved = {name: sys.modules.pop(name) for name in watched}
    sys.modules["pandas"] = None
    try:
        answer = importlib.import_module("mpesa_core.bridge").run_json(pages, None)
    finally:
        for name in [
            name for name in sys.modules if name.partition(".")[0] in ("mpesa_core", "pandas")
        ]:
            del sys.modules[name]
        sys.modules.update(saved)
    assert json.loads(answer) == {
        "ok": False,
        "error": {"code": "ANALYSIS_RUNTIME_MISSING", "row_index": None},
    }


def test_run_json_error_envelopes_hold_no_page_text(printed):
    rows = printed.calibrating_rows()
    rows += printed.row_items(9, 140.0, cells={"paid_in": "1.00", "withdrawn": "1.00"})
    answer = bridge.run_json(json.dumps(attestable_statement(printed, rows)), None)
    assert "Example" not in answer
    assert "1.00" not in answer
