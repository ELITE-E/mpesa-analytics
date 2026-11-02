# Glossary

One word per concept. Code, tests, fixtures and docs use the term in the first column. The "Avoid" column is checked in CI through the banned-names list in `tools/guards/guards.toml`.

Field names that form the frontend contract (`receipt_no`, `completion_time`, `paid_out`, `entity`, and the keys of the report) keep their existing names even where prose prefers another word. Renaming them is a behaviour change (see `docs/decisions/behaviour-changes.md`).

## Statement and extraction

| Term | Meaning | Code name | Avoid |
|---|---|---|---|
| statement | The M-PESA personal statement the user provides, as a whole | `statement` | document, file, record |
| statement pages | Positioned text items per page, as returned by the PDF engine, before any row exists. Replaces the contract name `PagesDocument` (decided at CP1, before any code uses it) | `StatementPages` | PagesDocument, doc, raw pdf |
| page | One printed page of the statement | `Page` | sheet |
| text item | One piece of text with its position, from the engine | `TextItem` | token, word, chunk |
| engine | The PDF text extractor: pdf.js in the app; pdfplumber in dev and CI only | `engine/` | parser, reader |
| anchor row | A printed line holding both a receipt number and a completion timestamp. Row boundaries and column positions are calibrated from these lines | `anchor_row` | first line, data line |
| header row | The printed column titles. Used only to confirm column order, never position | `header_row` | title row |
| column calibration | Deriving column x positions from anchor rows | `columns.py` | column detection |
| layout | The printed arrangement of a statement. "Format" is reserved for file formats | `layout` | format, template |

## Rows and transactions

| Term | Meaning | Code name | Avoid |
|---|---|---|---|
| row | One transaction as printed, possibly over several text lines, before cleaning | `RawRow`, `build_rows` | line, record, entry |
| canonical row | A row after cleaning: typed amounts, normalized details | `CanonicalRow`, `canonicalize` | clean row, normalized row |
| transaction | A canonical row plus its classification | `ClassifiedRow` | txn, tx, entry, record |
| receipt number | The code printed for each transaction | `receipt_no` | ref, reference, transaction_id |
| completion time | When the transaction completed | `completion_time` | date, timestamp |
| details | The printed free-text description | `details` | description, narration, memo |
| status | The printed status of the transaction | `status` | state |
| paid in | The printed inflow amount | `paid_in` | credit |
| withdrawn | The printed outflow amount | `withdrawn` | debit |
| paid out | The derived outflow amount used by analytics | `paid_out` | outflow (in code names) |
| balance | The printed running balance after the transaction | `balance` | amount_left |
| closing balance | The balance of the latest transaction in the period | `closing_balance` | final balance |
| balance chain | The sequence in which each balance equals the previous balance plus paid in minus paid out | `balance_chain` | running total |
| chain break | A place where a balance does not follow from the previous row | `chain_break` | mismatch, gap |

## Classification

| Term | Meaning | Code name | Avoid |
|---|---|---|---|
| event type | The classified kind of transaction, one of the `EventType` values | `event_type` | type, category, kind |
| cash flow direction | Whether money came in, went out, or neither | `cash_flow_direction` | direction on its own |
| economic meaning | The economic purpose of a transaction, one of the `EconomicMeaning` values | `economic_meaning` | purpose, category |
| entity | The counterparty identified from the details (a person, merchant, till or paybill) | `entity` | counterparty (in code), party |
| fee | A charge row attached to a parent transaction | `fee` | charge (except the analytic named transfer charges) |
| parent transaction | The transaction a fee belongs to; they share a receipt number | `parent` | main transaction |
| total cost | A transaction's amount plus the fees attributed to it | `total_cost` | full cost |

## Results and checks

| Term | Meaning | Code name | Avoid |
|---|---|---|---|
| period | The date range being analysed | `period` | range, window |
| report | The analytics result (the keys of `AnalyticsResult.to_json_safe()`) | `report` | analytics (as a noun), summary |
| statement summary | The totals printed on page 1 of the statement | `statement_summary` | header totals |
| reconciliation | Comparing parsed rows with the statement summary and the balance chain | `reconcile` | validation, verification |
| data quality | Counts of problems found while processing (row counts, status counts, chain breaks, unparsed amounts) | `DataQuality`, `quality` | warnings, errors |
| diagnostic | An item describing one row that could not be resolved. Held in memory only | `Diagnostic` | issue, problem |
| verification token | The value `attest` produces, tying a result to its statement | `verification_token` | hash, signature |

## Architecture words

| Term | Meaning | Code name | Avoid |
|---|---|---|---|
| core | The pure Python package `mpesa_core`; no I/O, environment or network | `mpesa_core` | backend, server |
| bridge | The JSON-string boundary between JavaScript and Python in Pyodide | `bridge` | glue, api |
| "error" | Reserved for exceptions raised by code | `*Error` | using it for data-quality counts |

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

- The word "document" is allowed in `engine/` only where it names the pdf.js API (`PDFDocumentProxy`, `getDocument`).
- Test names may say "statement" for a synthetic statement; they never contain real data.
