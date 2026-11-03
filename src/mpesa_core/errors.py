"""Core exception types. Messages carry codes, positions and counts only (ADR 0004).

Constructors accept nothing that could hold statement text, so a value from a row cannot reach
an error message, a console or a bug report by accident.
"""

from enum import Enum


class ErrorCode(Enum):
    """Why extraction failed. The bridge passes these to the UI unchanged."""

    LAYOUT_UNRECOGNIZED = "LAYOUT_UNRECOGNIZED"
    NOT_A_PDF = "NOT_A_PDF"
    PASSWORD_REQUIRED = "PASSWORD_REQUIRED"
    PASSWORD_INCORRECT = "PASSWORD_INCORRECT"
    CORRUPT_PDF = "CORRUPT_PDF"
    TOO_LARGE = "TOO_LARGE"
    TOO_MANY_PAGES = "TOO_MANY_PAGES"
    TIMEOUT = "TIMEOUT"


class CoreError(Exception):
    """Base class for every error the core raises deliberately."""


class ExtractionError(CoreError):
    """The PDF engine could not produce statement pages."""

    def __init__(self, code, *, page=None):
        """Record why extraction failed and, if known, where.

        Args:
            code: The ``ErrorCode`` member naming the failure.
            page: One-based page number, if the failure has a position.

        Raises:
            TypeError: If ``code`` is not an ``ErrorCode`` or ``page`` is not an integer.

        Side Effects:
            None.
        """
        if not isinstance(code, ErrorCode):
            raise TypeError("code must be an ErrorCode member")
        self.code = code
        self.page = None if page is None else _checked_position("page", page)
        position = "" if page is None else f" on page {page}"
        super().__init__(f"{code.value}{position}")


class AttestationError(CoreError):
    """A statement could not be tied to its verification token."""

    def __init__(self, *, expected_count=None, found_count=None):
        """Record the counts that disagreed, if there are any.

        Args:
            expected_count: How many items the statement should have.
            found_count: How many items were found.

        Side Effects:
            None.
        """
        self.expected_count = _checked_optional("expected_count", expected_count)
        self.found_count = _checked_optional("found_count", found_count)
        counts = []
        if expected_count is not None:
            counts.append(f"expected {expected_count}")
        if found_count is not None:
            counts.append(f"found {found_count}")
        super().__init__(" ".join(["attestation failed", *counts]))


class DomainRowError(CoreError):
    """One row broke a domain rule, identified only by its position."""

    def __init__(self, row_index):
        """Record which row broke the rule.

        Args:
            row_index: Zero-based index of the row in print order.

        Side Effects:
            None.
        """
        self.row_index = _checked_position("row_index", row_index)
        super().__init__(f"domain rule failed at row {row_index}")


def _checked_optional(name, position):
    """Validate a position or count that may be absent.

    Args:
        name: Parameter name, used in the error message.
        position: The value passed by the caller, or None.

    Returns:
        The value unchanged.

    Side Effects:
        None.
    """
    return None if position is None else _checked_position(name, position)


def _checked_position(name, position):
    """Validate a position or count, without ever repeating the value in the error.

    Args:
        name: Parameter name, used in the error message.
        position: The value passed by the caller.

    Returns:
        The value unchanged.

    Raises:
        TypeError: If the value is not an integer. ``bool`` is rejected too.
        ValueError: If the value is negative.

    Side Effects:
        None.
    """
    if type(position) is not int:
        raise TypeError(f"{name} must be an integer")
    if position < 0:
        raise ValueError(f"{name} must not be negative")
    return position
