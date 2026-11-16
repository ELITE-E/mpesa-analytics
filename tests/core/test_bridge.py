"""The bridge's import plan calls: JSON text in, JSON text out, typed errors with no values."""

import json

import pytest
from synthetic_records import record, statement

from mpesa_core import bridge
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
