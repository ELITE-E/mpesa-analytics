# Classification behaviour of mpesa-parser

What the old classifier (`engine.py`, `engine_types.py`, `event_types.py`) and entity step (`entity.py`) do, read from the porting source (CP5). This is the specification `src/mpesa_core/classification/` ports. It describes behaviour only; nothing is copied from the old docstrings or comments.

The old pipeline runs, in order: cleaning, then the classifier over all rows, then entity detection over all rows.

## Classifier, step by step

0. **Empty input** is returned as it is, with no new fields.
1. **Input check.** Every row must carry the receipt number, completion time, details, paid in, withdrawn and balance. If any is missing, the whole run stops with an error naming the missing fields. Status is not required.
2. **Withdrawn becomes a size.** The withdrawn amount loses its sign and is renamed `paid_out`. The old classifier keeps no signed withdrawn.
3. **Event type** comes from the details text alone (rules below).
4. **A diagnostic for every unclassified row**, recorded before anything below can stop the run.
5. **Cash flow direction** comes from the amounts alone (rules below). A row that breaks the rule stops the whole run with an error.
6. **Economic meaning** comes from the event type alone (table below).
7. **A diagnostic for every row whose meaning is unknown.**
8. **Base total cost** comes from the meaning (rules below).
9. **Fee attribution** moves each fee's cost onto its parent (rules below).

The input is never changed; the result is a new table in the same print order.

## Event type rules, in order

The details text is compared in capitals, so case never matters. The first rule that matches wins. **The order matters**, because the broad rules near the end would also match texts that earlier, more specific rules catch.

| # | The details text | Event type |
|---|---|---|
| 1 | starts with "funds received from" | `TRANSFER_IN` |
| 2 | starts with "deposit" | `DEPOSIT` |
| 3 | contains "unit trust invest" | `INVESTMENT` |
| 4 | contains "customer transfer of funds charge", "withdrawal charge" or "pay bill charge" | `FEE` |
| 5 | starts with "merchant payment" | `MERCHANT_PAYMENT` |
| 6 | starts with "pay bill" | `BILL_PAYMENT` |
| 7 | starts with "customer transfer to" | `TRANSFER_OUT` |
| 8 | starts with "withdrawal" | `WITHDRAWAL` |
| 9 | contains "reversal" | `REVERSAL` |
| 10 | contains "airtime purchase" | `AIRTIME_PURCHASE` |
| 11 | contains "customer bundle purchase", or contains both "recharge for customer" and "data bundles" | `BUNDLE_PURCHASE` |
| 12 | anything else | `UNCLASSIFIED` |

The full set of event types is the twelve above plus `LOAN_REPAYMENT`, which exists as a name but which no rule produces.

Consequences of the order:
- A fee text beginning "pay bill" is caught by rule 4 before rule 6.
- "Withdrawal charge" is caught by rule 4 before rule 8.
- A reversal text that starts with an earlier rule's words takes that earlier type.

## Cash flow direction

Paid in and paid out (withdrawn without its sign) decide it:
- **Paid in above zero:** `INFLOW`.
- **Otherwise, paid out above zero:** `OUTFLOW`.
- **Both above zero, or neither:** an error that stops the run. **This is D-05, kept on purpose.**

The two directions are `INFLOW` and `OUTFLOW`.

## Economic meaning

| Event type | Economic meaning |
|---|---|
| `MERCHANT_PAYMENT`, `BILL_PAYMENT`, `AIRTIME_PURCHASE`, `BUNDLE_PURCHASE` | `CONSUMPTION` |
| `DEPOSIT`, `TRANSFER_IN` | `INFLOW` |
| `WITHDRAWAL` | `ASSET_TRANSFER` |
| `INVESTMENT` | `INVESTMENT` |
| `FEE` | `FEE` |
| `REVERSAL` | `REVERSAL` |
| `TRANSFER_OUT` | `NOT_DETERMINABLE` |
| `UNCLASSIFIED`, and any type without a mapping | `UNKNOWN` |
| `LOAN_REPAYMENT` | refers to a meaning that does not exist, so it would fail. No rule produces this type, so the branch is unreachable. **D-02:** it now falls to `UNKNOWN`, which changes no classification |

The meanings are the eight values above. The old code also has a `LIABILITY_REPAYMENT` meaning, but it is switched off.

## Total cost

**Base cost:** a row whose meaning is `CONSUMPTION`, `UNKNOWN` or `NOT_DETERMINABLE` costs its paid out. Every other meaning costs 0.0, fees included; a fee reaches a cost only through attribution.

**Fee attribution**, for each fee row in print order:
- **Parent:** the parent is the nearest row, by print position, that has the same receipt number and is not a fee. On a tie, the earlier row wins.
- **Moving the cost:** the fee's paid out is added to the parent's total cost, and the fee's own total cost becomes 0.0. Several fees can add to one parent.
- **No parent:** the fee is left as it is, with total cost 0.0.

The old code finds each parent by scanning every row, once per fee. **D-07:** this repo indexes rows by receipt number instead, with the same nearest-row rule and the same tie rule.

## Diagnostics

The old code appends one record to a log file for each unclassified row, each row whose meaning is unknown, and each row with no entity, and each record holds the row's details text. **This repo returns them** in memory, with a code and the row's position (ADR 0004), and writes and logs nothing.

## Entity detection

Each grammar reads the normalized details. It matches from the start of the text, ignores case, and keeps the casing of what it captures. The captured text has surrounding whitespace removed. The grammars are tried in this order, and the first match wins:

| # | Grammar | The entity is |
|---|---|---|
| 1 | Pay bill, optionally "online", "to", a number | the text after the number, up to the account marker |
| 2 | Unit trust investment "to" a number | the text after the number, up to the platform's "by" marker |
| 3 | Merchant payment, optionally "online", "to", a number | everything after the number |
| 4 | Customer transfer "to" a masked phone number | everything after the masked number |
| 5 | Funds received "from" a masked phone number | everything after the masked number |
| 6 | Customer bundle purchase, or customer recharge, "to" a number | the text after the number, up to the "by" marker |
| 7 | Customer payment to small business "to" a masked phone number | everything after the masked number |

A masked phone number is three or four digits, more digits optionally, one or more asterisks, then digits.

Grammars are not tied to event types: every row is tried against all seven, whatever its type. When none matches, the old code returns a fixed marker string and records a diagnostic. **This repo returns no entity (None)** and a returned diagnostic. The difference is in representation only, logged in `behaviour-changes.md`.
