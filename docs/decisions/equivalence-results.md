# Equivalence results on real statements

Counts from the owner's runs of `tools/equivalence/compare.py --share` on a real statement. Counts and labels only: no statement text, values, dates or file names are recorded here (standards 12.5).

## Run 1: CP4, one statement, 2026-11-10

All 12 gates passed: rows, the seven printed fields, status, chain breaks, and the canonical rows after cleaning.

| Measure | Count |
|---|---|
| Rows, old and new | 5,698 and 5,698; all paired, same print order |
| Mismatches in the seven printed fields | 0 |
| Mismatches in the canonical fields | 0 |
| Unassigned items, anchor cells off column, unparsed amounts | 0, 0, 0 |

## Run 2: CP5, the same statement, 2026-11-10

All 18 gates passed: the 12 from run 1, and the classification gates.

| Measure | Count |
|---|---|
| Rows, old and new | 5,698 and 5,698; all paired |
| Mismatches in event type, direction, meaning, entity, total cost, paid out | 0 each |
| Total cost or paid out differing by more than 0.005 | 0 |
| Class-count tables | identical, old and new |

| Event type | Rows |
|---|---|
| MERCHANT_PAYMENT | 1,142 |
| BILL_PAYMENT | 1,017 |
| TRANSFER_IN | 627 |
| TRANSFER_OUT | 519 |
| FEE | 457 |
| BUNDLE_PURCHASE | 445 |
| INVESTMENT | 70 |
| AIRTIME_PURCHASE | 25 |
| REVERSAL | 6 |
| DEPOSIT | 4 |
| UNCLASSIFIED | 1,386 |

Directions: 1,465 inflow, 4,233 outflow. Economic meanings: 2,629 consumption, 631 inflow, 519 not determinable, 457 fee, 70 investment, 6 reversal, 1,386 unknown.

The 147 "other" lines from run 1 are now explained: one line on each of 147 pages, every one 18 points above the page's header row. They are a repeated page heading. From CP6, `compare.py` counts them as `page_heading`, so `other` should read 0 on a statement of this layout.

## Run 3: CP6, the same statement

All 19 gates passed: the 18 from run 2, and `report_paths_equal`.

| Measure | Count |
|---|---|
| Gates passed | 19 of 19 |
| Report paths equal | 3,977 |
| Report paths different | 0 |

## Balance identity, summary and chain diagnostics (CP7a-2, CP7a-3)

What the `compare.py --share` lines measure. All are informational, not gates; each prints yes or no, a bucket name or a count, never an amount.

