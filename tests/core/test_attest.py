"""Attestation: tie a statement to its verification token, from page 1's text (CP7a).

The behaviours are the old authenticity gates and token search, read from page 1 of the statement
pages instead of from the PDF. The magic bytes and password behaviours were covered in CP2.
"""

import copy

import pytest

from mpesa_core.errors import AttestationCode, AttestationError
from mpesa_core.reconciliation.attest import attest

# Invented tokens: eight characters mixing letters and digits.
TOKEN = "QX7" + "M2KP9"
EARLIER_TOKEN = "AB1" + "2CD34"
BRAND_LINE = "Example M-PESA Statement"
ANCHOR_LINE = "Statement Verification Code"


def page_one(printed, *lines, number=1):
    items = [printed.left_item(text, 20.0, 20.0 + 10.0 * index) for index, text in enumerate(lines)]
    return printed.page_of(items, number=number)


def statement(printed, *lines):
    return printed.statement_of(page_one(printed, *lines))


def attestation_code(statement_pages):
    with pytest.raises(AttestationError) as caught:
        attest(statement_pages)
    return caught.value.code


def test_branded_statement_with_an_anchor_and_a_token_gives_the_token(printed):
    assert attest(statement(printed, BRAND_LINE, ANCHOR_LINE, TOKEN)) == TOKEN


def test_statement_without_the_brand_is_rejected(printed):
    pages = statement(printed, "Example Statement", ANCHOR_LINE, TOKEN)
    assert attestation_code(pages) is AttestationCode.BRAND_MISSING


def test_the_brand_is_found_whatever_its_case(printed):
    assert attest(statement(printed, "example m-pesa statement", ANCHOR_LINE, TOKEN)) == TOKEN


def test_branded_statement_without_any_anchor_is_rejected(printed):
    pages = statement(printed, BRAND_LINE, "Example footer", TOKEN)
    assert attestation_code(pages) is AttestationCode.ANCHOR_MISSING


def test_the_dial_code_instruction_is_an_anchor(printed):
    assert attest(statement(printed, BRAND_LINE, "To verify, dial *334#", TOKEN)) == TOKEN


def test_the_data_protection_footer_is_an_anchor(printed):
    pages = statement(printed, BRAND_LINE, "Processed under the Data Protection Act", TOKEN)
    assert attest(pages) == TOKEN


def test_anchors_ignore_case_and_spacing(printed):
    assert attest(statement(printed, BRAND_LINE, "statement   VERIFICATION code", TOKEN)) == TOKEN


def test_the_brand_is_checked_before_the_anchor(printed):
    assert attestation_code(statement(printed, "Example footer", TOKEN)) is (
        AttestationCode.BRAND_MISSING
    )


def test_a_code_printed_before_the_verification_anchor_is_not_the_token(printed):
    pages = statement(printed, BRAND_LINE, EARLIER_TOKEN, ANCHOR_LINE, TOKEN)
    assert attest(pages) == TOKEN


def test_without_the_verification_anchor_the_first_code_anywhere_is_the_token(printed):
    pages = statement(printed, BRAND_LINE, EARLIER_TOKEN, "dial *334#", TOKEN)
    assert attest(pages) == EARLIER_TOKEN


def test_all_letter_and_all_digit_blocks_are_not_tokens(printed):
    pages = statement(printed, BRAND_LINE, ANCHOR_LINE, "ABCDEFGH", "12345678", TOKEN)
    assert attest(pages) == TOKEN


def test_eight_characters_inside_a_longer_code_are_not_a_token(printed):
    receipt_like = "ZZ" + TOKEN
    pages = statement(printed, BRAND_LINE, ANCHOR_LINE, receipt_like, f"{TOKEN}9", TOKEN)
    assert attest(pages) == TOKEN


def test_a_lower_case_block_is_not_a_token(printed):
    pages = statement(printed, BRAND_LINE, ANCHOR_LINE, TOKEN.lower(), TOKEN)
    assert attest(pages) == TOKEN


def test_branded_and_anchored_statement_without_a_token_is_rejected(printed):
    pages = statement(printed, BRAND_LINE, ANCHOR_LINE, "Example footer")
    assert attestation_code(pages) is AttestationCode.TOKEN_MISSING


def test_only_page_one_is_read(printed):
    first = page_one(printed, "Example Statement")
    second = page_one(printed, BRAND_LINE, ANCHOR_LINE, TOKEN, number=2)
    assert attestation_code(printed.statement_of(first, second)) is AttestationCode.BRAND_MISSING


def test_statement_without_pages_is_rejected(printed):
    assert attestation_code(printed.statement_of()) is AttestationCode.NO_PAGES


def test_lines_are_read_top_to_bottom_whatever_the_item_order(printed):
    items = [
        printed.left_item(TOKEN, 20.0, 40.0),
        printed.left_item(EARLIER_TOKEN, 20.0, 10.0),
        printed.left_item(ANCHOR_LINE, 20.0, 30.0),
        printed.left_item(BRAND_LINE, 20.0, 20.0),
    ]
    assert attest(printed.statement_of(printed.page_of(items))) == TOKEN


def test_items_on_one_line_are_read_left_to_right(printed):
    items = [
        printed.left_item(TOKEN, 200.0, 30.0),
        printed.left_item(ANCHOR_LINE, 20.0, 30.0),
        printed.left_item(EARLIER_TOKEN, 20.0, 20.0),
        printed.left_item(BRAND_LINE, 20.0, 10.0),
    ]
    assert attest(printed.statement_of(printed.page_of(items))) == TOKEN


def test_an_attestation_error_carries_a_code_and_no_statement_text(printed):
    planted = "Example Person 07"
    with pytest.raises(AttestationError) as caught:
        attest(statement(printed, planted, BRAND_LINE, "Example footer", EARLIER_TOKEN))
    assert caught.value.code is AttestationCode.ANCHOR_MISSING
    for text in (planted, EARLIER_TOKEN, BRAND_LINE):
        assert text not in str(caught.value)
        assert text not in repr(caught.value)


def test_attestation_does_not_change_the_pages(printed):
    pages = statement(printed, BRAND_LINE, ANCHOR_LINE, TOKEN)
    before = copy.deepcopy(pages)
    attest(pages)
    assert pages == before
