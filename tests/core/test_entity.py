import pytest
from synthetic_events import (
    BILL_NUMBER,
    BUNDLE_NUMBER,
    MASKED_PHONE,
    OTHER_MASKED_PHONE,
    SMALL_BUSINESS_PHONE,
    TILL_NUMBER,
    canonical_row,
)

from mpesa_core.classification.entity import (
    extract_bill_payment_entity,
    extract_bundle_purchase_entity,
    extract_customer_transfer_entity,
    extract_entity,
    extract_incoming_funds_entity,
    extract_investment_entity,
    extract_merchant_payment_entity,
    extract_small_business_payment_entity,
)


@pytest.mark.parametrize(
    "details",
    [
        f"Pay Bill Online to {BILL_NUMBER} Example Till 123 Acc. Example Account",
        f"Pay Bill to {BILL_NUMBER} Example Till 123 Acc. Example Account",
    ],
    ids=["online", "plain"],
)
def test_extract_bill_payment_entity(details):
    assert extract_bill_payment_entity(details) == "Example Till 123"


@pytest.mark.parametrize(
    "details",
    [
        f"Pay Bill Online to {BILL_NUMBER} Example Till 123",
        "Pay Bill Online to Example Till 123 Acc. Example",
        "Pay Bill Charge",
    ],
    ids=["no-account-marker", "no-number", "fee"],
)
def test_extract_bill_payment_entity_returns_no_entity_for_unsupported_structure(details):
    assert extract_bill_payment_entity(details) is None


def test_extract_investment_entity():
    details = f"Unit Trust Invest To {TILL_NUMBER} Example Fund by Example Platform"
    assert extract_investment_entity(details) == "Example Fund"


@pytest.mark.parametrize(
    "details",
    [
        f"Unit Trust Invest To {TILL_NUMBER} Example Fund",
        "Unit Trust Invest To Example Fund by Example Platform",
    ],
    ids=["no-by-marker", "no-number"],
)
def test_extract_investment_entity_returns_no_entity_for_missing_boundaries(details):
    assert extract_investment_entity(details) is None


@pytest.mark.parametrize(
    "details",
    [
        f"Merchant Payment to {TILL_NUMBER} Example Shop",
        f"Merchant Payment Online to {TILL_NUMBER} Example Shop",
    ],
    ids=["plain", "online"],
)
def test_extract_merchant_payment_entity(details):
    assert extract_merchant_payment_entity(details) == "Example Shop"


def test_extract_merchant_payment_entity_returns_no_entity_for_missing_merchant_number():
    assert extract_merchant_payment_entity("Merchant Payment to Example Shop") is None


def test_extract_customer_transfer_entity():
    details = f"Customer Transfer to {MASKED_PHONE} Example Person 12"
    assert extract_customer_transfer_entity(details) == "Example Person 12"


def test_extract_customer_transfer_entity_returns_no_entity_for_missing_recipient():
    assert extract_customer_transfer_entity(f"Customer Transfer to {MASKED_PHONE}") is None
    assert extract_customer_transfer_entity("Customer Transfer to Example Person 12") is None


def test_extract_incoming_funds_entity():
    details = f"Funds received from {OTHER_MASKED_PHONE} Example Person 34"
    assert extract_incoming_funds_entity(details) == "Example Person 34"


def test_extract_incoming_funds_entity_returns_no_entity_for_missing_sender():
    assert extract_incoming_funds_entity(f"Funds received from {OTHER_MASKED_PHONE}") is None


@pytest.mark.parametrize(
    "details",
    [
        f"Customer Bundle Purchase to {BUNDLE_NUMBER} Example Bundle by Example Network",
        f"Recharge for Customer to {BUNDLE_NUMBER} Example Bundle by Example Network",
    ],
    ids=["bundle", "recharge"],
)
def test_extract_bundle_purchase_entity(details):
    assert extract_bundle_purchase_entity(details) == "Example Bundle"


def test_extract_bundle_purchase_entity_returns_no_entity_for_missing_attribution():
    details = f"Customer Bundle Purchase to {BUNDLE_NUMBER} Example Bundle"
    assert extract_bundle_purchase_entity(details) is None


def test_extract_small_business_payment_entity():
    details = f"Customer Payment to Small Business to {SMALL_BUSINESS_PHONE} Example Kiosk"
    assert extract_small_business_payment_entity(details) == "Example Kiosk"


def test_extract_small_business_payment_entity_returns_no_entity_for_missing_recipient():
    details = f"Customer Payment to Small Business to {SMALL_BUSINESS_PHONE}"
    assert extract_small_business_payment_entity(details) is None


def test_entity_extraction_ignores_case_and_keeps_source_casing():
    details = f"MERCHANT PAYMENT TO {TILL_NUMBER} Example SHOP"
    assert extract_entity(details) == "Example SHOP"


def test_first_matching_grammar_wins():
    details = f"Pay Bill to {BILL_NUMBER} Example Till Acc. x"
    assert extract_entity(details) == "Example Till"


def test_entity_is_trimmed():
    assert extract_entity(f"Merchant Payment to {TILL_NUMBER}   Example Shop  ") == "Example Shop"


@pytest.mark.parametrize("details", ["Airtime Purchase", "", "Example Unknown Service"])
def test_text_no_grammar_reads_has_no_entity(details):
    assert extract_entity(details) is None


def test_grammars_are_not_tied_to_event_types():
    from mpesa_core.classification.classify import classify_transactions

    row = canonical_row(
        0,
        f"Customer Payment to Small Business to {SMALL_BUSINESS_PHONE} Example Kiosk",
        withdrawn=-5.0,
    )
    classified = classify_transactions([row])[0][0]
    assert classified["event_type"] == "UNCLASSIFIED"
    assert classified["entity"] == "Example Kiosk"
