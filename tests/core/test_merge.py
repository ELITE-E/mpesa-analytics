"""Merged analytics across a ledger's statements (CP9b item 5, ADR 0017).

The merged period is the union of the statements' periods; the closing balance is the balance at
the latest completion time, ties broken by import order (the later statement wins), then by each
statement's own print order (its newest row by its orientation, as D-06 reads it). Invented
records only.
"""

import importlib
import json
import sys

import pytest
from synthetic_records import record, statement

from mpesa_core import bridge, pipeline
from mpesa_core.analysis import analyze_transactions
from mpesa_core.errors import AnalysisCode, AnalysisError
from mpesa_core.reconciliation.import_plan import plan_statement_import
from mpesa_core.reconciliation.merge import merged_closing_balance, merged_period

NEWEST = "newest_first"
OLDEST = "oldest_first"


def entry(indices, *, start=None, end=None, orientation=OLDEST):
    """One statement as the store describes it: its period, orientation and rows by index."""
    return {
        "period": {"start": start, "end": end},
        "chain_orientation": orientation,
        "transaction_indices": indices,
    }


def at(number, time, balance):
    """A record at a given completion time with a given balance."""
    return record(number, completion_time=time, balance=balance)


def test_merged_period_is_the_union_of_the_statement_periods():
    statements = [
        entry([], start="2026-01-08 09:00:00", end="2026-02-01 18:00:00"),
        entry([], start="2026-01-02 07:30:00", end="2026-01-10 12:00:00"),
    ]
    assert merged_period(statements) == {
        "start": "2026-01-02 07:30:00",
        "end": "2026-02-01 18:00:00",
    }


def test_merged_period_skips_statements_without_a_readable_period():
    statements = [
        entry([], start=None, end=None),
        entry([], start="2026-01-02 07:30:00", end="2026-01-03 08:00:00"),
    ]
    assert merged_period(statements) == {
        "start": "2026-01-02 07:30:00",
        "end": "2026-01-03 08:00:00",
    }


def test_merged_period_without_any_period_is_empty():
    assert merged_period([entry([]), entry([])]) == {"start": None, "end": None}
    assert merged_period([]) == {"start": None, "end": None}


def test_the_latest_completion_time_wins_whatever_the_import_order():
    transactions = [at(1, "2026-02-01 10:00:00", 900.0), at(2, "2026-01-15 10:00:00", 400.0)]
    statements = [entry([0]), entry([1])]
    assert merged_closing_balance(transactions, statements) == 900.0


def test_a_tie_at_the_latest_time_goes_to_the_later_imported_statement():
    transactions = [at(1, "2026-02-01 10:00:00", 900.0), at(2, "2026-02-01 10:00:00", 750.0)]
    assert merged_closing_balance(transactions, [entry([0]), entry([1])]) == 750.0
    assert merged_closing_balance(transactions, [entry([1]), entry([0])]) == 900.0


def test_a_tie_within_one_newest_first_statement_goes_to_the_first_printed_row():
    transactions = [at(1, "2026-02-01 10:00:00", 900.0), at(2, "2026-02-01 10:00:00", 750.0)]
    assert merged_closing_balance(transactions, [entry([0, 1], orientation=NEWEST)]) == 900.0


def test_a_tie_within_one_oldest_first_statement_goes_to_the_last_printed_row():
    transactions = [at(1, "2026-02-01 10:00:00", 900.0), at(2, "2026-02-01 10:00:00", 750.0)]
    assert merged_closing_balance(transactions, [entry([0, 1], orientation=OLDEST)]) == 750.0


def test_a_row_both_statements_observed_counts_for_the_later_one():
    transactions = [at(1, "2026-02-01 10:00:00", 900.0), at(2, "2026-02-01 10:00:00", 750.0)]
    statements = [entry([1, 0], orientation=OLDEST), entry([0], orientation=OLDEST)]
    assert merged_closing_balance(transactions, statements) == 900.0


def test_unreadable_completion_times_never_decide_the_closing_balance():
    transactions = [at(1, "2026-02-01 10:00:00", 900.0), at(2, "not a time", 5.0), at(3, None, 6.0)]
    assert merged_closing_balance(transactions, [entry([0, 1, 2])]) == 900.0


def test_no_readable_completion_time_means_no_closing_balance():
    assert merged_closing_balance([at(1, None, 5.0)], [entry([0])]) is None
    assert merged_closing_balance([], []) is None


@pytest.mark.parametrize(
    "statements",
    [
        [entry([0], orientation="sideways")],
        [entry([3])],
        [entry([-1])],
        [{"period": {"start": None, "end": None}, "chain_orientation": OLDEST}],
        ["not a statement"],
    ],
)
def test_a_malformed_statement_description_is_a_typed_error(statements):
    with pytest.raises(AnalysisError) as caught:
        merged_closing_balance([at(1, "2026-02-01 10:00:00", 900.0)], statements)
    assert caught.value.code is AnalysisCode.MERGE_REQUEST_INVALID


