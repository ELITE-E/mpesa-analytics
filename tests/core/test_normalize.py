import re

import pytest
from synthetic_details import (
    ALL_DETAILS,
    BUY_GOODS_DETAILS,
    INTERNATIONAL_PHONE,
    LOCAL_PHONE,
    PAYBILL_DETAILS,
    PAYBILL_NUMBER,
    PLUS_PHONE,
    RECEIVED_DETAILS,
    RECEIVED_PLUS_DETAILS,
    SENT_DETAILS,
    TILL_DETAILS,
    TILL_NUMBER,
)

from mpesa_core.cleaning.normalize import normalize_name

BRAND = "M-PESA"


@pytest.mark.parametrize("details", ALL_DETAILS)
def test_normalize_name_satisfies_formatting_contract(details):
    normalized = normalize_name(details)
    assert "\n" not in normalized
    assert "|" not in normalized
    assert "\\" not in normalized
    assert "-" not in normalized.replace(BRAND, "")
    assert "  " not in normalized
    assert normalized == normalized.strip()


@pytest.mark.parametrize(
    ("details", "expected"),
    [
        (PAYBILL_DETAILS, f"Example Till 123 {PAYBILL_NUMBER}"),
        (TILL_DETAILS, f"Example Till 456 {TILL_NUMBER}"),
        (BUY_GOODS_DETAILS, f"Example Shop 789 {TILL_NUMBER}"),
        (
            f"paybill - {PAYBILL_NUMBER} - Example Lower Case",
            f"Example Lower Case {PAYBILL_NUMBER}",
        ),
        ("Customer Transfer of Funds Charge", "Customer Transfer of Funds Charge"),
        ("Airtime Purchase", "Airtime Purchase"),
    ],
    ids=["paybill", "till", "buy-goods", "any-case", "fee-unchanged", "airtime-unchanged"],
)
def test_normalize_name_preserves_business_identity(details, expected):
    assert normalize_name(details) == expected


@pytest.mark.parametrize("details", ALL_DETAILS)
def test_normalize_name_satisfies_determinism_contract(details):
    first = normalize_name(details)
    for other in ALL_DETAILS:
        normalize_name(other)
    assert normalize_name(details) == first


@pytest.mark.parametrize(
    ("details", "expected"),
    [
        (SENT_DETAILS, "Example Person 12"),
        (RECEIVED_DETAILS, "Example Person 34"),
        (RECEIVED_PLUS_DETAILS, "Example Person 56"),
        (f"SENT TO {LOCAL_PHONE} - Example Person 78", "Example Person 78"),
    ],
    ids=["sent-local", "received-international", "received-plus-no-dash", "any-case"],
)
def test_recipient_normalization(details, expected):
    normalized = normalize_name(details)
    assert normalized == expected
    for phone in (LOCAL_PHONE, INTERNATIONAL_PHONE, PLUS_PHONE):
        assert phone not in normalized


def test_whole_text_is_replaced_when_a_pattern_is_found_anywhere():
    # D-08: kept on purpose. The search is unanchored and the words before the match are lost.
    assert normalize_name(f"Opening words PayBill - {PAYBILL_NUMBER} - Example Till 999") == (
        f"Example Till 999 {PAYBILL_NUMBER}"
    )
    assert normalize_name(f"Opening words Sent to {LOCAL_PHONE} - Example Person 12") == (
        "Example Person 12"
    )


def test_name_after_a_pattern_runs_to_the_end_of_the_text():
    details = f"Till - {TILL_NUMBER} - Example Shop - Branch Two"
    assert normalize_name(details) == f"Example Shop Branch Two {TILL_NUMBER}"


@pytest.mark.parametrize("missing", ["", None])
def test_missing_details_give_the_empty_string(missing):
    assert normalize_name(missing) == ""


def test_whitespace_only_details_give_the_empty_string():
    assert normalize_name("   ") == ""


def test_bracketed_references_are_removed_and_the_text_around_them_kept():
    assert normalize_name("Example Till 123 (Ref: EXAMPLEREF) Payment") == (
        "Example Till 123 Payment"
    )


@pytest.mark.parametrize(
    "details", ["mpesa Example", "M PESA Example", "m-pesa Example", "MPESA Example"]
)
def test_every_spelling_of_the_brand_is_written_one_way(details):
    assert normalize_name(details) == f"{BRAND} Example"


def test_hyphens_inside_names_become_spaces():
    assert normalize_name("Example-Hyphenated-Name Payment") == "Example Hyphenated Name Payment"


@pytest.mark.parametrize(
    ("details", "expected"),
    [
        (f"{PAYBILL_NUMBER}EXAMPLE", f"{PAYBILL_NUMBER} EXAMPLE"),
        ("1234567EXAMPLE", "1234567 EXAMPLE"),
        ("1234EXAMPLE", "1234EXAMPLE"),
        ("12345678EXAMPLE", "12345678EXAMPLE"),
        ("123456example", "123456example"),
        ("XYZ123456ABC", "XYZ123456ABC"),
    ],
    ids=["six-digits", "seven-digits", "four-digits", "eight-digits", "lowercase", "inside-a-word"],
)
def test_glued_identifier_is_split_only_for_five_to_seven_digits_before_a_capital(
    details, expected
):
    assert normalize_name(details) == expected


def test_newlines_become_single_spaces():
    assert normalize_name("Example\nWrapped\n\nDetails") == "Example Wrapped Details"


def test_output_is_single_spaced_words_only():
    for details in ALL_DETAILS:
        normalized = normalize_name(details)
        assert re.fullmatch(r"(\S+( \S+)*)?", normalized)
