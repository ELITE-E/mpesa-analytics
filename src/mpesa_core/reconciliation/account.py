"""Tie a statement to its account by a digest of the mobile number printed on page 1.

The number, the name and the email never leave this module: only the SHA-256 digest of the
number's one canonical form does. That form is the digits only, as ``254`` followed by the nine
national digits, so every printed form of one number gives one digest.

Nine digits are few enough to try them all, so the digest identifies the number to anyone who
holds it. It is for comparing statements in memory only and must never be persisted (see
``PipelineResult``).
"""

import hashlib
import re

from mpesa_core.reconciliation.attest import page_text

COUNTRY_CODE = "254"
NATIONAL_DIGITS = 9
TRUNK_PREFIX = "0"
# Kenyan mobile numbers start with 7 or 1 after the country code or trunk prefix.
MOBILE_FIRST_DIGITS = ("7", "1")
MOBILE_NUMBER_LINE = re.compile(r"Mobile\s+Number\s*:?\s*(?P<number>.*)$", re.IGNORECASE)
# Only digits, spaces, hyphens and a leading plus, so a name or a masked number never reads as one.
NUMBER_TEXT = re.compile(r"\+?[\d\s-]+")


def account_digest(statement_pages):
    """Give the SHA-256 digest of the mobile number printed on page 1.

    Args:
        statement_pages: The statement's positioned text. Only page 1 is read.

    Returns:
        The lowercase hex digest of the number's canonical form, or None if page 1 prints no
        ``Mobile Number`` label or its value is not a whole mobile number (missing, masked, or
        the wrong length).

    Side Effects:
        None.
    """
    if not statement_pages["pages"]:
        return None
    printed_number = _printed_mobile_number(page_text(statement_pages["pages"][0]))
    canonical = None if printed_number is None else canonical_mobile_number(printed_number)
    if canonical is None:
        return None
    return hashlib.sha256(canonical.encode("ascii")).hexdigest()


def canonical_mobile_number(printed_number):
    """Reduce a printed mobile number to its one canonical form.

    Args:
        printed_number: The number as printed, in local (``07…``), international (``254…``,
            ``+254…``) or bare national form, with any spaces or hyphens.

    Returns:
        ``254`` followed by the nine national digits, or None if the text is not a whole Kenyan
        mobile number.

    Side Effects:
        None.
    """
    if not NUMBER_TEXT.fullmatch(printed_number.strip()):
        return None
    national = _national_digits(re.sub(r"\D", "", printed_number))
    if national is None or not national.startswith(MOBILE_FIRST_DIGITS):
        return None
    return COUNTRY_CODE + national


def _printed_mobile_number(text):
    """Find the value printed after the first ``Mobile Number`` label.

    Args:
        text: A page's text in reading order, one printed line per text line.

    Returns:
        The rest of the label's line, stripped; None if no line holds the label.

    Side Effects:
        None.
    """
    for line in text.splitlines():
        found = MOBILE_NUMBER_LINE.search(line)
        if found:
            return found.group("number").strip()
    return None


def _national_digits(digits):
    """Strip the country code or trunk prefix from a number's digits.

    Args:
        digits: The number's digits only.

    Returns:
        The nine national digits, or None if the digits have no known mobile length.

    Side Effects:
        None.
    """
    if len(digits) == len(COUNTRY_CODE) + NATIONAL_DIGITS and digits.startswith(COUNTRY_CODE):
        return digits[len(COUNTRY_CODE) :]
    if len(digits) == len(TRUNK_PREFIX) + NATIONAL_DIGITS and digits.startswith(TRUNK_PREFIX):
        return digits[len(TRUNK_PREFIX) :]
    if len(digits) == NATIONAL_DIGITS:
        return digits
    return None
