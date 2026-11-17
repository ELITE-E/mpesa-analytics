"""The frontend's contract scenarios as synthetic fixtures (CP8b, owner decision A, 2026-11-17).

The scenarios' data came from the old repo's contract fixtures (F1 worked example, F2 tied times,
F3 invalid times, F4 2,345 rows, F5 the IA prototype's sample) and five edge-case statements. The
generator writes each one's ledger in the shape the frontend reads (rows, summary, snapshot) and,
where a statement could print it, a PDF. These tests check the ledgers represent the cases they
are named for; they are the old fixture checks, written again from their behaviour.
"""

import json
import re
from datetime import datetime

import pytest

from synth.generate import SCENARIO_FIXTURES, build_scenario_outputs
from synth.scenario_ledger import api_ledger, fee_linkage
from synth.scenarios import F3_INVALID_TIMES, NO_ENTITY, SCENARIOS

CONTRACT = ["F1-worked-example", "F2-tied-timestamps", "F3-invalid-timestamps"]
CONTRACT += ["F4-paginated-2345", "F5-prototype-converted"]
EDGE_CASES = ["S-stress-overview", "S-no-spending", "S-people-edge-cases"]
EDGE_CASES += ["S-savings-edge-cases", "S-cash-edge-cases"]
LEDGER_ONLY = {"F3-invalid-timestamps", "F4-paginated-2345"}
FAKE_RECEIPT = re.compile(r"ZZ[A-Z0-9]{8}")
AMOUNTS = ("paid_in", "paid_out", "balance", "total_cost")
TIME_FORMATS = ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S")


def cents(value):
    return round(value * 100)


def ledger(name):
    return api_ledger(SCENARIOS[name])


def is_iso_like(text):
    for time_format in TIME_FORMATS:
        try:
            datetime.strptime(text, time_format)
        except ValueError:
            continue
        return True
    return False


def test_every_scenario_is_a_fixture_and_only_statements_that_can_print_have_a_pdf():
    assert sorted(SCENARIO_FIXTURES) == sorted(CONTRACT + EDGE_CASES)
    for name in SCENARIOS:
        outputs = build_scenario_outputs(*SCENARIO_FIXTURES[name])
        expected = {".api.json"} if name in LEDGER_ONLY else {".pdf", ".model.json", ".api.json"}
        assert set(outputs) == expected, name


def test_the_contract_scenarios_take_import_ids_from_their_order():
    for position, name in enumerate(CONTRACT, start=1):
        assert ledger(name)["summary"]["id"] == position
        assert ledger(name)["snapshot"]["import_id"] == position


@pytest.mark.parametrize("name", CONTRACT + EDGE_CASES)
def test_every_ledger_holds_the_hard_integrity_invariants(name):
    rows = ledger(name)["rows"]
    assert [row["id"] for row in rows] == list(range(1, len(rows) + 1))
    assert ledger(name)["summary"]["transaction_count"] == len(rows)
    for row in rows:
        assert all(isinstance(row[field], float) for field in AMOUNTS)
        assert (row["paid_in"] > 0) != (row["paid_out"] > 0)
        assert (row["cash_flow_direction"] == "INFLOW") == (row["paid_in"] > 0)
        assert row["transaction_status"] == "Completed"


@pytest.mark.parametrize("name", CONTRACT + EDGE_CASES)
def test_every_snapshot_agrees_with_its_own_rows(name):
    built = ledger(name)
    rows, totals = built["rows"], built["snapshot"]["result"]
    inflow = sum(cents(row["paid_in"]) for row in rows if row["cash_flow_direction"] == "INFLOW")
    outflow = sum(cents(row["paid_out"]) for row in rows if row["cash_flow_direction"] == "OUTFLOW")
    fees = sum(cents(row["paid_out"]) for row in rows if row["event_type"] == "FEE")
    assert cents(totals["cash_flow"]["total_inflow"]) == inflow
    assert cents(totals["cash_flow"]["total_outflow"]) == outflow
    assert cents(totals["fees"]["total_fees"]["total_fees"]) == fees
    assert totals["cash_flow"]["closing_balance"] == rows[-1]["balance"]


@pytest.mark.parametrize("name", CONTRACT + EDGE_CASES)
def test_every_balance_follows_from_the_one_before(name):
    rows = ledger(name)["rows"]
    for before, after in zip(rows, rows[1:], strict=False):
        moved = cents(after["paid_in"]) - cents(after["paid_out"])
        assert cents(after["balance"]) == cents(before["balance"]) + moved


