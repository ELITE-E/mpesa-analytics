# 0017. One encrypted ledger per account, merged by the core's plan, saved in one write; merged analytics rules

Status: Accepted (owner instruction, CP9b)
Date: 2026-11-18

## Context

ADR 0016 gives an encrypted vault that saves whole-ledger blobs. CP9b fills it: the old server's import (`persist_completed_import`) stored a statement, its transactions resolved by identity, provenance links, an analytics snapshot and domain observations in one database transaction. The core already plans an import (`plan_statement_import`) and checks a plan (`validate_import_plan`); the browser must apply the plan with the same all-or-nothing rule. Statements from different accounts must never be compared. A ledger also needs one report across all its statements, which needs two rules the old system never had: the merged period and the closing balance across statements.

## Decision

### Ledgers per account

- The ledger id is HMAC-SHA256(ledger-id key, account digest), as 64 hex characters, computed while unlocked (`Vault.ledgerIdFor`). The digest is used for that and never kept or stored; the id, as the record's key, is the only account marker.
- The vault stretches the passphrase once (PBKDF2-SHA256, at least 600,000 iterations) and HKDF-SHA256 splits the 256 stretched bits into two non-extractable keys: the AES-GCM encryption key and the HMAC ledger-id key. WebCrypto cannot compute an HMAC with an AES key, and a second PBKDF2 run would double unlock time. The stretched bits exist only between derivation and import and are wiped. This changes the key the CP9a vault derived; no vault was ever written outside tests, so the schema version stays 1.
- A statement from another account opens its own ledger and is never compared with this one.
- A statement whose digest is null (`account_number_unreadable`) is remembered only into a ledger the person picks (`ledgerChoice`, which must be a saved ledger: else `LEDGER_NOT_FOUND`); with no pick it stays in memory (`{saved: false, reason: "ACCOUNT_UNREADABLE"}`) and nothing is written.
- Switching ledgers (`switchLedger`) needs the vault unlocked; a lock clears the ledger on screen and tells listeners.

### Merging: Python decides, JavaScript persists

1. Read the ledger (or start an empty one); its transactions, in store order and without ids, are the plan's existing transactions.
2. The core plans the import, unless the caller passes a plan (such as the engine's run); either way the core validates it through the bridge. A changed, foreign or malformed plan is refused (`PLAN_REFUSED`, with the core's code in `detail`) and nothing is written.
3. `applyStatementImport` applies the plan in JavaScript on a copy of the ledger, as the old import did: the statement; each row inserted, linked to its target, or preserved beside its candidates with an `unexpected_receipt_event_type_collision` observation holding the row's material fields and the candidates' ids; each row linked to the statement (each pair once); the snapshot (the report's JSON text, `contract_version` `local-1`, `computed_at` the web layer's time, never the core's); one `unrecognized_event_type` observation per unclassified row; the caller's observations. Unknown categories are refused. Any failure leaves the given ledger untouched.
4. The whole new ledger is saved in one vault write (compare-and-set on the version counter, ADR 0016). A stale tab's merge is refused (`STALE_LEDGER`).
5. `prepareStatementImport` stops before the write and returns the plan's counts (new, matched, collided) with `confirm` (the one write) and `cancel` (nothing written), for the merge screen (N-26). `rememberStatement` confirms at once.

The ledger holds `statements` (import time, period as printed, row count, the transaction of each printed row in print order, the plan's counts, per-statement quality: rows, chain breaks, orientation, whether the totals match, unclassified rows and share; and the printed verification instruction), `transactions` (the core's 13 fields unchanged, plus an id), `links`, `snapshots` and `observations` (status `new`). Never the verification token, the account digest, PDF bytes or a password (ADR 0016's content check still runs on every save).

Deleting a statement removes its links, observations and snapshots, and the transactions no remaining statement observed (behaviour change P-1), in one write.

### Merged analytics (`analyze_merged`, bridge `analyze_merged_json`)

The core reports once over the ledger's transactions (each stored once, so overlapping statements are not counted twice), given each statement's period, orientation and rows by position, in import order:

- **Merged period:** the union of the statements' periods: the earliest start to the latest end. A statement without a readable period adds nothing; with none, both are null and the report falls back to the span of the rows.
- **Closing balance:** the balance of the transaction with the latest readable completion time. Ties go to the statement imported later; within one statement, to the row its print order makes newest: the first printed when it prints newest first, the last printed otherwise (D-06's rule for one statement). A row both statements observed counts for each. Rows with unreadable times never decide it; with none, it is null.

The browser reaches the core through one bridge function, `call_json(function_name, request_text)`, which answers `{ok, answer}` or `{ok: false, error: {code, row_index}}` and asks for pandas (`ANALYSIS_RUNTIME_MISSING`) when the merged analysis needs it; the worker loads it and calls again. The statement engine exposes it as `call_core`.

### The data layer

With remember on (a store set by `rememberOnThisDevice` and active: vault unlocked, storage usable), `uploadStatement` merges into the account's ledger and `listImports`, `getImport`, `getAnalytics`, `getAllTransactions`, `getTransactions` (paging) and `getStatementChecks` answer from the ledger on screen. Import ids are the ledger's statement ids. A merge or write failure is `ApiError` 503 `save_failed` with the vault's or store's own message, and nothing is saved. With remember off they use the in-memory session, as in CP8b. The remembered checks card has no verification code (it is never stored).

## Alternatives considered

| Option | Tradeoff |
|---|---|
| Ledger id = the digest, or its plain hash | The digest is nine digits behind a hash: anyone could try them all. HMAC under a passphrase-derived key cannot be tried without the passphrase |
| A second PBKDF2 run for the HMAC key | No HKDF step, but every unlock pays the stretch twice |
| Apply the plan in Python | One language for the rules, but then the core would build store records; the import plan doc already settled "Python decides, JavaScript persists" |
| Trust the engine's plan without validating | One core call fewer, but a plan made against an older ledger, or changed on the way, could be applied |
| Merged report = sum of the statement snapshots | Overlaps counted twice; recurring and monthly figures wrong across statement boundaries |
| Closing balance by latest import, ignoring time | An older statement imported last would set the balance |

## Consequences

- Every remembered statement costs two core calls (plan, validate), and the merged report one more; each runs in the engine's worker.
- Unlock time is unchanged (one stretch); the ledger id costs one HMAC.
- A statement with an unreadable account needs the person's choice (CP9c's screen) before it can be remembered.
- The prototype's merge screen, ledger picker and delete confirmation are CP9c.

## Enforcement

- `tests/core/test_merge.py`: merged period, closing rule and ties, `analyze_merged`, `analyze_merged_json`, `call_json`.
- `web/tests/vault-ledger-id.test.mjs`: the ledger id (N-18), one stretch per unlock.
- `web/tests/store.test.ts`: the old S-01 to S-54, under their old names.
- `web/tests/store-ledgers.test.ts`: N-18 to N-27, N-29, N-31, deletion, merged analytics, no plaintext.
- `tests/pdf_readers/engine_bridge.test.js`, `engine_client.test.js`: `call_store_core`, `call_core`.
- `web/tests/store-chrome.test.mjs`: real engine and vault in Chrome: zero requests and CSP violations while merging, saving, analysing and deleting; no plaintext in the raw database; an unreadable account writes nothing.
