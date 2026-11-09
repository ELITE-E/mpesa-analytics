"""Normalize details text, with the same results as mpesa-parser.

Classification reads the result, so any change here changes how transactions are classified. The
rules, in order, are in docs/decisions/cleaning-behaviour.md.
"""

import re

REFERENCE_PATTERN = re.compile(r"\(Ref:.*?\)")
PAYBILL_PATTERN = re.compile(r"PayBill\s*-\s*(\d+)\s*-\s*(.*)", re.IGNORECASE)
TILL_PATTERN = re.compile(r"(?:Till|Buy\s*Goods)\s*-\s*(\d+)\s*-\s*(.*)", re.IGNORECASE)
PERSON_TO_PERSON_PATTERN = re.compile(
    r"(?:Sent\s+to|Received\s+from)\s+(?:\+?254|0)?\d{9}\s*-?\s*(.*)", re.IGNORECASE
)
GLUED_IDENTIFIER_PATTERN = re.compile(r"\b(\d{5,7})([A-Z])")
PRESENTATION_SEPARATORS = ("|", "\\", "-")
BRAND = "M-PESA"
BRAND_SPELLINGS = (r"\bM\s*PESA\b", r"\bMPESA\b", r"\bm-pesa\b")
WHITESPACE_RUN = re.compile(r"\s+")


def normalize_name(details):
    """Turn printed details into the text that classification and entity detection read.

    Pay bill and till texts become the name followed by the number, for example
    ``"PayBill - 888001 - Example Till 123"`` becomes ``"Example Till 123 888001"``.
    Person-to-person texts become the name alone. All other text is only tidied.

    The three rewrites search anywhere in the text and replace all of it, so words before the match
    are lost. That is the old behaviour, kept on purpose (D-08).

    Args:
        details: The printed details, or None.

    Returns:
        The normalized text; the empty string for missing or empty details.

    Side Effects:
        None.
    """
    if not details:
        return ""
    normalized = REFERENCE_PATTERN.sub("", details)
    normalized = _rewrite_as_name_and_number(normalized, PAYBILL_PATTERN)
    normalized = _rewrite_as_name_and_number(normalized, TILL_PATTERN)
    normalized = _rewrite_as_person_name(normalized)
    return _tidy(normalized)


def _rewrite_as_name_and_number(text, pattern):
    """Replace the whole text with the name and number a pay bill or till pattern found in it.

    Args:
        text: The details so far.
        pattern: ``PAYBILL_PATTERN`` or ``TILL_PATTERN``, whose groups are the number and the name.

    Returns:
        The name, a space and the number, or the text unchanged if the pattern is not found.

    Side Effects:
        None.
    """
    match = pattern.search(text)
    if match is None:
        return text
    number, name = match.groups()
    return f"{name.strip()} {number.strip()}"


def _rewrite_as_person_name(text):
    """Replace the whole text with the name a sent-to or received-from pattern found in it.

    Args:
        text: The details so far.

    Returns:
        The name, without the phone number or direction words, or the text unchanged if the pattern
        is not found.

    Side Effects:
        None.
    """
    match = PERSON_TO_PERSON_PATTERN.search(text)
    return text if match is None else match.group(1).strip()


def _tidy(text):
    """Remove line breaks, presentation separators and surplus spaces, and fix known spellings.

    Args:
        text: The details so far.

    Returns:
        Single-spaced text with no line break, vertical bar, backslash or hyphen, except the hyphen
        in ``M-PESA``. A run of five to seven digits stuck to a capital letter gets a space, as in
        ``"1234567EXAMPLE"`` becoming ``"1234567 EXAMPLE"``.

    Side Effects:
        None.
    """
    if not text:
        return ""
    text = text.replace("\n", " ")
    for separator in PRESENTATION_SEPARATORS:
        text = text.replace(separator, " ")
    text = GLUED_IDENTIFIER_PATTERN.sub(r"\1 \2", text)
    # After the separators go: this puts back the brand's hyphen they just removed.
    for spelling in BRAND_SPELLINGS:
        text = re.sub(spelling, BRAND, text, flags=re.IGNORECASE)
    return WHITESPACE_RUN.sub(" ", text).strip()
