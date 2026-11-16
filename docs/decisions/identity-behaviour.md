# Identity behaviour

How the old mpesa-parser decided whether a transaction in a newly imported statement was one it already held, and what its import stored. This is the behaviour CP7b ports into `reconciliation/identity.py` (identity) and describes for the browser store (CP9). Words only: the code is the port, and the tests are `tests/core/test_identity.py` and `tests/core/test_import_plan.py`.

## The candidate key

Two transactions can only be the same transaction if they share a receipt number and an event type. That pair is the **candidate key**. A transaction already held is a candidate for an incoming one only when both values are equal.

The event type is part of the key because one receipt number is printed on more than one row: a payment and its fee share a receipt but differ in event type, so they never compete for the same identity.

The old code also limited candidates to transactions of the same owner, so identity never crossed users. The browser keeps one person's statements on one device, so there are no owners and this rule is dropped.

## The material fields

The **material fields** are what must be equal for a candidate to be the same transaction:

- receipt number;
- event type;
- completion time;
- details;
- `transaction_status` (named `status` in this repo's rows; the canonical names are an open owner decision since CP4);
- paid in;
- paid out;
- balance.

`total_cost` is not a material field. It is derived when a fee is attributed to its payment, not printed on the statement, so a change to fee attribution must not turn a known transaction into a different one. The other derived values (cash flow direction, economic meaning, entity, and this repo's `withdrawn`, the printed amount from which paid out is read) are not material either.

## The fingerprint

A transaction's **fingerprint** is the values of its material fields, in the order listed above. Two fingerprints are the same only if every value is exactly equal: there is no tolerance and no normalization beyond what cleaning already did, so an amount that differs by a cent is a different fingerprint.

## NEW, MATCH and COLLISION

Each incoming transaction is resolved against the transactions already held:

- **NEW**: no transaction held shares its candidate key.
- **MATCH**: a candidate's fingerprint equals the incoming fingerprint. The incoming transaction is that candidate, seen again.
- **COLLISION**: candidates exist but none has the same fingerprint. The same receipt and event type arrived with different printed facts. Nothing is chosen, and the collision is reported with the observation category `unexpected_receipt_event_type_collision`.

Resolution only decides. It never stores the incoming transaction and never changes a candidate.

## Several candidates

When several candidates share the key, every one is compared, so the outcome does not depend on the order they were found in:

- If one or more have the same fingerprint, the outcome is MATCH with the earliest of them: the one stored first.
- If none has the same fingerprint, the outcome is COLLISION against all of them.

## The old atomic import

The old import of one statement wrote everything in one database transaction: it committed only if every step succeeded, and on any failure it rolled back every record of that import and reported the error. In order, it wrote:

1. **The statement**, with its import time and its period (the earliest and latest completion dates of its transactions). A statement without transactions, or with a transaction lacking a completion time, was refused before anything was written.
2. **Each transaction, in print order.** Each was resolved against the transactions already held, including those written earlier in the same import:
   - NEW: the transaction was stored as a new row, with its values copied unchanged.
   - MATCH: nothing was stored; the existing row was reused.
   - COLLISION: the incoming transaction was stored as a separate row, so both versions are kept and the existing one is left unchanged. A domain observation was recorded for it, holding the incoming material fields and the existing rows it collided with. This path refused any transaction whose outcome was not COLLISION, writing nothing, because preserving a MATCH would make a second copy of a known transaction.
   - In every case the statement was then linked to the resulting row. These links are the **provenance**: which statements observed which transaction. A link was made once only: linking the same statement and transaction again changed nothing.
3. **The analytics snapshot**, if one was given: the report as JSON text, tagged with its contract version and the import time.
4. **The domain observations**, such as unrecognised event types, each scoped to the statement and, when it described one transaction, to that transaction's stored row. Observation categories came from a fixed list; an unknown category was refused.

Because transactions were resolved one by one inside the same transaction, a row repeated within one statement matched its own first copy, and a row colliding with an earlier row of the same statement was preserved beside it.

## What changes in the rewrite

- Identity is pure (`resolve_identity`): the caller passes the transactions already held, and nothing is stored.
- The import is planned in Python (`plan_statement_import`) and applied by the browser store in one IndexedDB transaction, which keeps the all-or-nothing rule: `docs/decisions/import-plan-behaviour.md`.
- Owners are dropped (see the candidate key).
- Statement records, provenance links, observations and snapshots are stored by the browser store (CP9), only if the user opts in to "Remember on this device" (ADR 0012).
