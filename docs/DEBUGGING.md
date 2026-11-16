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

The core tests also run under Pyodide: build the wheel (`uv build --wheel`), then `node tools/run_pyodide_tests.mjs`.

## Errors you may see

Every core error carries a code and, at most, a position; never a statement value (ADR 0004). The cause, which may quote a value, is kept in `__cause__` for your own debugger and never crosses the bridge.

| Error | Codes | Raised by |
|---|---|---|
| `ExtractionError` | `LAYOUT_UNRECOGNIZED`, `NOT_A_PDF`, `PASSWORD_*`, `CORRUPT_PDF`, `TOO_*`, `TIMEOUT` | the PDF reader, `calibrate_columns` |
| `AttestationError` | `NO_PAGES`, `BRAND_MISSING`, `ANCHOR_MISSING`, `TOKEN_MISSING` | `attest` |
| `DomainRowError` | row index only | `classify_transactions` (a row with both or neither amount) |
| `AnalysisError` | `DATE_UNREADABLE` (with the row), `ANALYSIS_FAILED` | `analyze_transactions` |
| `ImportPlanError` | `INCOMING_ROW_INVALID`, `EXISTING_ROW_INVALID` (with the row), `REQUEST_INVALID`, `ROW_ACTION_COUNT`, `PRESERVE_NOT_COLLISION`, `PLAN_MISMATCH` | `plan_statement_import`, `validate_import_plan`, the bridge |
