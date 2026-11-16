# Port map: mpesa-parser to mpesa-analytics

Where each old module and function went. Use it to find the new home of something you knew in the old repo, and to see what deliberately behaves differently. IDs such as D-06 point at `docs/decisions/behaviour-changes.md`; anything not marked behaves as before.

Old paths are in mpesa-parser; new paths are in this repo, under `src/mpesa_core/` unless shown otherwise.

## Reading the statement

| Old | New | Notes |
|---|---|---|
| `src/security.py` `verify_pdf_magic_bytes` | `pdf_reader/pdfjs/adapter.js` `extract_statement_pages` (input check) | Error code `NOT_A_PDF` (D-03) |
| `src/security.py` `decrypt_pdf_in_memory`, `_execute_pdf_decryption` | `pdf_reader/pdfjs/adapter.js` (pdf.js opens it with the password) | Codes `PASSWORD_REQUIRED`, `PASSWORD_INCORRECT`. The password never reaches the core |
| `src/security.py` `attest_mpesa_structure` and its helpers | `reconciliation/attest.py` `attest` | Reads page 1 of `StatementPages`, not the PDF; no pypdf. Statement pages carry no PDF metadata, so a brand printed only in metadata no longer passes. Errors carry an `AttestationCode` only |
| `src/security.py` `DecryptionError`, `StructuralAttestationError` | `errors.py` `ExtractionError` (password codes), `AttestationError` | Messages carry codes and counts only (ADR 0004) |
| `src/extract.py` (pdfplumber table extraction) | `pdf_reader/pdfjs/adapter.js` (text items) and `extraction/columns.py`, `extraction/rows.py` `build_rows` | Split in two (ADR 0005). No tables found raises `LAYOUT_UNRECOGNIZED` instead of an empty frame (D-03). pdfplumber stays in dev only: `tools/pdf_readers/pdfplumber_reader.py` |

## Cleaning

| Old | New | Notes |
|---|---|---|
| `src/clean.py` `clean_mpesa_dataframe` | `cleaning/canonicalize.py` `canonicalize_rows` | Plain records, no pandas. Names: `status` (old `transaction_status`), and `paid_out` added here (canonical names, still open) |
| `src/clean.py` `_filter_invalid_receipt_rows` | `cleaning/canonicalize.py` `_has_usable_receipt` | |
| `src/clean.py` `_parse_numeric_columns` | `cleaning/canonicalize.py` `_amount` | |
| `src/clean.py` `_normalize_transaction_details` | `cleaning/canonicalize.py` `_canonical_row` | |
| `src/clean.py` `_standardize_output_schema` | `cleaning/canonicalize.py` `_canonical_row` | |
| `src/utils.py` `parse_currency`, `_execute_currency_parsing` | `cleaning/amounts.py` `parse_currency` | Logs nothing; unparsed amounts are counted in quality (D-04) |
| `src/normalize.py` `normalize_name` | `cleaning/normalize.py` `normalize_name` | Unanchored rewrites kept on purpose (D-08) |
| `src/normalize.py` `_remove_bracketed_references` | `cleaning/normalize.py` `REFERENCE_PATTERN` (in `normalize_name`) | |
| `src/normalize.py` `_reformat_paybill_pattern`, `_reformat_till_pattern` | `cleaning/normalize.py` `_rewrite_as_name_and_number` | One function, two patterns |
| `src/normalize.py` `_extract_p` (person-to-person) | `cleaning/normalize.py` `_rewrite_as_person_name` | |
| `src/normalize.py` `_sanitize_delimiters_and_spacing`, `_remove_embedded_newlines`, `_remove_visual_separators`, `_normalize_known_business_terms`, `_collapse_whitespace`, `_restore_business_identifier_boundaries` | `cleaning/normalize.py` `_tidy` | Same steps, same order |

## Classification

