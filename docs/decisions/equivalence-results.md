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

1. **Statement summary labels:** all five read `not_found` on both sides, because the real wording differs from the generator's. The owner will supply the wording.
2. **Unclassified rows: 1,386 of 5,698 (24%)** match no classifier rule, old or new. This is the largest gap for analysis. Finding what they are needs counts by text pattern, never the text; adding rules is a separate, logged behaviour change.
3. **Chain breaks by the event type of the row after the break** (268 in all): 78 UNCLASSIFIED, 63 FEE, 57 BILL_PAYMENT, 19 MERCHANT_PAYMENT, 19 TRANSFER_IN, 17 TRANSFER_OUT, 13 BUNDLE_PURCHASE, 2 AIRTIME_PURCHASE. Fees and unclassified rows together are over half, which points at how they move the balance rather than at reading errors.
