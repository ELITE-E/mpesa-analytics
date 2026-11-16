# Import plan behaviour

What `reconciliation/import_plan.py` decides when a statement is saved with "Remember on this device" (ADR 0012). **Python decides, JavaScript persists:** the core makes a plan, a pure description of the work, and the browser store (CP9) applies it in one IndexedDB transaction, so a failed save leaves no partial records. The identity rules the plan uses are in `docs/decisions/identity-behaviour.md`.

## Making a plan

`plan_statement_import(incoming_rows, existing_transactions)` takes the statement's transactions in print order and the transactions already stored, in the order they were stored. It changes neither.

Rows are resolved one by one, as the old atomic import did. Each row's candidates are the stored transactions and the rows this plan has already added, in that order. So a row inserted or preserved earlier in the same statement is a candidate for later rows.

Each row gets exactly one action:

| Identity outcome | Action | What the store does |
|---|---|---|
| NEW | `insert` | Stores the row as a new transaction and links the statement to it |
| MATCH | `link` | Stores nothing new; links the statement to `target`, the transaction the row is |
| COLLISION | `preserve` | Stores the row as a transaction of its own, leaving every other unchanged; records the domain observation in `observation`; links the statement to the new row |

- `target` and the entries of `collides_with` are references, not values: `{"source": "existing", "index": n}` is the n-th stored transaction, and `{"source": "incoming", "index": n}` is the row the same plan adds at row n.
- `collides_with` lists every transaction sharing the row's candidate key, stored ones first, in store order. The store records them, with the row's material fields, as the observation's evidence, as the old code did.
- When several candidates have the same fingerprint, the earliest wins, so a stored transaction wins over a row added earlier in the same plan.
- `counts` gives `new` (inserts), `matched` (links) and `collided` (preserves); they add up to the number of rows.
- The plan holds positions and fixed labels only, never a row value, so it can be logged or shown without showing statement text.

Consequences, each tested in `tests/core/test_import_plan.py`:

- Importing the same statement twice matches every row the second time.
- Overlapping statements insert only the rows not already stored.
- A row repeated within one statement links to its first copy; a row colliding with an earlier row of the same statement is preserved beside it.
- A collision preserves both rows and leaves the original unchanged, with a collision observation, and with several candidates every row is kept.

## Checking a plan

`validate_import_plan(plan, incoming_rows, existing_transactions)` refuses any plan other than the one `plan_statement_import` makes for the same rows. The store can call it before applying a plan. It reports, as an `ImportPlanError` with the first row involved:

- `ROW_ACTION_COUNT`: a row has no action or more than one;
- `PRESERVE_NOT_COLLISION`: a row that does not collide is preserved, which would store a second copy of a known transaction (the old code refused this too);
- `PLAN_MISMATCH`: any other difference, such as a link to the wrong transaction or wrong counts;
- `REQUEST_INVALID`: the plan is not shaped like a plan.

## Errors

Every failure is an `ImportPlanError` with a code and, at most, a row position (ADR 0004):

- `INCOMING_ROW_INVALID` or `EXISTING_ROW_INVALID`: a row is not a record holding every material field;
- `REQUEST_INVALID`: the bridge was given text that is not a request (below).

## The bridge

`bridge.py` exposes both, JSON text in and out:

- `plan_statement_import_json(request)`: the request is an object holding exactly `incoming_rows` and `existing_transactions`, each a list; the answer is the plan.
- `validate_import_plan_json(request)`: the same, plus `plan`; the answer is `{"valid": true}`, and an invalid plan raises.

Text that is not JSON, or not such an object, raises `REQUEST_INVALID`; the parse error, which may quote the text, is kept as the cause and never put in the message.

## What the plan does not cover

The store also records the statement itself (import time and period), the analytics snapshot and other domain observations, as the old import did. These need no decision from the core, so they are not in the plan; the store writes them in the same IndexedDB transaction (CP9).

## Equivalence

`tests/synth/test_import_plan_agreement.py` checks the plan against `tools/synth/import_ledger.py`, an independent planner that shares nothing with the core. Both see two overlapping statements built from the committed synthetic fixtures, with a collision and a repeated row, plus shuffled and altered statements.