| Old | New | Notes |
|---|---|---|
| `src/event_types.py` `FinancialEvent` | `classification/taxonomy.py` `FinancialEvent` | A `StrEnum`; the pipeline hands plain text onward (D-01) |
| `src/engine_types.py` `CashFlowDirection`, `EconomicMeaning` | `classification/taxonomy.py` | |
| `src/engine.py` `process_engine` | `classification/classify.py` `classify_transactions` | Returns rows and diagnostics; logs nothing |
| `src/engine.py` `_validate_engine_input`, `_find_missing_required_columns`, `_raise_engine_contract_error` | `classification/classify.py` `classify_transactions` (field check) | The message names fields only |
| `src/engine.py` `_initialize_accounting_columns` | `classification/classify.py` `_with_event_type` | |
| `src/engine.py` `_classify_financial_event` | `classification/classify.py` `event_type_of`, `_rule_matches`, `EVENT_RULES` | Same rules, same order |
| `src/engine.py` `_record_unresolved_classifications`, `_log_unresolved_classification`, `_record_unresolved_economic_meanings`, `_log_unresolved_economic_meaning` | `classification/classify.py` `_diagnostics_for` | Diagnostics in memory, never logged (ADR 0004) |
| `src/engine.py` `_determine_cash_flow_direction` | `classification/classify.py` `_cash_flow_direction` | Both or neither amount still stops the run, as `DomainRowError` with a position only (D-05, not changed) |
| `src/engine.py` `_determine_economic_meaning` | `classification/classify.py` `economic_meaning_of` | D-02 |
| `src/engine.py` `_calculate_base_total_cost`, `_initialize_total_cost` | `classification/classify.py` `_base_total_cost` | |
| `src/engine.py` `_attribute_sequential_fees`, `_is_orphan_fee`, `_absorb_fee`, `_find_parent_index` | `classification/classify.py` `_attribute_fees` | Parents indexed by receipt number, linear time (D-07) |
| `src/entity.py` `enrich_transactions_with_entities`, `resolve_transaction_entity` | `classification/classify.py` `classify_transactions` (entity step) | |
| `src/entity.py` `extract_entity` and the seven `extract_*_entity` | `classification/entity.py`, same names | No match returns None, not the old marker |
| `src/entity.py` `_match_entity`, `_normalize_entity` | `classification/entity.py` `_captured` | |
| `src/entity.py` `_record_unresolved_entity` | `classification/classify.py` `_diagnostics_for` | |

## Analysis

| Old | New | Notes |
|---|---|---|
| `src/analytics/__init__.py` | `analysis/__init__.py` `analyze_transactions` | pandas loads on first call only (ADR 0006). pandas failures become `AnalysisError` with a code (A-3 stays: an unreadable date still stops date-based analysis, now typed) |
| `src/analytics/orchestration.py` `orchestrate_analytics`, `build_analytics_result` | `analysis/report.py` `build_report` | Report keys exactly as before |
| `src/analytics/orchestration.py` `_build_cash_flow_result` … `_build_fees_result` | `analysis/report.py` `_cash_flow_section` … `_fees_section` | |
| `src/analytics/orchestration.py` `_reorder_by_recency`, `_reorder_recurring_by_recency` | `analysis/report.py` `_newest_entity_first`, `_newest_recurring_first` | |
| `src/analytics/orchestration.py` `_as_public_float`, `_fee_period_as_public`, `_with_calendar_dates`, `_as_calendar_date` | `analysis/report.py` `_as_float`, `_fees_section`, `_calendar_date` | |
| `src/analytics/result.py` `AnalyticsResult` and section classes, `to_dict`, `to_json_safe`, `__getitem__`, `_public_value` | `analysis/report.py` `public_value` | A plain dict instead of classes; numpy numbers become Python numbers of equal value (A-4) |
| `src/analytics/preparation.py` `_prepare_analytics_dataframe`, `_coerce_dataframe_records` | `analysis/frame.py` `prepared_frame` | Classes go in as plain text (D-01) |
| `src/analytics/preparation.py` `_resolve_period_bounds` | `analysis/frame.py` `resolve_period` | |
| `src/analytics/preparation.py` `_select_*_transactions`, `_select_qualifying_spending`, `_exclude_unidentified_entities`, `_filter_by_period` | `analysis/frame.py` `select_events`, `select_qualifying_spending`, `exclude_unidentified_entities`, `filter_by_period` | A-3 deferred |
| `src/analytics/cash_flow.py` (four functions) | `analysis/cash_flow.py`, same names | D-01. `calculate_closing_balance` keeps the old pandas order; the D-06 rule lives in `balances` |
| `src/analytics/fees.py` (three public, `_within_period`, `_is_fee_type`) | `analysis/fees.py`, same public names, `_fees_paid` | |
| `src/analytics/investments.py` | `analysis/investments.py`, same public names | |
| `src/analytics/recurrence.py` | `analysis/recurrence.py`, same names | |
| `src/analytics/spending.py` | `analysis/spending.py`, same public names | |
| `src/analytics/transfers.py` | `analysis/transfers.py`, same public names, `_shared_rankings` | |

