# 0009. Column calibration and row assembly

Status: Accepted for CP3. Open questions OQ-03 and OQ-10 stay open until the real statement's counts are in.
Date: 2026-11-04

## Context

The owner's calibration rules are the spec: group by `top` within 1.0 pt, calibrate only from anchor rows, cluster left-aligned columns by `x0` and right-aligned columns by `x1` within 0.5 pt, use header labels for order only, and raise `LAYOUT_UNRECOGNIZED` rather than return nothing. Applying them needed the decisions below, some of which the rules leave open.

**Measured:** pdf.js reports whitespace-only items with zero height, so their `top` is the text's baseline, about one font size below the text's own `top`. On F-GOLDEN that is 5.5 to 6 pt, which is the wrap gap. These items are common: 259 of 672 items on F-GOLDEN.

## Decision

**Receipt pattern.** `RECEIPT_PATTERN` in `columns.py` is 10 uppercase alphanumerics, fully matched. A date item qualifies if it starts `YYYY-MM-DD hh:mm:ss`, or is a date followed by a clock item. Text after the timestamp in the same item moves to the start of details.

**Whitespace.** Whitespace-only items never start a line and never enter calibration. Otherwise they would create phantom lines exactly where wrapped lines sit. Each is kept on the line whose `top` or baseline it matches, and is used only to decide whether two touching items of one cell are separate words. Items further apart than 1 pt are separate words anyway. They do not count towards a row's `line`.

**Clusters.** Every member sits within 0.5 pt of the cluster's middle, so a cluster spans at most 1 pt. Linking neighbours instead would split two values at the extremes of a 0.4 pt jitter, which is 0.8 pt apart. Text columns use the largest cluster. Amount columns need exactly three clusters of at least two values, read left to right as paid in, withdrawn, balance. Three is what gives each one its identity, since header positions may not be used.

**Header rows.** A line holding all seven first words is a header row. Out of order raises. A statement with no recognizable header row still calibrates, because labels only ever confirm order, and the columns are identified from anchor rows. A header row is a barrier: nothing above it joins a row below it.

**OQ-03, continuation lines above the anchor.** Lines within the wrap gap of each other form a block. Lines above the block's first anchor go above it, lines after an anchor go below it. Both are counted (`continuation_lines_above`, `continuation_lines_below`). A line between two anchors in one block cannot be placed from position alone: it goes below the upper anchor, the rules' default, and is counted as `ambiguous_continuation_lines`. The wrap gap is 6 pt plus the 1 pt line tolerance.

**The first line of page 1.** "Exclude everything before the first anchor" and "support continuation above" collide for the first row. A header row settles it: lines between the header and the first anchor can only be continuation. With no header row, everything before the first anchor is excluded.

**Status.** A non-anchor line adds to details only if its item starts in the details column; where it ends does not matter, so a long wrap can overrun without reaching status. An item aligned with the status column fills the status only if the anchor printed none, counted as `status_from_non_anchor_line`.

**Anomalies are counted, not guessed around.** An item fitting no column stays out of the row and counts as `unassigned_items`. A receipt or time off its column counts as `anchor_cells_off_column`. A block with no anchor counts as `unattached_lines`, which includes every footer. Continuation does not cross pages.

**Print orientation and fees.** The chain is checked newest-first and oldest-first. The one with fewer breaks is recorded; a tie reads as newest-first. Each break counts under one kind, most specific first: same receipt, tied timestamp, page boundary, other. Printed withdrawn is read as a size, so a negative print also works. A blank balance counts as an unparsed amount. A link with an unreadable amount proves nothing and is not a break.

**OQ-10, receipt length.** The histogram is read from the pages, not the rows, by measuring what sits left of each date. A row only exists for a 10-character receipt, so a histogram of rows could never show a different length.

**Comparing with the old extractor (`baseline`).** `export_baseline.py` runs under the old repo's Python, uses only the standard library, and runs the old code from inside `--out`, so logs it writes cannot land in a repo. `compare.py` pairs rows by an HMAC under a key made for that run. The gates on status and chain breaks pass when every difference is counted, because the owner decides what those differences mean.

## Alternatives considered

| Option | Tradeoff |
|---|---|
| Linked clusters, each neighbour within 0.5 pt | Reads the tolerance literally; splits two values at opposite ends of a jitter |
| Group whitespace items by `top` like any other | Simple; invents a line about 6 pt under every row |
| Raise when no header row is found | Stricter; a harmless label change would hide every other count at the go/no-go check |
| Take the three largest amount clusters when more appear | Survives a shifted page; guesses which values are real. Raising shows it instead |
| Identify an amount column from balance movement when it never prints | Would read one-sided statements; a guess from values. See D-10 |

## Consequences

- **A statement with fewer than two values in any amount column raises `LAYOUT_UNRECOGNIZED`.** The old extractor read these, so this is a behaviour change. It is logged as D-10 for the owner to decide.
- **F-TIES had no paid-in values, so it could not calibrate.** Its generator now makes one pair in three money in; its existing tests are unchanged. The other committed PDFs kept their bytes.
- A page whose columns all moved by more than the tolerance raises if two or more of its rows move an amount column the same way, and is counted otherwise.
- The summary labels (`Total Paid In` and so on) are the generator's. **None has been checked against a real statement.** If the real wording differs they read `not_found`, which is not a gate.
- The header words and the 6 pt gap come from the plan, and the profiler's assumptions in ADR 0008 apply. The real statement's counts test them.
- `DataQuality` grew. `chain_breaks` keeps its meaning and counts the recorded orientation.

## Enforcement

`tests/core/test_columns.py`, `test_rows.py` and `test_reconcile.py` run under CPython and Pyodide. `tests/engines/test_differential.py` requires pdf.js rows = pdfplumber rows = the independent ledger on every fixture. `tests/equivalence` plants text and checks it never prints. `tests/guards/test_standards_docs.py` checks this record, D-03 and D-10 are present.
