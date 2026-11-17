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
    # Some amount columns were found, but another printed fewer than two values (CP8b): too few
    # money-in or money-out entries to place it. Relaxing this is on the CP10 list.
    TOO_FEW_AMOUNTS = "TOO_FEW_AMOUNTS"


class AnalysisCode(Enum):
    """Why the analysis stopped. The bridge passes these to the UI unchanged."""

    DATE_UNREADABLE = "DATE_UNREADABLE"
    ANALYSIS_FAILED = "ANALYSIS_FAILED"


class AttestationCode(Enum):
    """Why a statement could not be tied to its verification token."""

    NO_PAGES = "NO_PAGES"
    BRAND_MISSING = "BRAND_MISSING"
    ANCHOR_MISSING = "ANCHOR_MISSING"
    TOKEN_MISSING = "TOKEN_MISSING"


class ImportPlanCode(Enum):
    """Why an import plan could not be made or was refused."""

    REQUEST_INVALID = "REQUEST_INVALID"
    INCOMING_ROW_INVALID = "INCOMING_ROW_INVALID"
    EXISTING_ROW_INVALID = "EXISTING_ROW_INVALID"
    ROW_ACTION_COUNT = "ROW_ACTION_COUNT"
    PRESERVE_NOT_COLLISION = "PRESERVE_NOT_COLLISION"
    PLAN_MISMATCH = "PLAN_MISMATCH"


class CoreError(Exception):
    """Base class for every error the core raises deliberately."""


class ExtractionError(CoreError):
    """The PDF reader could not produce statement pages."""

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

    def __init__(self, code, *, expected_count=None, found_count=None):
        """Record why attestation failed and the counts that disagreed, if there are any.

        Args:
            code: The ``AttestationCode`` member naming the failure.
            expected_count: How many items the statement should have.
            found_count: How many items were found.

        Raises:
            TypeError: If ``code`` is not an ``AttestationCode`` or a count is not an integer.

        Side Effects:
            None.
        """
        if not isinstance(code, AttestationCode):
            raise TypeError("code must be an AttestationCode member")
        self.code = code
        self.expected_count = _checked_optional("expected_count", expected_count)
        self.found_count = _checked_optional("found_count", found_count)
        counts = []
        if expected_count is not None:
            counts.append(f"expected {expected_count}")
        if found_count is not None:
            counts.append(f"found {found_count}")
        super().__init__(" ".join(["attestation failed", code.value, *counts]))


class AnalysisError(CoreError):
    """The analysis could not finish. Its cause, which may quote a value, stays in ``__cause__``."""

    def __init__(self, code, *, row_index=None):
        """Record why the analysis stopped and, if known, at which row.

        Args:
            code: The ``AnalysisCode`` member naming the failure.
            row_index: Zero-based index, in print order, of the first row involved.

        Raises:
            TypeError: If ``code`` is not an ``AnalysisCode`` or ``row_index`` is not an integer.

        Side Effects:
            None.
        """
        if not isinstance(code, AnalysisCode):
            raise TypeError("code must be an AnalysisCode member")
        self.code = code
        self.row_index = _checked_optional("row_index", row_index)
        position = "" if row_index is None else f" at row {row_index}"
        super().__init__(f"{code.value}{position}")


class ImportPlanError(CoreError):
    """An import plan could not be made, or a plan was refused. Its cause stays in ``__cause__``."""

    def __init__(self, code, *, row_index=None):
        """Record why and, if known, at which row.

        Args:
            code: The ``ImportPlanCode`` member naming the failure.
            row_index: Zero-based index of the row involved, in the list it came from.

        Raises:
            TypeError: If ``code`` is not an ``ImportPlanCode`` or ``row_index`` is not an integer.

        Side Effects:
            None.
        """
        if not isinstance(code, ImportPlanCode):
            raise TypeError("code must be an ImportPlanCode member")
        self.code = code
        self.row_index = _checked_optional("row_index", row_index)
        position = "" if row_index is None else f" at row {row_index}"
        super().__init__(f"{code.value}{position}")


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
