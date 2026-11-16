"""Fixtures carry grammar-readable details for every event type, tagged by the generator (CP7a)."""

import json

import pytest

from conftest import REPO
from mpesa_core.analysis import analyze_transactions
from mpesa_core.classification.classify import classify_transactions
from mpesa_core.cleaning.canonicalize import canonicalize_rows
from mpesa_core.extraction.rows import build_rows
from synth.generate import COMMITTED_FIXTURES

FIXTURES = REPO / "tests" / "fixtures" / "synthetic"
WITH_ROWS = sorted(set(COMMITTED_FIXTURES) - {"F-NOTABLE"})
EVENT_TYPES = {
    "MERCHANT_PAYMENT",
    "BILL_PAYMENT",
    "TRANSFER_IN",
    "TRANSFER_OUT",
    "AIRTIME_PURCHASE",
    "BUNDLE_PURCHASE",
    "INVESTMENT",
    "FEE",
    "REVERSAL",
    "DEPOSIT",
    "UNCLASSIFIED",
}
SPENDING = {"MERCHANT_PAYMENT", "BILL_PAYMENT", "BUNDLE_PURCHASE"}


def ledger_rows(name):
    """Each printed row, with the event type and entity the generator recorded for it."""
    expected = json.loads((FIXTURES / f"{name}.expected.json").read_text(encoding="utf-8"))
    return [
        {**row, **built} for row, built in zip(expected["rows"], expected["built"], strict=True)
    ]


def classified(name):
    pages = json.loads((FIXTURES / f"{name}.items.json").read_text(encoding="utf-8"))
    return classify_transactions(canonicalize_rows(build_rows(pages)))[0]


def invented_spending_entities(name):
    return {
        row["entity"]
        for row in ledger_rows(name)
        if row["event_type"] in SPENDING and row["entity"] is not None
    }


WITH_SPENDING_ENTITIES = [name for name in WITH_ROWS if invented_spending_entities(name)]


@pytest.mark.parametrize("name", WITH_ROWS)
def test_the_ledger_records_an_event_type_and_entity_for_every_row(name):
    for row in ledger_rows(name):
        assert row["event_type"] in EVENT_TYPES
        assert "entity" in row


@pytest.mark.parametrize("name", WITH_ROWS)
def test_classify_agrees_with_the_event_type_the_generator_built(name):
    built = [row["event_type"] for row in ledger_rows(name)]
    assert [str(row["event_type"]) for row in classified(name)] == built


@pytest.mark.parametrize("name", WITH_ROWS)
def test_entity_extraction_agrees_with_the_entity_the_generator_invented(name):
    invented = [row["entity"] for row in ledger_rows(name)]
    assert [row["entity"] for row in classified(name)] == invented


def test_every_event_type_appears_in_the_fixtures():
    seen = {row["event_type"] for name in WITH_ROWS for row in ledger_rows(name)}
    assert seen == EVENT_TYPES


def test_the_large_fixture_alone_holds_every_event_type():
    assert {row["event_type"] for row in ledger_rows("F-MULTIPAGE")} == EVENT_TYPES


def test_every_invented_entity_is_an_example_name():
    entities = {row["entity"] for name in WITH_ROWS for row in ledger_rows(name)} - {None}
    assert entities
    assert all(entity.startswith("Example ") for entity in entities)


def test_the_golden_fixture_has_spending_with_invented_entities():
    assert "F-GOLDEN" in WITH_SPENDING_ENTITIES


@pytest.mark.parametrize("name", WITH_SPENDING_ENTITIES)
def test_spending_by_entity_holds_exactly_the_invented_spending_entities(name):
    spending = analyze_transactions(classified(name))["spending"]["spending_by_entity"]
    assert spending
    assert {line["entity"] for line in spending} == invented_spending_entities(name)


@pytest.mark.parametrize("name", WITH_SPENDING_ENTITIES)
def test_largest_purchases_are_invented_spending_entities(name):
    largest = analyze_transactions(classified(name))["spending"]["largest_purchases"]
    assert largest
    assert {line["recipient"] for line in largest} <= invented_spending_entities(name)


@pytest.mark.parametrize("name", WITH_ROWS)
def test_every_amount_column_prints_at_least_two_values_so_it_calibrates(name):
    rows = ledger_rows(name)
    for field in ("paid_in", "withdrawn", "balance"):
        assert sum(row[field] is not None for row in rows) >= 2, field
