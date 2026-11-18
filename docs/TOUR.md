# A tour: one transaction from PDF to report

This follows one invented transaction through every stage. Every value here is made up.

The transaction: a payment to a shop called **Example Shop 3**, printed on page 1 of a statement as

| Receipt No | Completion Time | Details | Transaction Status | Paid In | Withdrawn | Balance |
|---|---|---|---|---|---|---|
| (ten characters) | 2026-01-05 10:00:00 | Merchant Payment Online to 555123 Example Shop 3 | Completed | | 450.00 | 1,550.00 |

The details are long, so they wrap onto a second printed line.

The whole run is `pipeline.run` in `src/mpesa_core/pipeline.py`. **To watch everything, put a breakpoint on its first line** and step into each call below.

## 0. In the browser: the statement engine

In the app, everything below runs inside one module worker, never on the page's thread and never on a server.

- **Files:** `pdf_reader/engine_client.js` (main thread), `pdf_reader/reader.worker.js` (the worker), `pdf_reader/runtime.js` (loads the runtime), `pdf_reader/bridge.js` (talks to Python).
- **Start:** the worker fetches `runtime/<version>/manifest.json`, checks its SHA-256 against the version in the URL, checks every file it is about to use against the manifest, then loads pdf.js, Pyodide and the `mpesa_core` wheel. pandas is not loaded yet.
- **A statement:** the page hands the worker the PDF's bytes (transferred, not copied) and, if needed, the password. Step 1 runs in the worker; the password is used there once and forgotten. The statement pages go to Python as one JSON string, `bridge.py` `run_json` runs steps 2 to 8, and the result comes back as one JSON string.
- **pandas:** the first time a run reaches step 6, `run_json` answers `ANALYSIS_RUNTIME_MISSING`; the worker loads pandas (timed apart as `pandas_load_ms`) and runs again. A statement that stops earlier never loads it.
- **Failures:** one code per failure (`NOT_A_PDF`, `PASSWORD_REQUIRED`, `PASSWORD_INCORRECT`, `CORRUPT_PDF`, `TOO_LARGE`, `TOO_MANY_PAGES`, `TIMEOUT`, `LAYOUT_UNRECOGNIZED`, or `ENGINE_FAILED`), a stage, and for core failures the core's code and row position. On `TIMEOUT` the page terminates the worker and starts a fresh one.
- **Cancel:** "Stop reading" ends the run at once, even while the runtime is still starting (the PDF is then never posted), and terminates a worker that is reading.
- **Try it:** `node web/harness/serve.js` and open the printed URL; it shows counts and codes only.
- **In the app:** build it (`npm run build` in `web/`, after the runtime), then `node web/scripts/serve_static.mjs` and open the printed URL. `/upload` hands the file and password to `web/src/data/repo.ts`, which runs the engine and keeps the result in memory for this session only; `/processing` shows each page read; every other screen reads from that session (ADR 0015).

## 1. PDF to statement pages: `extract_statement_pages`

- **File:** `pdf_reader/pdfjs/adapter.js` (JavaScript, in the browser; `tools/pdf_readers/extract_pages_cli.mjs` runs it from a terminal).
- **In:** the PDF's bytes and, if it has one, the password.
- **Out:** `StatementPages`: for each page, a list of text items, each with its text and position (`x0`, `x1`, `top`, `bottom`). Our transaction becomes about eight items: the receipt, the time, two pieces of details (one per printed line), the status, the withdrawn amount and the balance.
- The password is used here and goes no further. Nothing after this point sees bytes or a password.
- **Breakpoint:** not Python; read `tests/fixtures/synthetic/F-GOLDEN.items.json` to see what this produces.

## 2. Is this an M-PESA statement? `attest`

- **File:** `src/mpesa_core/reconciliation/attest.py`.
- **In:** the statement pages. Only page 1 is read, as lines of text top to bottom (`page_text`).
- **Out:** the verification token, an eight-character code from page 1's footer. If page 1 lacks the M-PESA brand, a verification instruction or a token, `AttestationError` with a code such as `BRAND_MISSING`.
- **Breakpoint:** `attest`, then look at `text`.

## 3. Items to rows: `build_rows`

- **File:** `src/mpesa_core/extraction/rows.py`, with column positions from `calibrate_columns` in `extraction/columns.py`.
- **In:** the statement pages.
- **What happens:** items at the same height become printed lines (`group_lines`). A line with a receipt and a time is an anchor row; it starts a row. Our second details line sits one wrap gap below, so it joins the row's details.
- **Out:** a `RawRow` per transaction, everything still text: `details` is `"Merchant Payment Online to 555123 Example Shop 3"`, `paid_in` is None, `withdrawn` is `"450.00"`, `balance` is `"1,550.00"`.
- **Breakpoint:** `_read_row`, conditional on the row's `line`.

## 4. Text to typed values: `canonicalize_rows`

- **File:** `src/mpesa_core/cleaning/canonicalize.py`, using `parse_currency` (`cleaning/amounts.py`) and `normalize_name` (`cleaning/normalize.py`).
- **Out:** a `CanonicalRow`: `withdrawn` 450.0, `paid_out` 450.0, `balance` 1550.0, `paid_in` 0.0, details tidied (unchanged here: no hyphens or separators to remove).
- **Breakpoint:** `_canonical_row`.

## 5. What kind of transaction? `classify_transactions`

- **File:** `src/mpesa_core/classification/classify.py`, with `extract_entity` in `classification/entity.py`.
- **What happens:** the details start with "MERCHANT PAYMENT", so `event_type` is `MERCHANT_PAYMENT`; money went out, so `cash_flow_direction` is `OUTFLOW`; `economic_meaning` is `CONSUMPTION`; `total_cost` is 450.0 plus any fee sharing its receipt. The merchant grammar reads the entity: `Example Shop 3`.
- **Out:** a `ClassifiedRow`, and a list of diagnostics for rows nothing could read (none for ours).
- **Breakpoint:** `event_type_of` or `extract_merchant_payment_entity`.