def test_a_fee_adds_to_the_nearest_row_sharing_its_receipt_and_a_fee_keeps_no_cost():
    rows = ledger("F1-worked-example")["rows"]
    by_receipt = {row["receipt_no"]: row for row in rows if row["event_type"] == "BILL_PAYMENT"}
    bill = by_receipt["SYNWEB000"]
    assert bill["total_cost"] == 2030.0
    assert all(row["total_cost"] == 0.0 for row in rows if row["event_type"] == "FEE")
    withdrawal = next(row for row in rows if row["event_type"] == "WITHDRAWAL")
    assert withdrawal["total_cost"] == 29.0


def test_the_worked_example_covers_linked_orphan_and_ambiguous_fees_and_reversals():
    rows = ledger("F1-worked-example")["rows"]
    assert fee_linkage(rows) == {"linked": 3, "orphan": 1, "ambiguous": 1}
    reversals = {row["cash_flow_direction"] for row in rows if row["event_type"] == "REVERSAL"}
    assert reversals == {"INFLOW", "OUTFLOW"}
    first = rows[0]
    assert cents(first["balance"] - first["paid_in"] + first["paid_out"]) == 50_000
    assert len(rows) == 20


def test_the_tied_scenario_has_the_ties_it_is_named_for():
    rows = ledger("F2-tied-timestamps")["rows"]
    times = [row["completion_time"] for row in rows]
    assert times.count(min(times)) == 2
    assert times.count(max(times)) == 2
    fee = next(row for row in rows if row["event_type"] == "FEE")
    parent = next(
        row for row in rows if row["receipt_no"] == fee["receipt_no"] and row["event_type"] != "FEE"
    )
    assert fee["completion_time"] == parent["completion_time"]


def test_the_invalid_times_scenario_holds_its_four_unreadable_times_in_order():
    times = [row["completion_time"] for row in ledger("F3-invalid-timestamps")["rows"]]
    assert [time for time in times if not is_iso_like(time)] == list(F3_INVALID_TIMES)


def test_the_large_scenario_has_2345_rows_over_two_days():
    built = ledger("F4-paginated-2345")
    assert len(built["rows"]) == 2345
    assert (built["summary"]["period_start"], built["summary"]["period_end"]) == (
        "2026-07-01",
        "2026-07-02",
    )


def test_the_prototype_sample_keeps_every_balance_and_separates_every_charge():
    built = ledger("F5-prototype-converted")
    assert built["problems"] == []
    assert len(built["rows"]) == 94 + 32
    assert fee_linkage(built["rows"]) == {"linked": 32}


def test_rows_without_an_entity_say_so_with_the_marker():
    rows = ledger("F1-worked-example")["rows"]
    assert {row["entity"] for row in rows if row["event_type"] == "FEE"} == {NO_ENTITY}


@pytest.mark.parametrize("name", sorted(set(SCENARIOS) - LEDGER_ONLY))
def test_a_printed_scenario_prints_every_row_with_a_fake_receipt_one_per_ledger_receipt(name):
    built = ledger(name)
    printed = built["printed_receipts"]
    assert len(printed) == len(built["rows"])
    assert all(FAKE_RECEIPT.fullmatch(receipt) for receipt in printed)
    pairs = set(zip((row["receipt_no"] for row in built["rows"]), printed, strict=True))
    assert len({ledger_receipt for ledger_receipt, _ in pairs}) == len(pairs)
    assert len({printed_receipt for _, printed_receipt in pairs}) == len(pairs)


@pytest.mark.parametrize("name", sorted(set(SCENARIOS) - LEDGER_ONLY))
def test_a_printed_scenario_model_holds_each_printed_receipt(name):
    outputs = build_scenario_outputs(*SCENARIO_FIXTURES[name])
    model = json.loads(outputs[".model.json"])
    texts = {text_item["text"] for page in model["pages"] for text_item in page["items"]}
    assert set(ledger(name)["printed_receipts"]) <= texts


@pytest.mark.parametrize("name", CONTRACT + EDGE_CASES)
def test_a_scenario_regenerates_byte_identically(name):
    assert build_scenario_outputs(*SCENARIO_FIXTURES[name]) == build_scenario_outputs(
        *SCENARIO_FIXTURES[name]
    )
