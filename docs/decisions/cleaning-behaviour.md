# Cleaning behaviour of mpesa-parser

What the old cleaning step does, read from mpesa-parser's `clean.py`, `utils.py` and `normalize.py` (CP4). This is the specification `src/mpesa_core/cleaning/` ports. It describes behaviour only; nothing here is copied from the old docstrings or comments.

A scan of all 30 files in the porting source with this repo's pattern guard found no real-looking phone number or receipt number (0 files).

## The cleaning step, in order

The old step takes the extractor's table, one row per printed transaction, with the column titles as printed.

0. **Empty input** is returned as it is, without any of the steps below. Its columns are not renamed.
1. **Rows without a usable receipt number are dropped.** A row goes if its receipt cell is missing, if it is blank once surrounding whitespace is removed, or if it equals the header title for that column exactly. The header comparison does not strip whitespace and is case-sensitive. Rows that stay keep their receipt text unchanged; it is not stripped.
2. **Amounts become numbers.** Paid in, withdrawn and balance each go through the amount rule below. A result that is not a number is then replaced by 0.0. If a whole amount column is absent, it is created with 0.0 in every row.
3. **Details are normalized.** A missing details cell becomes the empty string, and every details value then goes through the normalization below. If the whole details column is absent, nothing is created.
4. **Columns are renamed** to the canonical names (table below). Columns with any other title pass through unchanged.
5. **Print order is kept.** The row positions are renumbered from zero, with no gaps.

Nothing else changes. The completion time stays the printed text and is not parsed. The status is not filled, trimmed or checked, so a missing status stays missing. Withdrawn keeps its printed sign.

## Canonical field names and types

| Printed column title | Canonical name | Type after cleaning |
|---|---|---|
| Receipt number column | `receipt_no` | text as printed |
| Completion time column | `completion_time` | text as printed |
| Details column | `details` | normalized text; empty string when missing |
| Transaction status column | `transaction_status` | text as printed, or missing |
| Paid in column | `paid_in` | float; 0.0 when blank, missing or unreadable |
| Withdrawn column | `withdrawn` | float; 0.0 when blank, missing or unreadable |
| Balance column | `balance` | float; 0.0 when blank, missing or unreadable |

There is no `paid_out` after cleaning. The old classifier renames `withdrawn` to `paid_out` as its first step, keeping the value.

**In this repo** the `CanonicalRow` contract (CP1) names the status `status`, and carries both `withdrawn` and `paid_out`. `paid_out` holds the same value as `withdrawn`, which is what the old classifier's rename produced, so no value changes. The classifier port must not rename again.

## The amount rule

1. A missing value, or exactly the empty string, is 0.0.
2. A number is returned as a float.
3. Text has the currency prefix `KSh` removed (case-sensitive), then every comma, then surrounding whitespace. What remains is read as a number by the language's own number reading. That reading accepts a leading minus or plus sign, decimals, exponents, digit-group underscores, and the words for not-a-number and infinity.
4. Text that cannot be read is 0.0. The old code also wrote the raw value to the log. **This repo does not (D-04)**; reconcile counts unreadable amounts instead.

Two consequences of the order of steps:
- Text reading as not-a-number becomes 0.0 only at cleaning step 2, not in the amount rule itself.
- Text that is only whitespace is not caught by rule 1. It reaches rule 4 and becomes 0.0 there.

## Details normalization

A missing or empty details value gives the empty string. Otherwise these steps run in this order, each on the result of the one before:

1. **References removed.** Every bracketed reference annotation is deleted, wherever it appears, keeping the text around it.
2. **Pay bill rewrite.** If the pay bill pattern (pay bill, a dash, digits, a dash, a name) appears anywhere, the whole text is replaced by the name followed by the digits. The match ignores case.
3. **Till rewrite.** The same for till and buy goods.
4. **Person-to-person rewrite.** If "sent to" or "received from" is followed by a phone number in national or international form, the whole text is replaced by the name after it.
5. **Tidying.** Newlines become spaces. Every vertical bar, backslash and hyphen becomes a space, including hyphens inside names. A run of five to seven digits followed directly by an uppercase letter gets a space between them. Any spelling of the M-PESA brand, ignoring case and spacing, is written as `M-PESA`. Runs of whitespace collapse to one space, and the ends are trimmed.

### Whole-string replacement by an unanchored search (D-08)

Three steps search anywhere in the text but replace all of it. Any text before the match is lost, and the name runs to the end of the text:

| Step | Pattern searched for |
|---|---|
| 2 | Pay bill, dash, digits, dash, name |
| 3 | Till or buy goods, dash, digits, dash, name |
| 4 | Sent to or received from, phone number, optional dash, name |

**Decision D-08: kept verbatim**, and `tests/core/test_normalize.py` pins it. Step 1 also searches anywhere, but it removes only what it matches, not the whole text.
