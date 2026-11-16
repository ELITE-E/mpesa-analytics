"""The import plan (CP7b): what the browser store must do with one statement's rows.

Python decides, JavaScript persists: the plan is a pure description, applied by the store (CP9)
in one IndexedDB transaction. The first four behaviour names come from the old
``test_collision_preservation.py``; the records are F-RECORDS, invented.
"""

import copy
import json

import pytest
from synthetic_records import record, statement

from mpesa_core.errors import CoreError, ImportPlanCode, ImportPlanError
from mpesa_core.reconciliation.identity import COLLISION_CATEGORY
from mpesa_core.reconciliation.import_plan import (
    EXISTING,
    INCOMING,
    INSERT,
    LINK,
    PRESERVE,
    plan_statement_import,
    validate_import_plan,
)


def stored_after(plan, incoming_rows, existing_transactions):
    """What a store holds once it applies a plan: inserted and preserved rows join the end."""
    added = [
        incoming_rows[action["row_index"]]
        for action in plan["actions"]
        if action["action"] in (INSERT, PRESERVE)
    ]
    return [*existing_transactions, *added]


def test_collision_preserves_both_rows_and_leaves_the_original_unchanged():
    existing = [record(1)]
    before = copy.deepcopy(existing)
    incoming = [record(1, balance=9.0)]
    plan = plan_statement_import(incoming, existing)
    assert plan["actions"][0]["action"] == PRESERVE
    assert plan["actions"][0]["collides_with"] == [{"source": EXISTING, "index": 0}]
    assert existing == before
    assert len(stored_after(plan, incoming, existing)) == 2


def test_collision_records_a_domain_observation():
    plan = plan_statement_import([record(1, balance=9.0)], [record(1)])
    assert plan["actions"][0]["observation"] == {"category": COLLISION_CATEGORY}


def test_collision_with_multiple_candidates_preserves_every_row():
    existing = [record(1, balance=7.0), record(2), record(1, balance=8.0)]
    incoming = [record(1, balance=9.0)]
    plan = plan_statement_import(incoming, existing)
    action = plan["actions"][0]
    assert action["action"] == PRESERVE
    assert action["collides_with"] == [
        {"source": EXISTING, "index": 0},
        {"source": EXISTING, "index": 2},
    ]
    assert stored_after(plan, incoming, existing)[:3] == existing
    assert len(stored_after(plan, incoming, existing)) == 4


def test_preserving_a_non_collision_is_rejected():
    incoming = [record(1), record(2)]
    plan = plan_statement_import(incoming, [record(2)])
    plan["actions"][0] = {
        **plan["actions"][0],
        "action": PRESERVE,
        "observation": {"category": COLLISION_CATEGORY},
    }
    with pytest.raises(ImportPlanError) as caught:
        validate_import_plan(plan, incoming, [record(2)])
    assert caught.value.code is ImportPlanCode.PRESERVE_NOT_COLLISION
    assert caught.value.row_index == 0


def test_importing_the_same_statement_twice_matches_every_row():
    rows = statement(1, 12)
    first = plan_statement_import(rows, [])
    stored = stored_after(first, rows, [])
    second = plan_statement_import(rows, stored)
    assert first["counts"] == {"new": 12, "matched": 0, "collided": 0}
    assert second["counts"] == {"new": 0, "matched": 12, "collided": 0}
    assert [action["target"] for action in second["actions"]] == [
        {"source": EXISTING, "index": index} for index in range(12)
    ]


def test_overlapping_statements_insert_only_the_new_rows():
    stored = stored_after(plan_statement_import(statement(1, 10), []), statement(1, 10), [])
    plan = plan_statement_import(statement(6, 15), stored)
    assert plan["counts"] == {"new": 5, "matched": 5, "collided": 0}
    inserted = [action["row_index"] for action in plan["actions"] if action["action"] == INSERT]
    assert inserted == [5, 6, 7, 8, 9]


def test_every_row_in_a_plan_has_exactly_one_action():
    existing = [record(1), record(2, balance=1.0)]
    incoming = [record(1), record(2), record(3), record(3), record(3, balance=5.0)]
    plan = plan_statement_import(incoming, existing)
    assert [action["row_index"] for action in plan["actions"]] == list(range(len(incoming)))
    assert all(action["action"] in (INSERT, LINK, PRESERVE) for action in plan["actions"])
    counts = plan["counts"]
    assert counts["new"] + counts["matched"] + counts["collided"] == len(incoming)


def test_a_row_repeated_within_one_statement_links_to_its_first_copy():
    incoming = [record(1), record(1)]
    plan = plan_statement_import(incoming, [])
    assert [action["action"] for action in plan["actions"]] == [INSERT, LINK]
    assert plan["actions"][1]["target"] == {"source": INCOMING, "index": 0}


