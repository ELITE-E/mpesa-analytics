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

1. **147 unattached "other" lines**, beside 148 header lines. `compare.py` now prints where they sit, as positions only: how many pages hold them, how many pages hold each number of them, and their offset from the page's header row in whole points. The next run will show whether they are one line per page at a fixed offset, such as a running title.
2. **Statement summary labels:** all five read `not_found` on both sides, because the real wording differs from the generator's. The owner will supply the wording.
