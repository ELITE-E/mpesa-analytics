# Behaviour changes log

Rule (standards 11.2): a deliberate change in behaviour compared with the old mpesa-parser is a separate, approved change. Each entry has its own failing test, written first, and its own change. Nothing changes silently.

Status values: **Proposed** (not yet approved by the owner), **Approved**, **Done** (test and change merged), **Rejected**.

## Planned changes

| ID | Change | Old behaviour | New behaviour | Failing test written first | Status |
|---|---|---|---|---|---|
| D-01 | Compare plain values, not enum members, in cash flow | Without pyarrow, inflow, outflow and net are silently 0.0 | Real totals, with pyarrow absent | cash flow totals are correct with pyarrow blocked | Proposed |
| D-02 | Remove the reference to the commented-out `LIABILITY_REPAYMENT` | `AttributeError` if that branch is reached | No error; no change to any classification | economic meaning resolution never raises on that branch | Proposed |
| D-03 | Extraction failure raises a typed error | Empty frame, then `KeyError: details` | `ExtractionError` with a code | a statement with no recognizable layout raises `LAYOUT_UNRECOGNIZED` | Proposed |
| D-04 | Stop logging raw values; count unparsed amounts | `utils.py` logs the raw value; unparseable balance becomes 0.0 silently | No value logged; the count appears in data quality. The 0.0 domain rule is unchanged | an unparseable balance increments `unparsed_amounts` and logs nothing | Proposed |
| D-07 | Index parents by receipt number | Fee attribution scans every row for every fee | Same nearest-row rule, linear time | a fee between two equidistant parents goes to the earlier row | Proposed |
| D-06 | Define a tie rule for equal timestamps and equal amounts | Default `sort_values`, tie order unspecified | Ties keep statement print order (stable) | closing balance with a tied latest timestamp follows print order | Proposed |
| A-1 | Compare money at cents | Exact float comparison in 45 old assertions | Compare rounded to 0.01 | totals agree within 0.005 on the synthetic golden statement | Proposed |
| A-2 | Parse each row's date in its own format | `to_datetime(errors="coerce")` takes the first value's format; later rows in another format become missing | Each row parsed on its own | a later row in a different format keeps its date | Proposed |
| A-3 | Keep rows with a bad or missing date | `_filter_by_period` silently drops them | Row kept and counted under data quality | a row with an unreadable date appears in the ledger and in the count | Proposed |
| A-4 | Missing purchase date no longer crashes | `_public_value` raises on a missing date | Value shaped as null | a purchase with no date serializes with a null date | Proposed |
| A-5 | Empty input returns zeros | Engine-less empty input raises `KeyError` in totals | Empty totals are 0.0 | an empty statement gives zero totals and no error | Proposed |

IDs D-01 to D-09 are the carried defects in `INVENTORY.md` of the migration plan. IDs A-1 to A-5 come from the pandas audit (items 9 to 13 and 19).

## Not changed on purpose

| ID | What stays | Why |
|---|---|---|
| D-05 | A row with both or neither amount still raises and aborts the statement | Equivalence first. Report the row position only. Reconsider after CP3 |
| D-08 | `normalize` reformatters keep their unanchored search | A test pins the behaviour; changing it is a separate decision |
| D-09 | `Customer Payment to Small Business` keeps its entity grammar and has no classifier rule | Deferred item B1 |
| float amounts | Amounts stay `float` | Float precision (A-08) is an open release item, not a silent change |

## Why this log exists

The rewrite from mpesa-parser preserves behaviour first and changes it second. If the two are mixed, a reviewer cannot tell a porting bug from an intended change, and ported tests stop being evidence. So any deliberate change is its own change, separate from refactoring or porting. An entry may be planned before the work starts.

## Enforcement

`tests/guards/test_standards_docs.py` checks that this log exists and lists the known planned changes. Whether a given diff contains an unlogged behaviour change can only be judged in review, using the "Change discipline" group of the checklist.

## How to add an entry

1. State the old and new behaviour in one line each.
2. Write the failing test and note its name.
3. Get owner approval, then set the status to Approved.
4. Make the change; set Done and link the commit.
