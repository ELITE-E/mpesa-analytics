# Behaviour changes log

Rule (standards 11.2): a deliberate change in behaviour compared with the old mpesa-parser is a separate, approved change. Each entry has its own failing test, written first, and its own change. Nothing changes silently.

Status values: **Proposed** (not yet approved by the owner), **Approved**, **Done** (test and change merged), **Rejected**.

## Planned changes

| ID | Change | Old behaviour | New behaviour | Failing test written first | Status |
|---|---|---|---|---|---|
| D-01 | Compare plain values, not enum members, in cash flow | Without pyarrow, inflow, outflow and net are silently 0.0 | Real totals, with pyarrow absent | `test_cash_flow_totals_are_correct_with_pyarrow_absent`, `test_rows_holding_enum_members_give_the_same_report_as_plain_text`. Cause, measured at CP6 under pandas 3.0.2 without pyarrow: pandas turns the comparison value into text, and the old `(str, Enum)` member's text is `CashFlowDirection.INFLOW`, so nothing matched | Done at CP6, owner instruction; not yet committed |
| D-02 | Remove the reference to the commented-out `LIABILITY_REPAYMENT` | `AttributeError` if that branch is reached | No error; no change to any classification | `test_economic_meaning_resolution_never_raises_on_the_loan_repayment_branch` | Done at CP5, owner instruction; not yet committed |
| D-03 | Extraction failure raises a typed error | "No tables found" gives an empty frame, then `KeyError: details` | `ExtractionError` with a code, from both engines: `LAYOUT_UNRECOGNIZED`, or `NOT_A_PDF`, `PASSWORD_REQUIRED`, `PASSWORD_INCORRECT`, `CORRUPT_PDF` from the engine | `test_no_tables_found_raises_layout_unrecognized_instead_of_returning_an_empty_result`, `test_no_anchor_rows_raises_rather_than_returning_nothing` | Done at CP3, owner instruction; not yet committed |
| D-04 | Stop logging raw values; count unparsed amounts | `utils.py` logs the raw value; unparseable balance becomes 0.0 silently | No value logged; the count appears in data quality. The 0.0 domain rule is unchanged | `test_unparseable_amount_is_zero_and_logs_nothing` (cleaning), `test_unparsed_amounts_are_counted_per_cell` (reconcile) | Done at CP4, owner instruction; not yet committed |
| D-07 | Index parents by receipt number | Fee attribution scans every row for every fee | Same nearest-row rule, linear time | `test_a_fee_between_two_equidistant_parents_goes_to_the_earlier_row` | Done at CP5, owner instruction; not yet committed |
| D-06 | Define a tie rule for equal timestamps | Default `sort_values`, tie order unspecified, so the closing balance could be either tied row | Opening and closing balance follow print order, in the orientation `reconcile` reads: newest first, the closing balance is the first printed row's and the opening balance is worked back from the last printed row (balance minus paid in plus withdrawn). They go in the new `PipelineResult` field `balances`, not in the report, whose keys and values stay as they were; the statement summary check uses the same rule | `test_closing_balance_on_a_tied_latest_time_follows_print_order_not_the_clock`, `test_closing_balance_with_a_tied_latest_time_is_the_newest_row_in_print_order` (F-TIES), `test_closing_balance_is_the_newest_row_in_print_order_when_printed_oldest_first` (ledger) | Done at CP7a, owner instruction; not yet committed. The report's `cash_flow.closing_balance` keeps the old pandas order, so on a tied latest time it can differ from `balances` |
| D-10 | A statement must print at least two values in every amount column | Any table reads, however few amounts it holds | Fewer than two values in paid in, withdrawn or balance raises `LAYOUT_UNRECOGNIZED`, because the three columns are told apart only by position (ADR 0009). A short or one-sided statement, such as one with no money in, cannot be read | `test_column_seen_only_once_cannot_calibrate`, `test_column_never_seen_cannot_calibrate` | Proposed: follows the CP3 calibration rules as written; owner to decide whether these statements must be readable |
| A-1 | Compare money at cents | Exact float comparison in 45 old assertions | Compare rounded to 0.01 | totals agree within 0.005 on the synthetic golden statement | Deferred: changes figures; decide with data (CP6). Old pandas behaviour kept |
| A-2 | Parse each row's date in its own format | `to_datetime(errors="coerce")` takes the first value's format; later rows in another format become missing | Each row parsed on its own | a later row in a different format keeps its date | Deferred: changes figures; decide with data (CP6). Old pandas behaviour kept |
| A-3 | Keep rows with a bad or missing date | `_filter_by_period` silently drops them | Row kept and counted under data quality | Measured at CP6: under the pinned pandas 3.0.2 the old period filter does not drop such a row, it raises, because a missing date cannot be compared with a date. Kept, and pinned by `test_unreadable_date_in_a_date_based_analysis_raises_as_the_old_code_does` | Deferred: changes figures; decide with data (CP6). Old pandas behaviour kept |
| A-4 | Missing purchase date no longer crashes | `_public_value` raises on a missing date | Value shaped as null | `test_missing_purchase_date_does_not_stop_the_report` | Done at CP6, owner instruction; not yet committed |
| A-5 | Empty input returns zeros | Engine-less empty input raises `KeyError` in totals | Empty totals are 0.0 | `test_empty_input_gives_zero_totals` | Done at CP6, owner instruction; not yet committed |