def test_analyze_merged_reports_the_canonical_rows_with_the_union_period_and_the_closing_rule():
    first, second = statement(1, 4), statement(3, 6)
    plan = plan_statement_import(second, first)
    canonical = first + [
        row
        for row, action in zip(second, plan["actions"], strict=True)
        if action["action"] == "insert"
    ]
    statements = [
        entry([0, 1, 2, 3], start=first[0]["completion_time"], end=first[-1]["completion_time"]),
        entry([2, 3, 4, 5], start=second[0]["completion_time"], end=second[-1]["completion_time"]),
    ]
    merged = pipeline.analyze_merged(canonical, statements)
    period = merged_period(statements)
    closing = merged_closing_balance(canonical, statements)
    assert merged["period"] == period
    assert merged["closing_balance"] == closing
    expected = analyze_transactions(canonical, closing_balance=closing)
    assert merged["report"] == expected
    assert merged["report"]["cash_flow"]["total_outflow"] == sum(
        row["paid_out"] for row in canonical
    )


def test_analyze_merged_changes_neither_input():
    canonical = statement(1, 3)
    statements = [
        entry(
            [0, 1, 2], start=canonical[0]["completion_time"], end=canonical[-1]["completion_time"]
        )
    ]
    before = json.dumps([canonical, statements])
    pipeline.analyze_merged(canonical, statements)
    assert json.dumps([canonical, statements]) == before


def merged_request(transactions, statements):
    return json.dumps({"transactions": transactions, "statements": statements})


def test_the_bridge_returns_the_merged_analysis_as_json_text():
    canonical = statement(1, 3)
    statements = [
        entry(
            [0, 1, 2], start=canonical[0]["completion_time"], end=canonical[-1]["completion_time"]
        )
    ]
    answer = bridge.analyze_merged_json(merged_request(canonical, statements))
    assert type(answer) is str
    assert json.loads(answer) == json.loads(
        json.dumps(pipeline.analyze_merged(canonical, statements))
    )


@pytest.mark.parametrize(
    "text",
    [
        "not json " + "ZZ" + "REC00001",
        json.dumps({"transactions": []}),
        json.dumps({"transactions": "ZZ" + "REC00001", "statements": []}),
        json.dumps({"transactions": [], "statements": [], "extra": 1}),
    ],
)
def test_a_malformed_merged_request_is_a_typed_error_that_repeats_nothing(text):
    with pytest.raises(AnalysisError) as caught:
        bridge.analyze_merged_json(text)
    assert caught.value.code is AnalysisCode.MERGE_REQUEST_INVALID
    assert "ZZREC" not in str(caught.value)


def test_call_json_answers_a_core_call_in_an_ok_envelope():
    incoming, existing = statement(2, 4), statement(1, 3)
    request = json.dumps({"incoming_rows": incoming, "existing_transactions": existing})
    answer = json.loads(bridge.call_json("plan_statement_import", request))
    assert answer == {"ok": True, "answer": plan_statement_import(incoming, existing)}


def test_call_json_turns_a_refused_plan_into_its_code_and_row():
    incoming = statement(1, 2)
    plan = plan_statement_import(incoming, [])
    plan["actions"][1]["action"] = "preserve"
    request = json.dumps({"incoming_rows": incoming, "existing_transactions": [], "plan": plan})
    answer = json.loads(bridge.call_json("validate_import_plan", request))
    assert answer == {"ok": False, "error": {"code": "PRESERVE_NOT_COLLISION", "row_index": 1}}


def test_call_json_runs_the_merged_analysis():
    canonical = statement(1, 3)
    statements = [
        entry(
            [0, 1, 2], start=canonical[0]["completion_time"], end=canonical[-1]["completion_time"]
        )
    ]
    answer = json.loads(bridge.call_json("analyze_merged", merged_request(canonical, statements)))
    assert answer["ok"] is True
    assert answer["answer"]["closing_balance"] == merged_closing_balance(canonical, statements)


def test_call_json_refuses_an_unknown_function_and_repeats_nothing():
    answer = bridge.call_json("delete_" + "ZZ" + "REC00001", "{}")
    assert json.loads(answer) == {
        "ok": False,
        "error": {"code": "REQUEST_INVALID", "row_index": None},
    }
    assert "ZZREC" not in answer


def test_call_json_says_when_the_analysis_runtime_is_not_loaded_yet():
    canonical = statement(1, 3)
    statements = [
        entry(
            [0, 1, 2], start=canonical[0]["completion_time"], end=canonical[-1]["completion_time"]
        )
    ]
    watched = [name for name in sys.modules if name.partition(".")[0] in ("mpesa_core", "pandas")]
    saved = {name: sys.modules.pop(name) for name in watched}
    sys.modules["pandas"] = None
    try:
        fresh = importlib.import_module("mpesa_core.bridge")
        answer = fresh.call_json("analyze_merged", merged_request(canonical, statements))
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
