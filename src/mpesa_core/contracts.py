"""Typed shapes passed between pipeline stages. Types only, with no behaviour.

Amounts stay ``float`` until the open float-precision item is decided (behaviour-changes.md).
"""

from typing import TypedDict

SCHEMA_VERSION = 1


class TextItem(TypedDict):
    """One piece of text with its position on the page, in points from the top left."""

    text: str
    x0: float
    x1: float
    top: float
    bottom: float


class Page(TypedDict):
    """One printed page of a statement, as positioned text."""

    page_number: int
    width: float
    height: float
    items: list[TextItem]


class StatementPages(TypedDict):
    """Everything the PDF reader returns for one statement, before any row exists."""

    schema_version: int
    engine: str
    pages: list[Page]


class RawRow(TypedDict):
    """One transaction as printed, before cleaning. Fields hold the printed text."""

    receipt_no: str | None
    completion_time: str | None
    details: str | None
    status: str | None
    paid_in: str | None
    withdrawn: str | None
    balance: str | None
    page: int
    line: int


class LayoutCounts(TypedDict):
    """Counts of what row building met on the page, instead of guessing around it (ADR 0009)."""

    continuation_lines_above: int
    continuation_lines_below: int
    ambiguous_continuation_lines: int
    status_from_non_anchor_line: int
    unassigned_items: int
    unattached_lines: int
    unattached_header_lines: int
    unattached_footer_lines: int
    unattached_summary_lines: int
    unattached_page_heading_lines: int
    unattached_other_lines: int
    anchor_cells_off_column: int


class OtherLinePosition(TypedDict):
    """Where a page heading, or a line of no known kind, sits. A position only, never text."""

    page: int
    offset_from_header: float | None


class RowAssembly(TypedDict):
    """Rows built from statement pages, with counts describing how they were built."""

    rows: list[RawRow]
    printed_line_counts: list[int]
    layout_counts: LayoutCounts
    unattached_page_heading_positions: list[OtherLinePosition]
    unattached_other_positions: list[OtherLinePosition]


class CanonicalRow(TypedDict):
    """A row after cleaning: typed amounts and normalized details."""

    receipt_no: str
    completion_time: str
    details: str
    status: str
    paid_in: float
    withdrawn: float
    paid_out: float
    balance: float


class ClassifiedRow(CanonicalRow):
    """A transaction: a canonical row plus its classification."""

    event_type: str
    cash_flow_direction: str
    economic_meaning: str
    total_cost: float
    entity: str | None


class Diagnostic(TypedDict):
    """One row that could not be resolved. Held in memory only (ADR 0004)."""

    code: str
    row_index: int
    details: str | None


class ChainBreakCounts(TypedDict):
    """Chain breaks in one print orientation, by what the two rows have in common."""

    same_receipt: int
    tied_timestamp: int
    page_boundary: int
    other: int


class DataQuality(TypedDict):
    """Counts of problems found while processing a statement. Never any row text (ADR 0004).

    ``chain_breaks`` counts the orientation named by ``chain_orientation``, the one with fewer.
    In ``summary_reconciliation`` a label maps to whether it agrees, or None if it was not found.
    """

    row_count: int
    status_counts: dict[str, int]
    chain_breaks: int
    chain_orientation: str
    chain_break_counts: dict[str, ChainBreakCounts]
    unparsed_amounts: int
    summary_reconciliation: dict[str, bool | None]
    receipt_length_histogram: dict[int, int]
    # From ``measure_unclassified``, over the classified rows. Not part of the report.
    unclassified_rows: int
    unclassified_share: float
    unclassified_paid_in: float
    unclassified_withdrawn: float


class PipelineResult(TypedDict):
    """What the core returns for one statement."""

    schema_version: int
    transactions: list[ClassifiedRow]
    quality: DataQuality
    diagnostics: list[Diagnostic]
