"""The core's import plan agrees with an independent one on overlapping synthetic statements.

The transactions come from the committed synthetic fixtures through the real pipeline. The
independent planner (``tools/synth/import_ledger.py``) shares nothing with the core.
"""

import json
import random

import pytest

from conftest import REPO
from mpesa_core import pipeline
from mpesa_core.reconciliation.import_plan import plan_statement_import
from synth.import_ledger import plan_import, stored_after

FIXTURES = REPO / "tests" / "fixtures" / "synthetic"
OVERLAPPING = ["F-GOLDEN", "F-TIES", "F-MULTIPAGE", "F-CHAIN-BREAK"]


def transactions_of(name):
    pages = json.loads((FIXTURES / f"{name}.items.json").read_text(encoding="utf-8"))
    return pipeline.run(pages)["transactions"]


def overlapping_statements(name):
    """Two statements sharing their middle third, the second with one collision and one repeat."""
    transactions = transactions_of(name)
    third = len(transactions) // 3
    first = transactions[: 2 * third]
    second = [dict(row) for row in transactions[third:]]
    second[0]["balance"] += 1.0
    second.append(dict(second[-1]))
    return first, second


@pytest.mark.parametrize("name", OVERLAPPING)
def test_the_first_import_agrees_with_the_independent_planner(name):
    first, _ = overlapping_statements(name)
    assert plan_statement_import(first, []) == plan_import(first, [])


@pytest.mark.parametrize("name", OVERLAPPING)
def test_the_overlapping_import_agrees_with_the_independent_planner(name):
    first, second = overlapping_statements(name)
    stored = stored_after(plan_import(first, []), first, [])
    core_plan = plan_statement_import(second, stored)
    assert core_plan == plan_import(second, stored)
    assert core_plan["counts"]["collided"] >= 1
    assert core_plan["counts"]["matched"] >= len(first) - len(transactions_of(name)) // 3 - 1


@pytest.mark.parametrize("seed", range(10))
def test_shuffled_and_altered_statements_agree(seed):
    rng = random.Random(seed)
    transactions = transactions_of("F-GOLDEN")
    first = rng.sample(transactions, 30)
    second = [dict(row) for row in rng.sample(transactions, 30)]
    for row in rng.sample(second, 5):
        field = rng.choice(["balance", "details", "status", "completion_time"])
        row[field] = row[field] + 1.0 if field == "balance" else f"{row[field]} changed"
    second += [dict(row) for row in rng.sample(second, 3)]
    stored = stored_after(plan_import(first, []), first, [])
    assert plan_statement_import(second, stored) == plan_import(second, stored)
