# Glossary

One word per concept. Code, tests, fixtures and docs use the term in the first column. The "Avoid" column is checked in CI through the banned-names list in `tools/guards/guards.toml`.

Field names that form the frontend contract (`receipt_no`, `completion_time`, `paid_out`, `entity`, and the keys of the report) keep their existing names even where prose prefers another word. Renaming them is a behaviour change (see `docs/decisions/behaviour-changes.md`).

## Statement and extraction

| Term | Meaning | Code name | Avoid |
|---|---|---|---|
| statement | The M-PESA personal statement the user provides, as a whole | `statement` | document, file, record |
| statement pages | Positioned text items per page, as returned by the PDF reader, before any row exists. Replaces the contract name `PagesDocument` (decided at CP1, before any code uses it) | `StatementPages` | PagesDocument, doc, raw pdf |
| page | One printed page of the statement | `Page` | sheet |
| text item | One piece of text with its position, from the PDF reader | `TextItem` | token, word, chunk |
| pdf reader | The PDF text extractor: pdf.js in the app; pdfplumber in dev and CI only. "Engine" alone is avoided: in the old repo it meant the classifier | `pdf_reader/`, `tools/pdf_readers/` | engine, parser |
| anchor row | A printed line holding both a receipt number and a completion timestamp. Row boundaries and column positions are calibrated from these lines | `anchor_row` | first line, data line |
| header row | The printed column titles. Used only to confirm column order, never position | `header_row` | title row |
| column calibration | Deriving column x positions from anchor rows | `columns.py` | column detection |
| layout | The printed arrangement of a statement. "Format" is reserved for file formats | `layout` | format, template |
| printed line | Text items sharing a vertical position on a page. Not a row: a row can span several printed lines | `PrintedLine`, `group_lines` | row, record |
| column layout | The calibrated column positions: left edges for text, right edges for amounts | `ColumnLayout`, `calibrate_columns` | column map |
| page heading | A line repeated above the header row on every page after the first. Outside every row; counted, never read | `unattached_page_heading_lines` | page title, running header |
| continuation line | A printed line with no anchor that adds to its row's details, above or below the anchor | `continuation_lines_above`, `continuation_lines_below` | wrap row, extra line |
| layout counts | Counts of what row building met on the page instead of guessing | `LayoutCounts`, `assemble_rows` | warnings, errors |

## Rows and transactions

| Term | Meaning | Code name | Avoid |
|---|---|---|---|
| row | One transaction as printed, possibly over several text lines, before cleaning | `RawRow`, `build_rows` | line, record, entry |
| canonical row | A row after cleaning: typed amounts, normalized details | `CanonicalRow`, `canonicalize_rows` | clean row, normalized row |
| normalized details | Details text after `normalize_name`: what classification and entity detection read | `normalize_name` | cleaned details |
| printed amount | An amount as the statement prints it, before `parse_currency` reads it as a float | `parse_currency` | raw amount |
| transaction | A canonical row plus its classification | `ClassifiedRow` | txn, tx, entry, record |
| receipt number | The code printed for each transaction | `receipt_no` | ref, reference, transaction_id |
| completion time | When the transaction completed | `completion_time` | date, timestamp |
| details | The printed free-text description | `details` | description, narration, memo |
| status | The printed status of the transaction | `status` | state |
| paid in | The printed inflow amount | `paid_in` | credit |
| withdrawn | The printed outflow amount | `withdrawn` | debit |
| paid out | The derived outflow amount used by analytics | `paid_out` | outflow (in code names) |
| balance | The printed running balance after the transaction | `balance` | amount_left |
| closing balance | The balance after the newest row in print order (D-06) | `closing_balance` | final balance |
| opening balance | The balance before the oldest row in print order: its balance minus paid in plus withdrawn | `opening_balance` | starting balance |
| balances | The opening and closing balance of a statement, in the result, not the report | `Balances`, `measure_balances` | totals |
| balance chain | The sequence in which each balance equals the previous balance plus paid in minus paid out | `balance_chain` | running total |
| chain break | A place where a balance does not follow from the previous row | `chain_break` | mismatch, gap |
| print orientation | Whether a statement prints newest or oldest first. Never assumed; the chain is read both ways | `chain_orientation`, `NEWEST_FIRST`, `OLDEST_FIRST` | sort order, direction |

## Classification