## The whole run

| Old | New | Notes |
|---|---|---|
| `src/pipeline.py` `analyze_mpesa_statement`, `prepare_mpesa_statement_for_persistence`, `process_mpesa_statement`, `canonicalize_mpesa_statement` | `pipeline.py` `run` | Takes statement pages, never a path, bytes or password. No I/O, no clock |
| `src/pipeline.py` `ingest_mpesa_statement`, `_unrecognized_event_observations` | CP9 browser store; unclassified rows are counted in `quality` via `measure_unclassified` | "Remember on this device", opt-in (ADR 0012) |
| `src/pipeline.py` `_read_statement_bytes` | none | The core reads no files |

## Persistence (server only in the old repo)

| Old | New | Notes |
|---|---|---|
| `src/persistence/identity.py` `resolve_transaction_identity`, `IdentityOutcome`, `IdentityResolution`, `_material_fingerprint` | `reconciliation/identity.py` `resolve_identity`, `NEW`/`MATCH`/`COLLISION`, `IdentityResolution` (contracts), `fingerprint` | Pure, no storage. Candidates are passed in, not queried; owners are dropped. Rules: `docs/decisions/identity-behaviour.md` |
| `src/persistence/collisions.py` `preserve_collision` and helpers | Decision: `reconciliation/import_plan.py` (`preserve` actions; `validate_import_plan` refuses preserving a non-collision). Storage: `web/src/persistence` (CP9) | Python decides, JavaScript persists |
| `src/persistence/orchestration.py`, `statements.py`, `transactions.py`, `observations.py`, `provenance.py`, `analytics_snapshots.py` | Row decisions: `reconciliation/import_plan.py` `plan_statement_import`, exposed by `bridge.py` as JSON. Storage, in one IndexedDB transaction: `web/src/persistence` (CP9) | Rules: `docs/decisions/import-plan-behaviour.md` |
| `src/persistence/database.py`, `src/persistence/models.py` (`User`, `AuthSession`, `LoginThrottleCounter` and the tables) | dropped | No server, no accounts |

## New in the rewrite

| New | What it does |
|---|---|
| `contracts.py` | Typed shapes passed between stages, including `Balances`, `Period`, `PipelineResult`, `IdentityResolution` and `ImportPlan` |
| `bridge.py` `plan_statement_import_json`, `validate_import_plan_json` | JSON in and out for the browser store; typed `ImportPlanError` on failure |
| `tools/synth/import_ledger.py` | Independent import planner for the agreement test |
| `extraction/columns.py` `calibrate_columns` | Column positions from anchor rows (ADR 0009) |
| `extraction/rows.py` `assemble_rows` | Rows plus layout counts |
| `reconciliation/reconcile.py` `reconcile` | Data quality: chain breaks in both orientations, summary check, receipt lengths |
| `reconciliation/reconcile.py` `measure_unclassified` | Unclassified counts in quality, not the report |
| `reconciliation/reconcile.py` `measure_balances` | Opening and closing balance in print order (D-06) |
| `pipeline.py` `measure_period` | The span of readable completion times |
| `tools/synth/` | Synthetic statements and the independent ledger |
| `tools/equivalence/` | Owner-only comparison against the old code |