- **`balances_identity_holds`** compares the closing balance with the opening balance plus total paid in minus total withdrawn (withdrawn as a size). Opening and closing come from `measure_balances`, in print order (D-06). It holds when the two differ by at most half a cent (0.005, `HALF_CENT`), the money tolerance of A-08: not float `==`, which it never used. `DataQuality.identity_holds` uses the same rule with `CHAIN_TOLERANCE` (also 0.005), and is None when a balance is unknown.
- **`identity_gap_zero_within_half_cent`** is the same question asked of the gap, closing minus (opening plus paid in minus withdrawn). **`identity_gap_bucket`** gives the gap's size without its sign: `lt_1`, `lt_100`, `lt_10000` or `gte_10000` (`not_found` without balances).
- **Summary block (CP7a-3).** Page 1's block runs from a line reading only `SUMMARY` up to one reading only `DETAILED STATEMENT`: seven type rows (SEND MONEY, RECEIVED MONEY, AGENT DEPOSIT, AGENT WITHDRAWAL, LIPA NA M-PESA (PAYBILL), LIPA NA M-PESA (BUY GOODS), OTHERS) and a TOTAL row, each `LABEL: paid_in paid_out` (`reconciliation/summary.py`). **`summary_total_paid_in_matches_old/new`** and **`summary_total_paid_out_matches_old/new`** say whether TOTAL equals that side's rows to half a cent: `yes`, `no`, or `not_found` when TOTAL is missing or unreadable. **`summary_type_rows_parsed`** counts the type rows read (of 7). The type rows are not used to check row types (v1.1). The invented labels (Transaction Count, Total Paid In, Total Withdrawn, Opening Balance, Closing Balance) and `summary_reconciliation` are gone.
- **Break residuals.** Each chain break's residual is its newer balance minus (older balance plus paid in minus withdrawn). With every amount readable, the residuals add up to the gap. **`break_residuals_total`** counts the breaks. **`break_residuals_paired_adjacent`** counts breaks in pairs: in print order, a break pairs with the next break when their residuals cancel to half a cent (+r then -r, as one misprinted balance or two swapped rows would leave); a paired break is not reused. **`break_residuals_unpaired`** counts the rest. (`break_residuals_unpaired_sum_equals_gap` was removed in CP7a-3.)
- **Reordering groups.** **`chain_breaks_raw`** and **`chain_breaks_after_reorder`** are the breaks before and after every group is put in its best order (also in `DataQuality`). **`chain_breaks_resolved_by_group_reorder`** is the difference; **`chain_breaks_resolved_by_receipt_groups`** and **`chain_breaks_resolved_by_time_groups`** are what each rule resolves on its own. **`reorder_group_size_<n>`** is a histogram of group sizes under the combined rule, and **`reorder_groups_too_large`** counts groups over 6 rows, left as printed. How groups are defined: `docs/DEBUGGING.md`.
- **Remaining breaks**, after reordering: **`remaining_breaks_after_<EVENT_TYPE>`** counts them by the event type of the newer row of the break (the one whose balance does not follow); **`remaining_breaks_on_page_boundary`** counts those whose two rows sit on different pages; **`remaining_break_residuals_matching_nearby_amount`** counts those whose residual, as a size, equals a paid in or withdrawn amount within 5 rows of the break's two rows, to half a cent. Yes-counts only: no amount is printed.
- **`--labels`** prints page 1's summary block, from the `SUMMARY` line up to (not including) the `DETAILED STATEMENT` line, every digit replaced by `#`, one per line, to stdout only. Nothing above the block is printed: that is where the name, number and email sit. If either marker is missing it prints nothing and exits 2. It refuses `--share`.

## Open questions

| ID | Question | Outcome on this statement |
|---|---|---|
| OQ-01 | Does the status column read the same as the old extractor? | **Closed for the compared statement:** 0 status mismatches, all 5,698 `Completed` on both sides |
| OQ-02 | Why does the balance chain break? | **Partly explained:** 268 breaks, identical in old and new, so the port did not cause them. By kind: 88 same receipt (parent and fee), 7 tied timestamp, 1 page boundary, 172 other. The 172 are not yet explained |
| OQ-03 | Can continuation lines sit above the anchor row? | **Answered: no.** All 6,407 continuation lines sit below their anchor; 0 above, 0 ambiguous |
| OQ-10 | Are receipt numbers always 10 characters? | **Answered: yes.** All 5,698 date lines have a 10-character receipt to their left |

## Decisions

| ID | Outcome |
|---|---|
| D-10 | Not triggered: the statement prints well over two values in every amount column. It stays Proposed; the question remains for short or one-sided statements |

## Follow-ups

1. **Statement summary labels:** all five read `not_found` on both sides, because the real wording differed from the generator's. CP7a-3 replaced them with the real block the owner described (seven type rows and TOTAL); the next run reports `summary_total_*` and `summary_type_rows_parsed`.
2. **Unclassified rows: 1,386 of 5,698 (24%)** match no classifier rule, old or new. This is the largest gap for analysis. Finding what they are needs counts by text pattern, never the text; adding rules is a separate, logged behaviour change.
3. **Chain breaks by the event type of the row after the break** (268 in all): 78 UNCLASSIFIED, 63 FEE, 57 BILL_PAYMENT, 19 MERCHANT_PAYMENT, 19 TRANSFER_IN, 17 TRANSFER_OUT, 13 BUNDLE_PURCHASE, 2 AIRTIME_PURCHASE. Fees and unclassified rows together are over half, which points at how they move the balance rather than at reading errors.
