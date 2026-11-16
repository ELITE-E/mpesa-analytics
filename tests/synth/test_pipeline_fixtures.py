"""pipeline.run on every committed fixture: the composition of the stages, JSON-safe, no secrets."""

import hashlib
import json

import pytest

from conftest import REPO
from mpesa_core import pipeline
from mpesa_core.analysis import analyze_transactions
from mpesa_core.classification.classify import classify_transactions
from mpesa_core.cleaning.canonicalize import canonicalize_rows
from mpesa_core.contracts import SCHEMA_VERSION
from mpesa_core.errors import ErrorCode, ExtractionError
from mpesa_core.extraction.rows import build_rows
from mpesa_core.reconciliation.account import account_digest
from mpesa_core.reconciliation.attest import attest
from mpesa_core.reconciliation.reconcile import measure_balances, measure_unclassified, reconcile
from synth.generate import COMMITTED_FIXTURES, FAKE_PASSWORD

FIXTURES = REPO / "tests" / "fixtures" / "synthetic"
WITHOUT_ROWS = "F-NOTABLE"
WITH_ROWS = sorted(set(COMMITTED_FIXTURES) - {WITHOUT_ROWS})


def pages_of(name):
    return json.loads((FIXTURES / f"{name}.items.json").read_text(encoding="utf-8"))


def ledger(name):
    return json.loads((FIXTURES / f"{name}.expected.json").read_text(encoding="utf-8"))


def composed(statement_pages):
    token = attest(statement_pages)
    rows = build_rows(statement_pages)
    transactions, diagnostics = classify_transactions(canonicalize_rows(rows))
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
        "processed_at": None,
        "period": pipeline.measure_period(transactions),
        "balances": measure_balances(rows, quality["chain_orientation"]),
        "transactions": transactions,
        "report": analyze_transactions(transactions),
        "quality": quality,
        "diagnostics": diagnostics,
    }


@pytest.mark.parametrize("name", WITH_ROWS)
def test_run_equals_the_composition_of_the_stages(name):
    pages = pages_of(name)
    assert pipeline.run(pages) == composed(pages)


@pytest.mark.parametrize("name", WITH_ROWS)
def test_run_attests_to_the_token_the_generator_printed(name):
    assert pipeline.run(pages_of(name))["verification_token"] == ledger(name)["verification_token"]


@pytest.mark.parametrize("name", WITH_ROWS)
def test_result_is_json_and_holds_no_password(name):
    serialized = json.dumps(pipeline.run(pages_of(name)), allow_nan=False)
    assert FAKE_PASSWORD not in serialized


@pytest.mark.parametrize("name", WITH_ROWS)
def test_balances_equal_the_ledger(name):
    balances = pipeline.run(pages_of(name))["balances"]
    for figure in ("opening_balance", "closing_balance"):
        assert balances[figure] == pytest.approx(float(ledger(name)[figure]), abs=0.005)


def test_fixture_without_rows_attests_then_raises_layout_unrecognized():
    pages = pages_of(WITHOUT_ROWS)
    assert attest(pages) == ledger(WITHOUT_ROWS)["verification_token"]
    with pytest.raises(ExtractionError) as caught:
        pipeline.run(pages)
    assert caught.value.code is ErrorCode.LAYOUT_UNRECOGNIZED


INVENTED_NAME = "Example Person 00"
INVENTED_PHONE = "07000000" + "00"
INVENTED_EMAIL = "example.person@example.invalid"
INVENTED_CANONICAL_PHONE = "254" + INVENTED_PHONE[1:]
INVENTED_IDENTITY = (
    INVENTED_NAME,
    INVENTED_PHONE,
    INVENTED_PHONE[1:],
    INVENTED_CANONICAL_PHONE,
    INVENTED_EMAIL,
    "example.person",
    "example.invalid",
)


def every_text(value):
    """Every key and value in a nested result, numbers included, as text."""
    if isinstance(value, dict):
        for key, element in value.items():
            yield str(key)
            yield from every_text(element)
    elif isinstance(value, list | tuple):
        for element in value:
            yield from every_text(element)
    else:
        yield str(value)


@pytest.mark.parametrize("name", WITH_ROWS)
def test_the_fixture_prints_an_invented_name_phone_and_email_on_page_one(name):
    texts = {text_item["text"] for text_item in pages_of(name)["pages"][0]["items"]}
    assert {INVENTED_NAME, INVENTED_PHONE, INVENTED_EMAIL} <= texts


@pytest.mark.parametrize("name", WITH_ROWS)
def test_the_result_holds_none_of_the_name_phone_or_email_anywhere(name):
    texts = list(every_text(pipeline.run(pages_of(name))))
    for planted in INVENTED_IDENTITY:
        assert not any(planted in text for text in texts), "identity text in the result"
    assert not any("@" in text for text in texts)


@pytest.mark.parametrize("name", WITH_ROWS)
def test_the_result_carries_the_digest_of_the_invented_number(name):
    pipeline_result = pipeline.run(pages_of(name))
    expected = hashlib.sha256(INVENTED_CANONICAL_PHONE.encode("ascii")).hexdigest()
    assert pipeline_result["account_digest"] == expected
    assert pipeline_result["quality"]["account_number_unreadable"] is False