| B-1 | Attestation reads page 1 of the statement pages | The brand could be found in the PDF metadata or page 1's text; the token in page 1's text, as pypdf orders it | Brand, anchor and token are read from page 1's printed text only, lines top to bottom, items left to right; statement pages carry no metadata. Errors carry an `AttestationCode` | `test_only_page_one_is_read`, `test_lines_are_read_top_to_bottom_whatever_the_item_order` | Done at CP7a, owner instruction (no pypdf in the core); not yet committed. If a real statement prints the brand only in metadata, it now fails `BRAND_MISSING`: the owner's `compare.py` run reports `attestation` |
| B-2 | The run attests before it builds rows | Attestation ran before extraction | Same order: `pipeline.run` calls `attest` first, so pages that are not an M-PESA statement fail with `AttestationError`, not `LAYOUT_UNRECOGNIZED` | `test_unbranded_pages_raise_an_attestation_error_before_rows_are_read` | Done at CP7a; same as the old order, recorded so it is not changed by accident |

IDs D-01 to D-09 are the carried defects in `INVENTORY.md` of the migration plan. D-10 arose at CP3. IDs A-1 to A-5 come from the pandas audit (items 9 to 13 and 19).

## Not changed on purpose

| ID | What stays | Why |
|---|---|---|
| D-05 | A row with both or neither amount still raises and aborts the statement | Equivalence first. It raises `DomainRowError` holding the row position only (`test_row_with_both_or_neither_amount_stops_the_run_naming_only_its_position`). Reconsider after CP5 |
| D-08 | `normalize` reformatters keep their unanchored search and replace the whole text | `test_whole_text_is_replaced_when_a_pattern_is_found_anywhere` pins it. The three places are listed in `cleaning-behaviour.md`; changing them is a separate decision |
| D-09 | `Customer Payment to Small Business` keeps its entity grammar and has no classifier rule | Deferred item B1 |
| float amounts | Amounts stay `float` | Float precision (A-08) is an open release item, not a silent change |
| canonical names | The old cleaning step names the status `transaction_status` and has no `paid_out`; the old classifier renames `withdrawn` to `paid_out`. `CanonicalRow` (CP1) says `status`, and carries `paid_out` with the same value as `withdrawn` | Names only: no value changes. The classifier port must not rename again (`cleaning-behaviour.md`). Still open since CP4. Recommended default: keep `status` and `paid_out`, the CP1 contract names the frontend will read; `compare.py` already maps the old names, so nothing changes |
| no entity | The old entity step returns a fixed marker string when no grammar matches | `extract_entity` returns None, which is what `ClassifiedRow.entity` (`str \| None`) says. Representation only: `compare.py` treats the old marker as None |
| diagnostics | The old classifier and entity step append records with the details text to a log file | Returned in memory with a code, the row position and the details for the user's own screen (ADR 0004); nothing is logged or written |
| A-3 typed | An unreadable date still stops a date-based analysis (A-3 deferred) | Since CP7a it raises `AnalysisError` code `DATE_UNREADABLE` with the first such row, instead of pandas' `TypeError`; the pandas error stays as the cause. Same outcome, typed for the bridge (ADR 0004) |
| report numbers | Report figures are the same values | Since CP7a numpy numbers in the report are given as Python numbers of equal value, so the result holds plain JSON values only (`test_report_holds_plain_python_numbers_never_numpy_ones`) |
| summary check | The report and every old behaviour; the old code never read the page 1 summary | Quality only. Since CP7a-3 `DataQuality` reads the real summary block: `summary_total_paid_in_matches` and `summary_total_paid_out_matches` (half a cent, None when TOTAL is missing) and `summary_type_rows_parsed`, replacing `summary_reconciliation` and its invented labels. Not a gate |
| blank status | A missing status stays missing after cleaning, as before | `CanonicalRow.status` is typed `str`, so a blank status breaks the type annotation. Owner to decide between `str \| None` and a filled value; until then the old behaviour wins. Still open since CP4. Recommended default: type it `str \| None`, an annotation change only, so no value or figure changes (run 1 found 0 blank statuses in 5,698 rows) |

## Why this log exists

The rewrite from mpesa-parser preserves behaviour first and changes it second. If the two are mixed, a reviewer cannot tell a porting bug from an intended change, and ported tests stop being evidence. So any deliberate change is its own change, separate from refactoring or porting. An entry may be planned before the work starts.

## Enforcement

`tests/guards/test_standards_docs.py` checks that this log exists and lists the known planned changes. Whether a given diff contains an unlogged behaviour change can only be judged in review, using the "Change discipline" group of the checklist.

## How to add an entry

1. State the old and new behaviour in one line each.
2. Write the failing test and note its name.
3. Get owner approval, then set the status to Approved.
4. Make the change; set Done and link the commit.
