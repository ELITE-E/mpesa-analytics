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
    The summary fields read page 1's summary block (``reconciliation/summary.py``); a total that
    was not found is None, never guessed.
    """

    row_count: int
    status_counts: dict[str, int]
    chain_breaks: int
    # The same count, named beside the count left after reordering groups.
    chain_breaks_raw: int
    # Breaks that some order inside a same-receipt or tied-time group would remove.
    chain_breaks_resolvable_by_reorder: int
    # Breaks that remain after every group is put in its best order.
    chain_breaks_after_reorder: int
    # Whether closing equals opening plus paid in minus withdrawn, to half a cent; None if a
    # balance is unknown.
    identity_holds: bool | None
    chain_orientation: str
    chain_break_counts: dict[str, ChainBreakCounts]
    unparsed_amounts: int
    # Whether the summary's TOTAL paid in and paid out equal the rows', to half a cent; None if
    # the TOTAL row is missing or cannot be read.
    summary_total_paid_in_matches: bool | None
    summary_total_paid_out_matches: bool | None
    # How many of the summary's seven transaction type rows could be read.
    summary_type_rows_parsed: int
    receipt_length_histogram: dict[int, int]
    # From ``measure_unclassified``, over the classified rows. Not part of the report.
    unclassified_rows: int
    unclassified_share: float
    unclassified_paid_in: float
    unclassified_withdrawn: float
    # True when page 1's mobile number cannot be read, so ``account_digest`` is None.
    account_number_unreadable: bool


class Balances(TypedDict):
    """The balance before the oldest row and after the newest, in print order (D-06)."""

    opening_balance: float | None
    closing_balance: float | None


class Period(TypedDict):
    """The earliest and latest readable completion times, as printed; None without any."""

    start: str | None
    end: str | None


class PipelineResult(TypedDict):
    """What the core returns for one statement: plain JSON values only.

    Holds no PDF bytes and no password, which never reach the core, and never the mobile number,
    name or email printed on page 1. ``processed_at`` is whatever time the caller passed in; the
    core reads no clock.

    ``account_digest`` is the SHA-256 digest of page 1's mobile number in its canonical form
    (``reconciliation/account.py``), or None when the number cannot be read, which
    ``quality.account_number_unreadable`` flags. It is in memory only: nine digits are few enough
    to try them all, so the digest identifies the number, and the store must never persist it.
    """

    schema_version: int
    verification_token: str
    # Page 1's printed "dial" instruction, as printed; None if absent or it looks personal.
    verification_instruction: str | None
    account_digest: str | None
    processed_at: str | None
    period: Period
    balances: Balances
    transactions: list[ClassifiedRow]
    report: dict[str, object]
    quality: DataQuality
    diagnostics: list[Diagnostic]


class IdentityResolution(TypedDict):
    """Whether an incoming transaction is new, already known, or collides (``identity.py``).

    Positions refer to the candidates list the caller passed.
    """

    # "new", "match" or "collision".
    outcome: str
    matched_index: int | None
    # Every candidate sharing the candidate key, in the order passed.
    candidate_indices: list[int]
    # The domain observation category, for a collision only.
    anomaly: str | None


class PlanReference(TypedDict):
    """A stored transaction: an existing one, or a row the same plan adds."""

    # "existing" or "incoming".
    source: str
    # Position among the existing transactions, or the incoming row's index.
    index: int


class CollisionObservation(TypedDict):
    """The domain observation the store records for a preserved row."""

    category: str


class ImportAction(TypedDict):
    """What the store does with one incoming row."""

    row_index: int
    # "insert", "link" or "preserve".
    action: str
    # For "link": the transaction the row is.
    target: PlanReference | None
    # For "preserve": every transaction sharing the row's candidate key.
    collides_with: list[PlanReference]
    observation: CollisionObservation | None


class ImportPlanCounts(TypedDict):
    """How many rows are inserted, linked and preserved."""

    new: int
    matched: int
    collided: int


class ImportPlan(TypedDict):
    """A pure description of one statement's import, applied by the store in one transaction."""

    actions: list[ImportAction]
    counts: ImportPlanCounts
