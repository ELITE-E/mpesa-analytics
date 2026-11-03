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
    """Everything the PDF engine returns for one statement, before any row exists."""

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
    entity: str | None


class Diagnostic(TypedDict):
    """One row that could not be resolved. Held in memory only (ADR 0004)."""

    code: str
    row_index: int
    details: str | None


class DataQuality(TypedDict):
    """Counts of problems found while processing a statement."""

    row_count: int
    status_counts: dict[str, int]
    chain_breaks: int
    unparsed_amounts: int


class PipelineResult(TypedDict):
    """What the core returns for one statement."""

    schema_version: int
    transactions: list[ClassifiedRow]
    quality: DataQuality
    diagnostics: list[Diagnostic]