| Term | Meaning | Code name | Avoid |
|---|---|---|---|
| event type | The classified kind of transaction, one of the `FinancialEvent` values | `event_type`, `FinancialEvent`, `classify_transactions` | type, category, kind |
| cash flow direction | Whether money came in, went out, or neither | `cash_flow_direction` | direction on its own |
| economic meaning | The economic purpose of a transaction, one of the `EconomicMeaning` values | `economic_meaning` | purpose, category |
| entity | The counterparty identified from the details (a person, merchant, till or paybill); None when no grammar reads it | `entity`, `extract_entity` | counterparty (in code), party |
| fee | A charge row attached to a parent transaction | `fee` | charge (except the analytic named transfer charges) |
| parent transaction | The transaction a fee belongs to; they share a receipt number | `parent` | main transaction |
| total cost | A transaction's amount plus the fees attributed to it | `total_cost` | full cost |

## Results and checks

| Term | Meaning | Code name | Avoid |
|---|---|---|---|
| period | The date range being analysed; in the result, the earliest and latest readable completion times | `period`, `Period`, `measure_period` | range, window |
| report | The analysis result, with the old `AnalyticsResult.to_json_safe()` keys exactly | `report`, `analyze_transactions` | analytics (as a noun), summary |
| prepared frame | The one pandas frame the analyses read, built from classified rows with every class as plain text (D-01) | `prepared_frame` | dataframe, df (in prose) |
| statement summary | The summary block on page 1, from the `SUMMARY` line up to the `DETAILED STATEMENT` line: seven transaction type rows and a TOTAL row, each paid in then paid out | `summary_block_lines`, `read_summary_block` | header totals |
| reorder group | A run of neighbouring rows, each sharing a receipt number or a completion time with the next, whose order the chain diagnostics may change | `reorder_within_groups`, `GROUP_RULES` | cluster, block |
| candidate key | The receipt number and event type: only transactions sharing both can be the same transaction | `CANDIDATE_KEY` | duplicate key, id |
| material fingerprint | The values of the material fields (receipt, event type, completion time, details, status, paid in, paid out, balance), compared exactly; `total_cost` is not one | `fingerprint`, `MATERIAL_FIELDS` | hash, checksum |
| identity | Whether an incoming transaction is new, one already stored (match) or a collision | `resolve_identity`, `IdentityResolution`, `NEW`, `MATCH`, `COLLISION` | dedup, duplicate check |
| collision | A transaction sharing a stored one's candidate key but not its fingerprint; both are kept, with a domain observation | `COLLISION`, `COLLISION_CATEGORY`, `preserve` | conflict, duplicate |
| import plan | A pure description of what the browser store must do with one statement's rows: insert, link or preserve each, with counts | `plan_statement_import`, `ImportPlan`, `validate_import_plan` | merge script, sync |
| reconciliation | Comparing parsed rows with the statement summary and the balance chain | `reconcile` | validation, verification |
| data quality | Counts of problems found while processing (row counts, status counts, chain breaks, unparsed amounts, unclassified rows) | `DataQuality`, `quality`, `measure_unclassified` | warnings, errors |
| diagnostic | An item describing one row that could not be resolved. Held in memory only. Codes: `EVENT_CLASSIFICATION_UNRESOLVED`, `ECONOMIC_MEANING_UNRESOLVED`, `ENTITY_EXTRACTION_UNRESOLVED` | `Diagnostic` | issue, problem |
| baseline | The old extractor's rows for one statement, kept outside both repos for the equivalence check | `export_baseline.py`, `compare.py` | snapshot, golden |
| account digest | The SHA-256 digest of page 1's mobile number in one canonical form (`254` and nine digits). In memory only: nine digits are few enough to try them all, so the store must never persist it | `account_digest`, `account_number_unreadable` | account id, phone hash |
| verification token | The value `attest` produces, tying a result to its statement: the first eight-character code mixing capitals and digits after page 1's verification instruction | `verification_token`, `attest` | hash, signature |
| verification instruction | Page 1's printed line telling the user how to check the statement with Safaricom (a "dial" USSD line), as printed; None when absent or when it looks like it holds personal data. The app shows it instead of a code of its own | `verification_instruction` | verify code, USSD constant |
| pipeline result | What `pipeline.run` returns for one statement: plain JSON values, never PDF bytes or a password | `PipelineResult`, `pipeline.run` | output, response |
| recurring | Seen at least three times, so an isolated transaction is not treated as recurring. | `recurring` | repeat, regular, subscription |

