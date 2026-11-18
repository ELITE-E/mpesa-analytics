# Debugging

How to reproduce an equivalence mismatch, run one stage on its own, and which tests cover each stage. Run commands from the repo root with the repo's `.venv`. Some tests need Node 24 on `PATH`.

## Reproduce an equivalence mismatch

The equivalence check compares the old mpesa-parser with this repo on a real statement. It runs on the owner's machine only, and prints counts, never statement values (standards 12.5).

1. Export the old code's results with the **old** repo's Python. It asks for the password with a hidden prompt:

   ```
   <old repo>/.venv/bin/python tools/equivalence/export_baseline.py --old-repo <old repo> --pdf <statement.pdf> --out <scratch folder>
   ```

2. Compare, from this repo:

   ```
   .venv/bin/python tools/equivalence/compare.py --pdf <statement.pdf> --baseline <scratch folder>/baseline.json --share
   ```

   `--share` output is safe to paste: labels, counts, yes or no, PASS or FAIL. Without `--share` it also lists each mismatch's page and line, so you can look at that row **on your own screen**.

3. Delete the scratch folder afterwards: it holds real data.

To find which stage a mismatch starts in, read the gates top to bottom: rows and the seven printed fields (row building), then `canonical_*` (cleaning), then the classification gates, then `report_paths_*` (analysis). `report_path_different:` lines name the report path, never its value. The informational lines `attestation`, `pipeline_run` and `balances_*` show whether the full pipeline runs on that statement and whether the D-06 balances look right.

The summary lines read page 1's summary block: from a line reading only `SUMMARY` up to one reading only `DETAILED STATEMENT`, seven type rows and a TOTAL row, each `LABEL: paid_in paid_out`. A row that is missing or unreadable is counted, never guessed. To see the block's wording on your own screen, digits masked: `compare.py --pdf <statement.pdf> --labels`. It prints nothing above the block, and nothing at all (exit 2) if a marker is missing.

### The same check through the browser engine

To check the browser engine on a real statement, run it in Chrome and compare what it wrote. The output folder must not exist yet and must be outside the repo; it is created readable by you only (700, files 600):

```
node tools/equivalence/browser_run.mjs --pdf <statement.pdf> --out <new scratch folder>
.venv/bin/python tools/equivalence/compare.py --browser-result <new scratch folder> --pdf <statement.pdf> --baseline <scratch folder>/baseline.json --share
```

`browser_run` prints counts only: pages, items, transactions, the byte size, whether the desktop limits would have accepted it, timings, and `other_requests` (must be 0). `compare.py --browser-result` prints the same lines and gates as `--pdf`, plus `browser_result_equals_cpython`: CPython's result on the browser's statement pages equals the browser's. The folder never holds the account digest, only whether one was read, so the digest is excluded from that gate by design. When the gate fails, the `browser_vs_cpython_*` lines count where: differing paths per top-level key of the result (and how many are numbers under half a cent apart), differing rows per field (and whether Unicode NFC plus whitespace normalisation clears them). With `--pdf`, the `browser_vs_node_*` lines compare the browser's statement pages with the Node reader's (asks for the password again). Delete the folder afterwards.

`--skip-baseline` runs only the browser-against-CPython part, without `baseline.json`. Its `browser_vs_cpython_report_path:` lines name each differing report path with keys from the data as `<key>`, the leaf's type, whether its list holds the same values in another order, and a size bucket for numbers. Against the old report, differences proven to be tie order only (`report_tie_order_only <class>`) do not fail `report_paths_equal` (behaviour-changes T-1 to T-3).

