"""The verification instruction: page 1's printed "dial" line, for the app to show as printed.

The app shows how to verify a statement in the statement's own words instead of a code the app
assumes (CP8b, owner instruction). Personal data never passes: a line that looks like it holds a
phone number or an email gives None, and the app then shows its fallback sentence.
"""

from mpesa_core.reconciliation.attest import verification_instruction

TOKEN = "QX7" + "M2KP9"
BRAND_LINE = "Example M-PESA Statement"
INSTRUCTION = "To verify this statement, dial *334# and enter the code below"
# Invented, built in parts so the pattern guard does not read them as real data.
INVENTED_NUMBER = "07000000" + "01"
INVENTED_EMAIL = "someone" + "@" + "example.invalid"


def page_one(printed, *lines, number=1):
    items = [printed.left_item(text, 20.0, 20.0 + 10.0 * index) for index, text in enumerate(lines)]
    return printed.page_of(items, number=number)


def statement(printed, *lines):
    return printed.statement_of(page_one(printed, *lines))


def test_the_dial_line_is_given_as_printed(printed):
    pages = statement(printed, BRAND_LINE, INSTRUCTION, TOKEN)
    assert verification_instruction(pages) == INSTRUCTION


def test_a_statement_without_a_dial_line_gives_none(printed):
    pages = statement(printed, BRAND_LINE, "Statement Verification Code", TOKEN)
    assert verification_instruction(pages) is None


def test_the_dial_is_found_whatever_its_case_and_code(printed):
    line = "DIAL *123*4# TO CHECK THIS STATEMENT"
    assert verification_instruction(statement(printed, BRAND_LINE, line)) == line


def test_runs_of_spaces_inside_the_line_are_collapsed(printed):
    pages = statement(printed, BRAND_LINE, "To verify,   dial  *334#   now")
    assert verification_instruction(pages) == "To verify, dial *334# now"


def test_a_line_holding_a_phone_number_gives_none(printed):
    line = f"Dial *334# or call {INVENTED_NUMBER}"
    assert verification_instruction(statement(printed, BRAND_LINE, line)) is None


def test_a_line_holding_an_email_gives_none(printed):
    line = f"Dial *334# or write to {INVENTED_EMAIL}"
    assert verification_instruction(statement(printed, BRAND_LINE, line)) is None


def test_only_page_one_is_read(printed):
    first = page_one(printed, BRAND_LINE, TOKEN)
    second = page_one(printed, INSTRUCTION, number=2)
    assert verification_instruction(printed.statement_of(first, second)) is None


def test_no_pages_gives_none(printed):
    assert verification_instruction(printed.statement_of()) is None


def test_the_first_dial_line_is_given_when_several_are_printed(printed):
    pages = statement(printed, BRAND_LINE, INSTRUCTION, "Or dial *234# for help")
    assert verification_instruction(pages) == INSTRUCTION
