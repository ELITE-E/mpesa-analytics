"""Tie a statement to its verification token, from the text printed on its first page.

Two checks run in order: the M-PESA brand, then a verification instruction or legal footer. The
token is the first eight-character code mixing capital letters and digits after the "Statement
Verification Code" instruction, or anywhere on page 1 when that instruction is absent. Statement
pages carry no PDF metadata, so only printed text is read; the old code also never took the token
from metadata, because anyone can write it.
"""

import re

from mpesa_core.errors import AttestationCode, AttestationError
from mpesa_core.extraction.columns import group_lines

BRAND = "M-PESA"
VERIFICATION_ANCHOR = re.compile(r"Statement\s+Verification\s+Code", re.IGNORECASE)
AUTHENTICITY_ANCHORS = (
    VERIFICATION_ANCHOR,
    re.compile(r"dial\s*\*334#", re.IGNORECASE),
    re.compile(r"Data\s+Protection\s+Act", re.IGNORECASE),
)
# A USSD instruction such as "dial *334#": the line holding it is the statement's own instruction.
DIAL_INSTRUCTION = re.compile(r"dial\s*\*[\d*]+#", re.IGNORECASE)
# A run of nine or more digits, spaces or hyphens between digits reads as a phone number, and an
# at sign as an email: a line holding either is never given out.
PHONE_LIKE = re.compile(r"\d(?:[\s-]*\d){8,}")
EMAIL_LIKE = re.compile(r"@")
# Eight capitals or digits touching no other letter or digit, so a slice of a longer code never
# counts, such as part of a ten-character receipt number.
TOKEN_CANDIDATE = re.compile(r"(?<![A-Za-z0-9])[A-Z0-9]{8}(?![A-Za-z0-9])")


def attest(statement_pages):
    """Confirm the statement is an M-PESA statement and give its verification token.

    Args:
        statement_pages: The statement's positioned text. Only page 1 is read.

    Returns:
        The verification token, as printed.

    Raises:
        AttestationError: With ``NO_PAGES``, ``BRAND_MISSING``, ``ANCHOR_MISSING`` or
            ``TOKEN_MISSING``, checked in that order. The error carries a code only (ADR 0004).

    Side Effects:
        None.
    """
    if not statement_pages["pages"]:
        raise AttestationError(AttestationCode.NO_PAGES)
    text = page_text(statement_pages["pages"][0])
    if BRAND not in text.upper():
        raise AttestationError(AttestationCode.BRAND_MISSING)
    if not any(anchor.search(text) for anchor in AUTHENTICITY_ANCHORS):
        raise AttestationError(AttestationCode.ANCHOR_MISSING)
    return _verification_token(text)


def verification_instruction(statement_pages):
    """Give the verification instruction page 1 prints, for the app to show as printed.

    Args:
        statement_pages: The statement's positioned text. Only page 1 is read.

    Returns:
        The first printed line on page 1 holding a "dial" USSD instruction, its runs of spaces
        collapsed; None if page 1 prints none, or if that line looks like it holds a phone
        number or an email, so personal data never leaves the core this way.

    Side Effects:
        None.
    """
    if not statement_pages["pages"]:
        return None
    for line in page_text(statement_pages["pages"][0]).splitlines():
        if DIAL_INSTRUCTION.search(line):
            if PHONE_LIKE.search(line) or EMAIL_LIKE.search(line):
                return None
            return " ".join(line.split())
    return None


def page_text(page):
    """Read a page's printed text in reading order.

    Args:
        page: One page of positioned text items.

    Returns:
        One line per printed line, top to bottom, each with its items left to right and joined by
        a space.

    Side Effects:
        None.
    """
    return "\n".join(
        " ".join(text_item["text"] for text_item in line.items) for line in group_lines(page)
    )


def _verification_token(text):
    """Find the token: the first mixed letter and digit code at or after the instruction.

    Args:
        text: Page 1's text in reading order.

    Returns:
        The token.

    Raises:
        AttestationError: With ``TOKEN_MISSING`` if no candidate mixes letters and digits.

    Side Effects:
        None.
    """
    anchor = VERIFICATION_ANCHOR.search(text)
    search_window = text[anchor.start() :] if anchor else text
    for candidate in TOKEN_CANDIDATE.findall(search_window):
        if _mixes_letters_and_digits(candidate):
            return candidate
    raise AttestationError(AttestationCode.TOKEN_MISSING)


def _mixes_letters_and_digits(candidate):
    """Tell whether a code holds at least one letter and at least one digit.

    Args:
        candidate: An eight-character code.

    Returns:
        True if it mixes both.

    Side Effects:
        None.
    """
    return any(char.isalpha() for char in candidate) and any(char.isdigit() for char in candidate)
