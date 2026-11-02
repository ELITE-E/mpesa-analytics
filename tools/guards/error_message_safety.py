"""Test helper: reject exception messages that carry statement values (ADR 0004)."""

import re

from _common import find_tokens

# Shorter values are indistinguishable from row numbers and counts, so they are skipped.
MIN_VALUE_LENGTH = 3


class StatementValueInMessageError(ValueError):
    """An error message contains a statement value. Holds a count, never the value."""


def assert_message_is_safe(message, row_values):
    """Reject a message that repeats a value from the row it describes.

    Args:
        message: The exception message under test.
        row_values: Map of column name to the planted value in that row.

    Raises:
        StatementValueInMessageError: If the message holds any statement value.

    Side Effects:
        None.
    """
    count = count_statement_values(message, row_values)
    if count:
        raise StatementValueInMessageError(f"statement values in message: {count}")


def count_statement_values(message, row_values):
    """Count the row values and token-shaped strings in a message.

    Args:
        message: The exception message under test.
        row_values: Map of column name to the planted value in that row.

    Returns:
        Number of row values found, plus phone or receipt shaped tokens.

    Side Effects:
        None.
    """
    normalized = _normalize(message)
    values = {_normalize(value) for value in row_values.values()}
    found = sum(
        len(value) >= MIN_VALUE_LENGTH
        and re.search(rf"(?<![0-9a-z]){re.escape(value)}(?![0-9a-z])", normalized) is not None
        for value in values
    )
    return found + len(find_tokens(message))


def _normalize(text):
    """Remove the formatting differences that would hide a repeated value.

    Args:
        text: A message or a row value.

    Returns:
        Casefolded text with thousands commas removed and spacing collapsed.

    Side Effects:
        None.
    """
    return " ".join(text.casefold().replace(",", "").split())