## Architecture words

| Term | Meaning | Code name | Avoid |
|---|---|---|---|
| core | The pure Python package `mpesa_core`; no I/O, environment or network | `mpesa_core` | backend, server |
| bridge | The JSON-string boundary between JavaScript and Python in Pyodide | `bridge` | glue, api |
| statement engine | The module worker holding the pdf reader and the core under Pyodide, with its verified runtime; the main thread reaches it through `engine_client.js`. Its failures carry one of the reader's codes or `ENGINE_FAILED` | `create_statement_engine`, `reader.worker.js` | engine (alone, for the pdf reader) |
| runtime | The self-hosted files the statement engine loads: Pyodide, pdf.js, the wheel and the analysis packages, under `runtime/<version>/` with a SHA-256 manifest | `tools/vendor.py runtime`, `load_runtime` | CDN, bundle |
| "error" | Reserved for exceptions raised by code: `ExtractionError`, `AttestationError`, `DomainRowError`, `AnalysisError`, each with a code or a position only | `*Error` | using it for data-quality counts |
| remember on this device | The opt-in that keeps data in local browser storage, encrypted in the vault (ADR 0016). Off by default | `remember_on_device` | save, sync, upload, import |
| session | The statements read since the app's page was opened, held in memory only; a reload forgets them (CP8b, until "Remember on this device" in CP9) | `session` in `web/src/data/repo.ts` | login session, account session |
| static export | The web app built as plain files (`next build` with `output: "export"`), served with a per-page CSP (ADR 0015) | `web/out`, `postbuild.mjs` | server build |

## Storage on the device (ADR 0016)

| Term | Meaning | Code name | Avoid |
|---|---|---|---|
| vault | The encrypted IndexedDB database behind "Remember on this device", and the object that opens it. Locked until unlocked with the passphrase | `Vault`, `openVault`, `web/src/persistence/` | safe, keystore, db |
| passphrase | What the person types to create or unlock the vault; never stored | `checkPassphrase` | password (reserved for the PDF's password), PIN |
| hint | Optional plaintext reminder, at most 60 characters, holding no word of the passphrase; shown only after a failed unlock | `checkHint`, `hintAfterFailedUnlock` | clue, reminder |
| ledger | One encrypted blob of remembered data, under a ledger id, with a version counter. CP9b fills it with statements and transactions | `readLedger`, `saveLedger`, `LedgerRecord` | wallet, book, archive |
| key check | A known text sealed under the key in `meta`, so a wrong passphrase is told apart without opening a ledger | `key_check` | verifier, canary |
| lock | Dropping the key and every held ledger; by hand, after the idle time (`DEFAULT_IDLE_LOCK_MS`), on delete-all, or when another tab deletes the database | `lock`, `onLock`, `LockReason` | logout, sign out |
| version counter | The number of saves of one ledger; a save must name the counter it read (compare-and-set), so a stale tab cannot overwrite a newer save | `version`, `STALE_LEDGER` | revision, etag |
| memory-only mode | The vault's state when the browser refuses storage or runs out of quota: the app keeps working and nothing is saved | `memory_only`, `storageProblem` | offline mode, fallback |
| delete-all | Deleting the whole vault database: every ledger, the salt, the hint and the settings | `deleteAll` | reset, wipe, clear |

## Verbs for functions

Use the stage verb. The names mirror the pipeline.

| Stage | Verb | Example |
|---|---|---|
| PDF to statement pages | `extract` | `extract_statement_pages` |
| Pages to rows | `build` | `build_rows` |
| Rows to canonical rows | `canonicalize` | `canonicalize_rows` |
| Canonical rows to transactions | `classify` | `classify_transactions` |
| Transactions to report | `analyze` | `analyze_transactions` |
| Totals and chain checks | `reconcile` | `reconcile_statement` |
| Tying result to statement | `attest` | `attest_statement` |

Avoid `process_`, `handle_`, `do_` and `manage_` as function prefixes, and avoid `import` for any step: it is ambiguous here (we rejected `import_mpesa_statement` for this reason).

## Allowed exceptions

- The word "document" is allowed in `pdf_reader/` only where it names the pdf.js API (`PDFDocumentProxy`, `getDocument`).
- Test names may say "statement" for a synthetic statement; they never contain real data.
- `engine` stays as the field of `StatementPages` that names which PDF reader produced it, and as the matching manifest key. Renaming a contract field is a behaviour change (ADR 0010).
