"""The core's cash flow against the independent ledger, on every fixture that has money."""

import json

import pytest

from conftest import REPO
from mpesa_core.analysis import analyze_transactions
from mpesa_core.classification.classify import classify_transactions
from mpesa_core.cleaning.canonicalize import canonicalize_rows
from mpesa_core.extraction.rows import build_rows
from mpesa_core.reconciliation.reconcile import measure_balances, reconcile
from synth.generate import COMMITTED_FIXTURES

FIXTURES = REPO / "tests" / "fixtures" / "synthetic"
WITH_MONEY = sorted(set(COMMITTED_FIXTURES) - {"F-NOTABLE"})
CENT = 0.005


def ledger(name):
    return json.loads((FIXTURES / f"{name}.expected.json").read_text(encoding="utf-8"))


def core_cash_flow(name):
    pages = json.loads((FIXTURES / f"{name}.items.json").read_text(encoding="utf-8"))
    transactions, _ = classify_transactions(canonicalize_rows(build_rows(pages)))
    return analyze_transactions(transactions)["cash_flow"]


def core_balances(name):
    pages = json.loads((FIXTURES / f"{name}.items.json").read_text(encoding="utf-8"))
    rows = build_rows(pages)
    return measure_balances(rows, reconcile(pages, rows)["chain_orientation"])


def latest_balances(name):
    """Balances of the rows printed at the latest time; more than one means a tie (D-06)."""
    rows = ledger(name)["rows"]
    latest = max(row["completion_time"] for row in rows)
    return [
        float(row["balance"].replace(",", "")) for row in rows if row["completion_time"] == latest
    ]


TIED_AT_THE_LATEST_TIME = [name for name in WITH_MONEY if len(set(latest_balances(name))) > 1]
UNTIED = [name for name in WITH_MONEY if name not in TIED_AT_THE_LATEST_TIME]


@pytest.mark.parametrize("name", WITH_MONEY)
@pytest.mark.parametrize(
    ("figure", "ledger_key"),
    [
        ("total_inflow", "total_inflow"),
        ("total_outflow", "total_outflow"),
        ("net_cash_flow", "net_cash_flow"),
    ],
)
def test_core_cash_flow_equals_the_ledger(name, figure, ledger_key):
    assert core_cash_flow(name)[figure] == pytest.approx(float(ledger(name)[ledger_key]), abs=CENT)


@pytest.mark.parametrize("name", UNTIED)
def test_core_closing_balance_equals_the_ledger(name):
    closing = float(ledger(name)["closing_balance"])
    assert core_cash_flow(name)["closing_balance"] == pytest.approx(closing, abs=CENT)


@pytest.mark.parametrize("name", TIED_AT_THE_LATEST_TIME)
def test_closing_balance_with_a_tied_latest_time_is_the_newest_row_in_print_order(name):
    # D-06: the newest row in print order, in the orientation reconcile reads, never pandas' order.
    closing = float(ledger(name)["closing_balance"])
    assert core_balances(name)["closing_balance"] == pytest.approx(closing, abs=CENT)


@pytest.mark.parametrize("name", WITH_MONEY)
@pytest.mark.parametrize("figure", ["opening_balance", "closing_balance"])
def test_core_balances_equal_the_ledger(name, figure):
    assert core_balances(name)[figure] == pytest.approx(float(ledger(name)[figure]), abs=CENT)


def test_both_kinds_of_fixture_exist():
    assert UNTIED
    assert "F-TIES" in TIED_AT_THE_LATEST_TIME
