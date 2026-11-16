"""account_digest: one digest per invented mobile number, whatever its printed form (CP8a).

Numbers come from the fake ranges in tools/guards/guards.toml, assembled from parts because the
pattern guard honours those ranges only inside tests/fixtures/synthetic/.
"""

import hashlib
import re

import pytest
from statement_pages import attestable_statement

from mpesa_core.reconciliation.account import account_digest, canonical_mobile_number

LOCAL_FORM = "07000000" + "01"
SAME_NUMBER_FORMS = [
    LOCAL_FORM,
    "254700000" + "001",
    "+254700000" + "001",
    "+254 700 000 " + "001",
    "0700-000-" + "001",
    "0700 000 " + "001",
    "700000" + "001",
]
OTHER_NUMBER = "07000000" + "02"
CANONICAL = "254700000" + "001"
MASKED = "2547" + "*****" + "001"


def page_one_with(printed, *lines):
    """An attestable one-page statement whose page 1 also prints the given label lines."""
    statement = attestable_statement(printed)
    top = 20.0
    for line in lines:
        statement["pages"][0]["items"] += [
            printed.left_item(text, 20.0 + 110.0 * column, top) for column, text in enumerate(line)
        ]
        top += 10.0
    return statement


@pytest.mark.parametrize("printed_number", SAME_NUMBER_FORMS)
def test_every_printed_form_of_one_number_has_one_canonical_form(printed_number):
    assert canonical_mobile_number(printed_number) == CANONICAL


@pytest.mark.parametrize("printed_number", SAME_NUMBER_FORMS)
def test_the_same_number_gives_the_same_digest_in_every_format(printed, printed_number):
    statement = page_one_with(printed, ("Mobile Number:", printed_number))
    assert account_digest(statement) == hashlib.sha256(CANONICAL.encode("ascii")).hexdigest()


def test_the_digest_is_sha256_hex_of_the_canonical_digits(printed):
    digest = account_digest(page_one_with(printed, ("Mobile Number:", LOCAL_FORM)))
    assert re.fullmatch(r"[0-9a-f]{64}", digest)


def test_different_numbers_give_different_digests(printed):
    first = account_digest(page_one_with(printed, ("Mobile Number:", LOCAL_FORM)))
    second = account_digest(page_one_with(printed, ("Mobile Number:", OTHER_NUMBER)))
    assert first != second


def test_the_label_and_number_may_be_one_text_item(printed):
    statement = page_one_with(printed, (f"Mobile Number: {LOCAL_FORM}",))
    assert account_digest(statement) == account_digest(
        page_one_with(printed, ("Mobile Number:", LOCAL_FORM))
    )


@pytest.mark.parametrize(
    "lines",
    [
        (),
        (("Mobile Number:",),),
        (("Mobile Number:", MASKED),),
        (("Mobile Number:", "Example Person 01"),),
        (("Mobile Number:", "0700"),),
        (("Mobile Number:", LOCAL_FORM + "9"),),
        (("Customer Name:", LOCAL_FORM),),
    ],
    ids=["no-label", "no-value", "masked", "a-name", "too-short", "too-long", "other-label"],
)
def test_an_unreadable_number_gives_none(printed, lines):
    assert account_digest(page_one_with(printed, *lines)) is None


def test_a_number_on_a_later_page_is_not_read(printed):
    statement = attestable_statement(printed)
    later = printed.page_of([printed.left_item(f"Mobile Number: {LOCAL_FORM}", 20.0, 20.0)], 2)
    statement["pages"].append(later)
    assert account_digest(statement) is None


def test_no_pages_gives_none():
    assert account_digest({"schema_version": 1, "engine": "test", "pages": []}) is None


@pytest.mark.parametrize("text", ["", "abc", MASKED, "+", "254", "0" * 10])
def test_text_that_is_no_mobile_number_has_no_canonical_form(text):
    assert canonical_mobile_number(text) is None