To check the real UI on a real statement, with nothing written: `node tools/equivalence/ui_run.mjs --pdf <statement.pdf>` (needs the runtime and the app built). It chooses the PDF on `/upload` as you would, asks for the password at a hidden prompt only if the PDF needs one, and prints counts only: `transactions_shown` (the Ledger's count), `compare_with_api` (pass when Overview withholds no breakdown, so the rows' inflow, outflow and charges equal the report's), `csp_violations`, `csp_console_reports`, `requests_other_origin` and `requests_breaking_rule` (requests other than GETs to the app, or prefetch HEADs to its pages; `tools/browser/request_rule.js`).

To see whether a PDF carries a digital signature: `node tools/probes/pdf_signature_probe.mjs <statement.pdf>` prints `signature_field: yes|no` and `byterange_token: yes|no`, nothing else.

### Why a row was inserted, linked or preserved

Run `plan_statement_import(incoming_rows, stored)` in a Python shell on F-RECORDS (`tests/core/synthetic_records.py`) or on a fixture's transactions, then `resolve_identity(row, stored)` for the row in question: `candidate_indices` lists every stored transaction sharing its candidate key, and comparing `fingerprint(row)` with each candidate's shows which material field differs. Rules: `docs/decisions/identity-behaviour.md` and `docs/decisions/import-plan-behaviour.md`.

### How reordering groups are defined

Some chain breaks only mean two rows printed in the other order. The reorder diagnostics test that:

- **A group** is a run of two or more neighbouring rows, in print order, where each row is *joined* to the next. Runs are maximal, and every row is in at most one group.
- **Joined** depends on the rule:
  - `same_receipt`: the two rows have the same receipt number (a payment and its fee);
  - `same_time`: the two rows have the same completion time, to the second;
  - `receipt_or_time` (the default): either. A run can mix both, so a fee pair next to a tied row forms one group of three.
- **Reordering:** groups are taken top to bottom. Every order of a group's rows is tried, and the order with the fewest breaks on the links the group touches is kept, including the links to the rows just above and below it. On a tie the printed order is kept, so reordering never adds a break.
- **Too large:** a group over 6 rows (`MAX_REORDER_GROUP`, 720 orders) is left as printed and counted in `reorder_groups_too_large`.
- **Residual:** a break's newer balance minus (older balance plus paid in minus withdrawn).
- **Remaining breaks** are those left after the default rule. The newer row of a break is the one whose balance does not follow: the upper row when the statement prints newest first. "Within 5 rows" means up to 5 rows above the break's upper row and 5 below its lower row, in the reordered order.

The code is `reorder_within_groups`, `reorder_group_sizes` and `count_residuals_matching_nearby_amounts` in `reconciliation/reconcile.py`; `docs/decisions/equivalence-results.md` lists every line `compare.py` prints from them.

To reproduce without real data, change a synthetic fixture: the tests in `tests/equivalence/test_compare.py` show how (`write_baseline` with a `report_change`, for example).

## Run one stage

Every stage is a pure function, so you can run it in a Python shell on a synthetic fixture:

```python
import json
from mpesa_core.extraction.rows import build_rows
from mpesa_core.cleaning.canonicalize import canonicalize_rows
from mpesa_core.classification.classify import classify_transactions
from mpesa_core.analysis import analyze_transactions
from mpesa_core.reconciliation.attest import attest
from mpesa_core.reconciliation.reconcile import reconcile, measure_balances
from mpesa_core import pipeline

pages = json.load(open("tests/fixtures/synthetic/F-GOLDEN.items.json"))
token = attest(pages)
rows = build_rows(pages)
canonical = canonicalize_rows(rows)
transactions, diagnostics = classify_transactions(canonical)
report = analyze_transactions(transactions)
quality = reconcile(pages, rows)
balances = measure_balances(rows, quality["chain_orientation"])
pipeline_result = pipeline.run(pages)
```

`tests/fixtures/synthetic/<name>.expected.json` holds the independent ledger's answer for each fixture: totals, balances, chain breaks, and in `built` the event type and entity the generator wrote into each row, for example `Example Shop 3`.

To make a statement of your own: `.venv/bin/python tools/synth/generate.py --name example --rows 40 --out-dir <scratch folder>`.

## Which test for which stage

| Stage | Code | Tests |
|---|---|---|
| PDF to statement pages | `pdf_reader/pdfjs/adapter.js` | `node --test tests/pdf_readers/*.test.js` |
| Attestation | `reconciliation/attest.py` | `pytest tests/core/test_attest.py` |
| Column calibration | `extraction/columns.py` | `pytest tests/core/test_columns.py tests/synth/test_calibration_fixtures.py` |
| Row building | `extraction/rows.py` | `pytest tests/core/test_rows.py` |
| Cleaning | `cleaning/` | `pytest tests/core/test_canonicalize.py tests/core/test_normalize.py tests/core/test_amounts.py` |
| Classification | `classification/` | `pytest tests/core/test_classify.py tests/core/test_entity.py tests/core/test_diagnostics.py tests/synth/test_event_fixtures.py` |
| Analysis | `analysis/` | `pytest tests/core/analysis/` |
| Reconciliation and balances | `reconciliation/reconcile.py` | `pytest tests/core/test_reconcile.py tests/core/test_balances.py tests/core/test_unclassified_quality.py tests/core/test_chain_diagnostics.py` |
| Summary block | `reconciliation/summary.py` | `pytest tests/core/test_summary.py` |
| Identity | `reconciliation/identity.py` | `pytest tests/core/test_identity.py` |
| Import plan and bridge | `reconciliation/import_plan.py`, `bridge.py` | `pytest tests/core/test_import_plan.py tests/core/test_bridge.py tests/synth/test_import_plan_agreement.py` |
| The whole run | `pipeline.py` | `pytest tests/core/test_pipeline.py tests/synth/test_pipeline_fixtures.py` |
| Core against the ledger | all | `pytest tests/synth/test_ledger_agreement.py` |
| Errors | `errors.py` | `pytest tests/core/test_errors.py` |
| Guards and docs | `tools/guards/` | `pytest tests/guards/` |
| Account digest | `reconciliation/account.py` | `pytest tests/core/test_account.py` |
| Browser bridge and engine client | `pdf_reader/bridge.js`, `pdf_reader/engine_client.js` | `node --test tests/pdf_readers/engine_bridge.test.js tests/pdf_readers/engine_client.test.js` |
| Runtime build | `tools/vendor.py runtime` | `pytest tests/guards/test_vendor_runtime.py` |
| Bundle budget | `tools/measure_bundle.py` | `pytest tests/guards/test_bundle_budget.py` |
| Contract scenarios (the frontend's fixtures) | `tools/synth/scenarios.py`, `scenario_ledger.py`, `tools/record_scenario_reports.py` | `pytest tests/synth/test_scenarios.py tests/synth/test_scenario_reports.py`; after changing a scenario: `python tools/synth/generate.py --write-fixtures tests/fixtures/synthetic`, then `python tools/record_scenario_reports.py`; the core against them: `python tools/equivalence/scenario_compare.py` (counts only) |
| What a first visit downloads | `tools/measure_app_download.mjs` | `node --test tests/browser/measure_app_download.test.js`; by hand: `node tools/measure_app_download.mjs > <scratch>/fetched.json`, then `uv run python tools/measure_bundle.py --app web/out --fetched <scratch>/fetched.json` |
| Request rule | `tools/browser/request_rule.js` | `node --test tests/browser/request_rule.test.js` |
| Per-stage timing | `tools/measure_stage_timing.mjs`, `web/harness/stage_timing.*` | `node --test tests/browser/stage_timing.test.js` |
| Statement engine in Chrome | `pdf_reader/`, `web/harness/` | `node --test --test-concurrency=1 tests/browser/*.test.js` (needs the runtime and the app built, and Chrome; about 12 minutes) |
| Verification instruction | `reconciliation/attest.py` `verification_instruction` | `pytest tests/core/test_verification_instruction.py` |
| Web app, unit | `web/src/` | from `web/`: `node --import ./tests/support/register.mjs --test tests/<name>.test.mjs` |
| Web app in Chrome: static export, CSP, real UI | `web/out`, `web/scripts/` | from `web/`, after `npm run build`: `node --import ./tests/support/register.mjs --test --test-concurrency=1 tests/static-export-csp.test.mjs tests/e2e-local.test.mjs` (about 7 minutes) |
| Vault, unit (fake IndexedDB, Node's WebCrypto, a low iteration count) | `web/src/persistence/` | from `web/`: `node --import ./tests/support/register.mjs --test tests/vault-policy.test.mjs tests/vault-lock.test.mjs tests/vault-tamper.test.mjs tests/vault-never-stored.test.mjs tests/vault-failures.test.mjs tests/vault-iterations.test.mjs` (about 10 seconds) |
| Vault in Chrome: quota, blocked storage, two tabs, zero network | `web/src/persistence/`, `web/tests/support/vault-page-server.mjs` | from `web/`: `node --import ./tests/support/register.mjs --test --test-concurrency=1 tests/vault-chrome.test.mjs` (needs Chrome only, not the build; under a minute) |
| Store: ledgers, merging, the old S-01 to S-54 (real core under CPython) | `web/src/persistence/ledger.ts`, `store.ts`, `store-core.ts`, `web/src/data/repo.ts` | from `web/`: `node --import ./tests/support/register.mjs --test tests/store.test.ts tests/store-ledgers.test.ts tests/vault-ledger-id.test.mjs` (needs the repo's `.venv`; under a minute) |
| Remember screens: card, unlock, lock, merge, ledger switcher, statement list, delete-all, and the claims behind the copy | `web/src/lib/remember.ts`, `web/src/components/remember/`, `web/src/content/remember.ts`, `repo.readStatement` | from `web/`: `node --import ./tests/support/register.mjs --test tests/remember-*.test.mjs` without `remember-e2e` (needs the repo's `.venv` for the core; under a minute) |
| Remember through the real UI in Chrome | the built app (`web/out`), the engine, the vault | from `web/`, after building the runtime and the app: `node --import ./tests/support/register.mjs --test --test-concurrency=1 tests/remember-e2e.test.mjs` (about two minutes; it generates the other-account statement, `F-OTHER-ACCOUNT`, into a temp folder) |
| Merged analytics (core) | `reconciliation/merge.py`, `pipeline.py` `analyze_merged`, `bridge.py` `call_json` | `pytest tests/core/test_merge.py` |
| Store in Chrome with the real engine | `web/src/persistence/`, `pdf_reader/` | from `web/`, after building the runtime: `node --import ./tests/support/register.mjs --test --test-concurrency=1 tests/store-chrome.test.mjs` (about a minute; rebuild the wheel and runtime after any core change, or Chrome runs the old core and the merge fails with `PLAN_FAILED`) |
| The prototype's browser tests | `web/tests/*-browser.test.mjs`, `web/tests/support/frontend-server.mjs` | from `web/`, after `npm run build`: `node --import ./tests/support/register.mjs --test --test-concurrency=1 tests/<name>-browser.test.mjs` (a few minutes each). Tests expecting links to carry the fake API's import id fail until ledger switching (CP9) |

The core tests also run under Pyodide: build the wheel (`uv build --wheel`), then `node tools/run_pyodide_tests.mjs`.

The browser tests need the runtime: `uv build --wheel --out-dir dist`, then `uv run python tools/vendor.py runtime --wheel dist/mpesa_core-0.0.0-py3-none-any.whl`. Rebuild it after any core change, or Chrome runs the old wheel; then rebuild the app (`npm run build` in `web/`), which copies the runtime and `pdf_reader/` into `web/out`. To look at the engine by hand, `node web/harness/serve.js` serves the harness with the architecture CSP; open DevTools on the worker for its requests.

## Errors you may see

Every core error carries a code and, at most, a position; never a statement value (ADR 0004). The cause, which may quote a value, is kept in `__cause__` for your own debugger and never crosses the bridge.

| Error | Codes | Raised by |
|---|---|---|
| `ExtractionError` | `LAYOUT_UNRECOGNIZED`, `NOT_A_PDF`, `PASSWORD_*`, `CORRUPT_PDF`, `TOO_*` (`TOO_FEW_AMOUNTS`: an amount column printed fewer than twice, its own user message; CP10 relaxes it), `TIMEOUT` | the PDF reader, `calibrate_columns` |
| `AttestationError` | `NO_PAGES`, `BRAND_MISSING`, `ANCHOR_MISSING`, `TOKEN_MISSING` | `attest` |
| `DomainRowError` | row index only | `classify_transactions` (a row with both or neither amount) |
| `AnalysisError` | `DATE_UNREADABLE` (with the row), `ANALYSIS_FAILED` | `analyze_transactions` |
| Engine failure (JavaScript) | `NOT_A_PDF`, `PASSWORD_*`, `CORRUPT_PDF`, `TOO_*`, `TIMEOUT`, `LAYOUT_UNRECOGNIZED` (core codes kept in `core_code`), `ENGINE_FAILED`, each with a `stage` (`reader`, `core`, `runtime`, `engine`) | `pdf_reader/bridge.js`, `engine_client.js` |
| `VaultError` (JavaScript) | `WRONG_PASSPHRASE`, `LOCKED`, `NO_VAULT`, `VAULT_EXISTS`, `LEDGER_DAMAGED`, `SCHEMA_TOO_NEW`, `KDF_PARAMETERS_REFUSED`, `FORBIDDEN_CONTENT` (with `detail`: which kind, from a fixed list), `STALE_LEDGER`, `STORAGE_UNAVAILABLE`, `STORAGE_QUOTA_EXCEEDED`, `STORAGE_WRITE_FAILED`, and the policy codes `PASSPHRASE_*`, `HINT_*`. A fixed message each; the browser's own error, if any, is in `cause` | `web/src/persistence/vault.ts` |
| `StoreError` (JavaScript) | `PLAN_REFUSED` and `PLAN_FAILED` (the core's code in `detail`, e.g. `PRESERVE_NOT_COLLISION`), `ANALYSIS_FAILED`, `TRANSACTION_INCOMPLETE` (with `rowIndex`), `STATEMENT_INCOMPLETE`, `STATEMENT_NOT_FOUND`, `TRANSACTION_NOT_FOUND`, `UNKNOWN_OBSERVATION_CATEGORY`, `LEDGER_NOT_FOUND`, `IMPORT_ALREADY_SETTLED` | `web/src/persistence/ledger.ts`, `store.ts`, `store-core.ts` |
| `ImportPlanError` | `INCOMING_ROW_INVALID`, `EXISTING_ROW_INVALID` (with the row), `REQUEST_INVALID`, `ROW_ACTION_COUNT`, `PRESERVE_NOT_COLLISION`, `PLAN_MISMATCH` | `plan_statement_import`, `validate_import_plan`, the bridge |

### Looking inside the vault

The vault is the IndexedDB database `mpesa-analytics-vault` (ADR 0016). In Chrome DevTools, Application, IndexedDB shows its two stores: `meta` (plaintext: schema version, KDF parameters, salt, key check, hint) and `ledgers` (per ledger id: `iv`, `ciphertext`, `version`, `schema_version`). Ledgers are unreadable there by design; to see one, unlock in the page and call `readLedger`. Use invented data only: a real statement's ledger must never be copied out of the browser.

- `LEDGER_DAMAGED` for one ledger while others read fine: that record was changed, truncated, or moved from another slot (the associated data binds slot, version counter and schema version). Delete-all is the only repair.
- `KDF_PARAMETERS_REFUSED` in development: a vault created by a unit test's `openVaultWithIterations` (low count) opened by the app's `openVault`. Delete it.
- `STALE_LEDGER`: another tab saved first. Read the ledger again (or reload), then save.
- The unit tests' raw scan is `dumpDatabases` in `web/tests/support/vault-environment.mjs`.

### Why a statement was not remembered, or merged oddly

- `{saved: false, reason: "ACCOUNT_UNREADABLE"}`: the pipeline result's `account_digest` is null (`quality.account_number_unreadable`); pass `ledgerChoice` with a saved ledger id.
- Counts surprise you: print `prepared.plan` from `prepareStatementImport` (positions and labels only) and compare with `docs/decisions/import-plan-behaviour.md`.
- `PLAN_REFUSED`: the plan was made against another version of the ledger, or changed; `detail` is the core's `validate_import_plan` code.
- `STALE_LEDGER` on confirm: another tab saved the ledger after this one prepared; prepare again.

### Remember screens

- A screen with saved data shows nothing after a page load: correct. A full page load locks the saved data; the layout's `RememberSession` sends data screens to `/unlock`. Tests and tools must move with the app's own links after turning remembering on (`tools/browser/ui_journey.js` `follow`).
- The merge screen says "There is no statement waiting": the proposal lives in module memory (`upload-flow.ts` `pendingMerge`); a reload forgets it, and nothing was written.
- `F-OTHER-ACCOUNT` (a second invented account holder, `Example Person 01`) is generated on demand: `.venv/bin/python tools/synth/generate.py --name F-OTHER-ACCOUNT --out-dir <scratch>`. Committed fixtures keep identity 0, so their bytes are unchanged.
