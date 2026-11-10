"""Find the entity in normalized details: the person, merchant, till or paybill on the other side.

Each grammar matches from the start of the text and ignores case; the first that matches wins. The
grammars are in docs/decisions/classification-behaviour.md.
"""

import re

MASKED_PHONE = r"\d{3,4}\d*\*+\d+"
BILL_PAYMENT_GRAMMAR = re.compile(r"^Pay Bill(?: Online)? to \d+ (.+?) Acc\.", re.IGNORECASE)
INVESTMENT_GRAMMAR = re.compile(r"^Unit Trust Invest To \d+ (.+?) by ", re.IGNORECASE)
MERCHANT_PAYMENT_GRAMMAR = re.compile(r"^Merchant Payment(?: Online)? to \d+ (.+)$", re.IGNORECASE)
CUSTOMER_TRANSFER_GRAMMAR = re.compile(
    rf"^Customer Transfer to {MASKED_PHONE} (.+)$", re.IGNORECASE
)
INCOMING_FUNDS_GRAMMAR = re.compile(rf"^Funds received from {MASKED_PHONE} (.+)$", re.IGNORECASE)
BUNDLE_PURCHASE_GRAMMARS = (
    re.compile(r"^Customer Bundle Purchase to \d+ (.+?) by ", re.IGNORECASE),
    re.compile(r"^Recharge for Customer to \d+ (.+?) by ", re.IGNORECASE),
)
SMALL_BUSINESS_GRAMMAR = re.compile(
    rf"^Customer Payment to Small Business to {MASKED_PHONE} (.+)$", re.IGNORECASE
)


def extract_entity(details):
    """Find the entity in normalized details, trying every grammar in order.

    Args:
        details: Normalized details text.

    Returns:
        The entity, keeping the text's own casing, or None if no grammar matches.

    Side Effects:
        None.
    """
    for extract in ENTITY_EXTRACTORS:
        entity = extract(details)
        if entity is not None:
            return entity
    return None


def extract_bill_payment_entity(details):
    """Read a pay bill text, such as ``"Pay Bill Online to 888001 Example Till Acc. 42"``.

    Args:
        details: Normalized details text.

    Returns:
        The text between the paybill number and the account marker, or None.

    Side Effects:
        None.
    """
    return _captured(BILL_PAYMENT_GRAMMAR, details)


def extract_investment_entity(details):
    """Read a unit trust text, such as ``"Unit Trust Invest To 555002 Example Fund by Platform"``.

    Args:
        details: Normalized details text.

    Returns:
        The text between the investment number and the platform's "by" marker, or None.

    Side Effects:
        None.
    """
    return _captured(INVESTMENT_GRAMMAR, details)


def extract_merchant_payment_entity(details):
    """Read a merchant payment text, such as ``"Merchant Payment to 555002 Example Shop"``.

    Args:
        details: Normalized details text.

    Returns:
        Everything after the merchant number, or None.

    Side Effects:
        None.
    """
    return _captured(MERCHANT_PAYMENT_GRAMMAR, details)


def extract_customer_transfer_entity(details):
    """Read a transfer to a person, addressed to a masked phone number.

    Args:
        details: Normalized details text: "Customer Transfer to", a masked phone, then a name.

    Returns:
        Everything after the masked phone number, or None.

    Side Effects:
        None.
    """
    return _captured(CUSTOMER_TRANSFER_GRAMMAR, details)


def extract_incoming_funds_entity(details):
    """Read money received from a person, sent from a masked phone number.

    Args:
        details: Normalized details text: "Funds received from", a masked phone, then a name.

    Returns:
        Everything after the masked phone number, or None.

    Side Effects:
        None.
    """
    return _captured(INCOMING_FUNDS_GRAMMAR, details)


def extract_bundle_purchase_entity(details):
    """Read a bundle purchase or a recharge.

    For example ``"Customer Bundle Purchase to 555003 Example Bundle by Example Network"``.

    Args:
        details: Normalized details text.

    Returns:
        The text between the bundle number and the "by" marker, or None.

    Side Effects:
        None.
    """
    for grammar in BUNDLE_PURCHASE_GRAMMARS:
        entity = _captured(grammar, details)
        if entity is not None:
            return entity
    return None


def extract_small_business_payment_entity(details):
    """Read a payment to a small business, addressed to a masked phone number.

    Args:
        details: Normalized details text.

    Returns:
        Everything after the masked phone number, or None.

    Side Effects:
        None.
    """
    return _captured(SMALL_BUSINESS_GRAMMAR, details)


def _captured(grammar, details):
    """Apply one grammar.

    Args:
        grammar: A compiled pattern anchored at the start, whose first group is the entity.
        details: Normalized details text.

    Returns:
        The captured text without surrounding whitespace, or None if the grammar does not match.

    Side Effects:
        None.
    """
    match = grammar.match(details)
    return None if match is None else match.group(1).strip()


ENTITY_EXTRACTORS = (
    extract_bill_payment_entity,
    extract_investment_entity,
    extract_merchant_payment_entity,
    extract_customer_transfer_entity,
    extract_incoming_funds_entity,
    extract_bundle_purchase_entity,
    extract_small_business_payment_entity,
)