def test_a_collision_within_one_statement_collides_with_the_earlier_row():
    incoming = [record(1), record(1, balance=9.0)]
    plan = plan_statement_import(incoming, [record(5)])
    assert plan["actions"][1]["action"] == PRESERVE
    assert plan["actions"][1]["collides_with"] == [{"source": INCOMING, "index": 0}]


def test_a_preserved_row_is_a_candidate_for_later_rows():
    incoming = [record(1, balance=9.0), record(1, balance=9.0)]
    plan = plan_statement_import(incoming, [record(1)])
    assert plan["actions"][1]["action"] == LINK
    assert plan["actions"][1]["target"] == {"source": INCOMING, "index": 0}


def test_an_exact_match_among_existing_and_incoming_rows_prefers_the_stored_one():
    incoming = [record(1, balance=9.0), record(1)]
    plan = plan_statement_import(incoming, [record(1)])
    assert plan["actions"][1]["target"] == {"source": EXISTING, "index": 0}


def test_insert_and_link_actions_carry_no_collision():
    plan = plan_statement_import([record(1), record(2)], [record(2)])
    for action in plan["actions"]:
        assert action["collides_with"] == []
        assert action["observation"] is None
    assert plan["actions"][0]["target"] is None


def test_planning_changes_neither_input():
    incoming, existing = [record(1, balance=9.0), record(2)], [record(1)]
    before = copy.deepcopy((incoming, existing))
    plan_statement_import(incoming, existing)
    assert (incoming, existing) == before


def test_an_empty_statement_plans_nothing():
    assert plan_statement_import([], [record(1)]) == {
        "actions": [],
        "counts": {"new": 0, "matched": 0, "collided": 0},
    }


def test_the_plan_holds_plain_json_values_and_no_row_values():
    incoming = [record(1, balance=9.0), record(2)]
    plan = plan_statement_import(incoming, [record(1)])
    assert json.loads(json.dumps(plan)) == plan
    serialized = json.dumps(plan)
    for value in ("ZZREC", "Example", "1550", "Completed"):
        assert value not in serialized


def test_a_plan_made_by_the_core_is_valid():
    incoming, existing = [record(1, balance=9.0), record(2), record(2)], [record(1)]
    plan = plan_statement_import(incoming, existing)
    assert validate_import_plan(plan, incoming, existing) is None


@pytest.mark.parametrize("change", ["missing", "duplicate"])
def test_a_plan_without_exactly_one_action_per_row_is_rejected(change):
    incoming = [record(1), record(2)]
    plan = plan_statement_import(incoming, [])
    actions = plan["actions"]
    plan["actions"] = actions[:1] if change == "missing" else [actions[0], actions[0], actions[1]]
    with pytest.raises(ImportPlanError) as caught:
        validate_import_plan(plan, incoming, [])
    assert caught.value.code is ImportPlanCode.ROW_ACTION_COUNT


def test_a_plan_linking_to_the_wrong_row_is_rejected():
    incoming = [record(1)]
    existing = [record(1), record(2)]
    plan = plan_statement_import(incoming, existing)
    plan["actions"][0]["target"] = {"source": EXISTING, "index": 1}
    with pytest.raises(ImportPlanError) as caught:
        validate_import_plan(plan, incoming, existing)
    assert caught.value.code is ImportPlanCode.PLAN_MISMATCH
    assert caught.value.row_index == 0


@pytest.mark.parametrize("side", ["incoming", "existing"])
def test_a_row_missing_a_material_field_is_a_typed_error_naming_its_position(side):
    broken = record(2)
    del broken["balance"]
    rows = {"incoming": [record(1), broken], "existing": []}
    if side == "existing":
        rows = {"incoming": [record(1)], "existing": [record(3), broken]}
    with pytest.raises(ImportPlanError) as caught:
        plan_statement_import(rows["incoming"], rows["existing"])
    expected = {
        "incoming": ImportPlanCode.INCOMING_ROW_INVALID,
        "existing": ImportPlanCode.EXISTING_ROW_INVALID,
    }[side]
    assert caught.value.code is expected
    assert caught.value.row_index == 1


def test_a_row_that_is_not_a_record_is_a_typed_error():
    with pytest.raises(ImportPlanError) as caught:
        plan_statement_import(["ZZ" + "REC00001"], [])
    assert caught.value.code is ImportPlanCode.INCOMING_ROW_INVALID
    assert "ZZREC" not in str(caught.value)


def test_import_plan_errors_are_core_errors_carrying_codes_and_positions_only():
    error = ImportPlanError(ImportPlanCode.PLAN_MISMATCH, row_index=3)
    assert isinstance(error, CoreError)
    assert str(error) == "PLAN_MISMATCH at row 3"
    assert str(ImportPlanError(ImportPlanCode.REQUEST_INVALID)) == "REQUEST_INVALID"
    with pytest.raises(TypeError):
        ImportPlanError("PLAN_MISMATCH")
    with pytest.raises(TypeError):
        ImportPlanError(ImportPlanCode.PLAN_MISMATCH, row_index="ZZ" + "REC00001")
