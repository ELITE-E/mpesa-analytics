"""Transaction identity (CP7b): NEW, MATCH or COLLISION, decided without storing anything.

The thirteen behaviour names come from the old ``test_transaction_identity.py``; the records are
F-RECORDS, invented. Behaviour in words: ``docs/decisions/identity-behaviour.md``.
"""

import copy
import json

import pytest
from synthetic_records import (
    BASE_RECORD,
    CANDIDATE_KEY_CHANGES,
    NON_KEY_MATERIAL_CHANGES,
    record,
)

from mpesa_core.reconciliation.identity import (
    CANDIDATE_KEY,
    COLLISION,
    COLLISION_CATEGORY,
    MATCH,
    MATERIAL_FIELDS,
    NEW,
    fingerprint,
    resolve_identity,
)


def test_no_existing_transactions_resolves_as_new():
    resolution = resolve_identity(record(1), [])
    assert resolution["outcome"] == NEW
    assert resolution["matched_index"] is None
    assert resolution["candidate_indices"] == []


def test_same_receipt_no_with_different_event_type_resolves_as_new():
    existing = record(1)
    incoming = record(1, event_type="FEE")
    assert resolve_identity(incoming, [existing])["outcome"] == NEW


def test_resolution_does_not_insert_the_incoming_transaction():
    candidates = [record(2)]
    incoming = record(1)
    before = (copy.deepcopy(candidates), copy.deepcopy(incoming))
    resolve_identity(incoming, candidates)
    assert (candidates, incoming) == before
    assert len(candidates) == 1


def test_repeated_observation_identifies_the_existing_transaction():
    existing = [record(3), record(1), record(4)]
    resolution = resolve_identity(record(1), existing)
    assert resolution["outcome"] == MATCH
    assert resolution["matched_index"] == 1


def test_all_material_fields_equal_is_a_match():
    incoming = record(1)
    existing = {
        field: incoming[field] if field in MATERIAL_FIELDS else "Example other"
        for field in BASE_RECORD
    }
    assert resolve_identity(incoming, [existing])["outcome"] == MATCH


def test_total_cost_is_not_part_of_the_material_fingerprint():
    assert "total_cost" not in MATERIAL_FIELDS
    incoming = record(1, total_cost=455.0)
    assert fingerprint(incoming) == fingerprint(record(1))
    assert resolve_identity(incoming, [record(1)])["outcome"] == MATCH


def test_same_key_with_different_material_field_is_a_collision():
    resolution = resolve_identity(record(1, balance=9.0), [record(1)])
    assert resolution["outcome"] == COLLISION
    assert resolution["matched_index"] is None
    assert resolution["candidate_indices"] == [0]
    assert resolution["anomaly"] == COLLISION_CATEGORY


def test_collision_leaves_the_existing_transaction_untouched():
    existing = [record(1)]
    before = copy.deepcopy(existing)
    resolve_identity(record(1, paid_out=1.0), existing)
    assert existing == before


def test_multiple_candidates_selects_the_exact_fingerprint_match():
    existing = [record(1, balance=7.0), record(2), record(1), record(1, balance=8.0)]
    resolution = resolve_identity(record(1), existing)
    assert resolution["outcome"] == MATCH
    assert resolution["matched_index"] == 2
    assert resolution["candidate_indices"] == [0, 2, 3]


def test_multiple_candidates_without_fingerprint_match_is_a_collision():
    existing = [record(1, balance=7.0), record(2), record(1, balance=8.0)]
    resolution = resolve_identity(record(1), existing)
    assert resolution["outcome"] == COLLISION
    assert resolution["candidate_indices"] == [0, 2]


def test_field_mutations_cover_every_non_key_material_field():
    non_key = set(MATERIAL_FIELDS) - set(CANDIDATE_KEY)
    assert set(NON_KEY_MATERIAL_CHANGES) == non_key
    assert set(CANDIDATE_KEY_CHANGES) == set(CANDIDATE_KEY)
    assert "status" in MATERIAL_FIELDS


@pytest.mark.parametrize("number", range(1, 21))
@pytest.mark.parametrize("field", sorted(NON_KEY_MATERIAL_CHANGES))
def test_changing_any_single_material_field_breaks_the_match(field, number):
    original = record(number)
    changed = {**original, field: NON_KEY_MATERIAL_CHANGES[field]}
    assert changed[field] != original[field]
    assert resolve_identity(original, [original])["outcome"] == MATCH
    assert resolve_identity(changed, [original])["outcome"] == COLLISION


@pytest.mark.parametrize("field", sorted(CANDIDATE_KEY_CHANGES))
def test_changing_a_candidate_key_field_resolves_as_new(field):
    changed = record(1, **{field: CANDIDATE_KEY_CHANGES[field]})
    assert resolve_identity(changed, [record(1)])["outcome"] == NEW


def test_the_candidate_key_and_material_fields_are_the_old_ones_by_our_names():
    assert CANDIDATE_KEY == ("receipt_no", "event_type")
    assert MATERIAL_FIELDS == (
        "receipt_no",
        "event_type",
        "completion_time",
        "details",
        "status",
        "paid_in",
        "paid_out",
        "balance",
    )


@pytest.mark.parametrize(
    "field", ["withdrawn", "cash_flow_direction", "economic_meaning", "entity"]
)
def test_derived_fields_do_not_break_a_match(field):
    changed = record(1, **{field: "Example changed"})
    assert resolve_identity(changed, [record(1)])["outcome"] == MATCH


def test_the_fingerprint_is_the_material_values_in_order():
    incoming = record(1)
    assert fingerprint(incoming) == tuple(incoming[field] for field in MATERIAL_FIELDS)


def test_several_exact_matches_choose_the_earliest():
    resolution = resolve_identity(record(1), [record(2), record(1), record(1)])
    assert resolution["matched_index"] == 1


def test_the_resolution_holds_plain_json_values():
    resolution = resolve_identity(record(1, balance=9.0), [record(1)])
    assert json.loads(json.dumps(resolution)) == resolution
    assert type(resolution["outcome"]) is str