## 6. Transactions to the report: `analyze_transactions`

- **File:** `src/mpesa_core/analysis/__init__.py`, then `analysis/report.py` `build_report`. This is the first and only place pandas loads.
- **What happens:** `prepared_frame` (`analysis/frame.py`) puts the rows in one pandas frame. Our row is spending, so it counts in `spending.monthly_expenditure`, `spending.spending_by_entity` (under `Example Shop 3`), `spending.largest_purchases`, and `cash_flow.total_outflow`.
- **Out:** the report, a dict of plain JSON values with six sections. A completion time pandas cannot read stops a date-based analysis with `AnalysisError` code `DATE_UNREADABLE`.
- **Breakpoint:** `_spending_section`.

## 7. Checks: `reconcile`, `measure_unclassified`, `measure_balances`

- **File:** `src/mpesa_core/reconciliation/reconcile.py`.
- `reconcile` reads the raw rows and page 1's summary: row and status counts, the balance chain in both print orientations (it keeps the one with fewer breaks), unreadable amounts, and whether the printed totals agree.
- `measure_unclassified` counts rows no rule recognized; these go in `quality`, never the report.
- `measure_balances` gives the balance before the oldest row and after the newest, by print order in that orientation (D-06). If our row were the newest, the closing balance would be 1550.0.
- **Breakpoint:** `measure_balances`.

## 8. The result: `pipeline.run`

- **File:** `src/mpesa_core/pipeline.py`.
- **Out:** a `PipelineResult` (`contracts.py`): `verification_token`, `verification_instruction` (page 1's printed "dial" line, as printed, or None; the app shows it, or a fallback sentence, and never a code of its own), `account_digest` (the SHA-256 of page 1's mobile number in one canonical form, or None with `quality.account_number_unreadable`; in memory only, the store must never persist it), `processed_at` (only if the caller passed a time), `period` (from `measure_period`), `balances`, `transactions`, `report`, `quality`, `diagnostics`. Plain JSON values only, so it can be stored if the user opts in to "Remember on this device" (ADR 0012).

## 9. Remembering it: `plan_statement_import`

Only if the user opts in to "Remember on this device".

- **File:** `src/mpesa_core/reconciliation/import_plan.py`, with `resolve_identity` in `reconciliation/identity.py`; the browser calls it through `bridge.py` `plan_statement_import_json`.
- **In:** this statement's transactions, and the transactions already remembered.
- **What happens:** our transaction's candidate key is its receipt and `MERCHANT_PAYMENT`. The first time, nothing remembered shares it, so the outcome is NEW and the action `insert`. Importing the same statement again finds the remembered copy with the same material fingerprint: MATCH, action `link`. Had the balance printed as 1,549.00 the second time, the fingerprint would differ: COLLISION, action `preserve`, keeping both with an observation.
- **Out:** an `ImportPlan`: one action per row and the counts. Positions only, never a value. The browser store applies it in one IndexedDB transaction (CP9).
- **Breakpoint:** `_action_for`, conditional on `row_index`.

## 10. Keeping it locked: the vault

Only if the user opts in to "Remember on this device"; until then nothing is written (ADR 0016).

- **Files:** `web/src/persistence/vault.ts`, with `vault-crypto.ts`, `vault-database.ts`, `passphrase-policy.ts` and `forbidden-content.ts`.
- **In:** the passphrase (at opt-in and each unlock) and a whole ledger: our transaction among the others, as JSON.
- **What happens:** at opt-in, `create` checks the passphrase and hint, asks the browser to keep the storage, derives a non-extractable AES-GCM key with PBKDF2-SHA256 (600,000 iterations, random salt) and writes the `meta` record. `saveLedger` first refuses the ledger if it holds anything never stored (the verification token, the account digest, PDF bytes...), then encrypts the whole ledger with a fresh IV, bound to the slot `ledger:<id>`, the schema version and the next version counter, and writes it in one transaction only if the stored counter is still the one this tab read. Our transaction is now scrambled bytes in IndexedDB. `lock` (or ten idle minutes) drops the key and the ledger from memory; `unlock` derives the key again and checks it against the key check before reading anything.
- **Out:** `{ saved: true, version }`, or a `VaultError` with a code and a fixed message.
- **Breakpoint:** `Vault.saveLedger`, after `findForbiddenContent`.

## 11. Into its account's ledger: `LedgerStore.rememberStatement`

- **Files:** `web/src/persistence/store.ts`, `ledger.ts`, `store-core.ts`; the core side is `bridge.py` `call_json`, reached through the engine's `call_core` (ADR 0017).
- **In:** the pipeline result, the web layer's import time.
- **What happens:** the account digest becomes the ledger id (HMAC under the vault's ledger-id key) and is then forgotten. The store reads that ledger, sends our statement's rows and the ledger's transactions to the core for a plan, and asks the core to validate it. Our transaction is new the first time: `applyStatementImport` stores it unchanged with an id, links it to the statement, and keeps the report as a snapshot, all on a copy of the ledger. The copy is saved in one vault write. Reading the same statement again links our transaction instead of storing it twice.
- **Out:** `{ saved: true, ledgerId, statementId, counts }`; `mergedAnalytics()` then reports across the ledger's statements with the union period and the cross-statement closing balance.
- **Breakpoint:** `applyStatementImport`, on the action for our row.

## Where to look next

- `docs/DEBUGGING.md`: running one stage, and which test covers it.
- `docs/PORT_MAP.md`: where each old function went.
