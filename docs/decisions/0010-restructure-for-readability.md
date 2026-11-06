# 0010. Restructure for readability

Status: Proposed
Date: 2026-11-06

## Context

Standard 7.2 allows moving code only for a recorded architectural reason. The core had grown to a flat list of modules from five pipeline stages, so a reader could not see the stages from the folders. "Engine" named the PDF text extractor here but the classifier in the old repo, so the word was ambiguous across the migration. Tests lived in four places, and fixtures sat outside `tests/`.

This is a mechanical move. No behaviour changed: every check had the same count before and after, except two named below.

## Decision

Group the core by pipeline stage, call the PDF text extractor the "PDF reader", and put every test and fixture that does not need the front end's toolchain under `tests/`.

| Old | New |
|---|---|
| `src/mpesa_core/columns.py`, `rows.py` | `src/mpesa_core/extraction/` |
| `src/mpesa_core/canonicalize.py`, `normalize.py` | `src/mpesa_core/cleaning/` |
| `src/mpesa_core/classify.py`, `entity.py` | `src/mpesa_core/classification/` |
| `src/mpesa_core/analytics/` | `src/mpesa_core/analysis/` |
| `src/mpesa_core/reconcile.py`, `attest.py`, `identity.py` | `src/mpesa_core/reconciliation/` |
| `src/mpesa_core/contracts.py`, `errors.py`, `pipeline.py`, `bridge.py`, `types.py` | unchanged, at the top |
| `engine/` | `pdf_reader/` |
| `engine/engine.worker.js` | `pdf_reader/reader.worker.js` |
| `engine/tests/` | `tests/pdf_readers/` |
| `tests/engines/` | `tests/pdf_readers/` |
| `tests/engines/test_pdfplumber_engine.py` | `tests/pdf_readers/test_pdfplumber_reader.py` |
| `tests/guards/test_engine_wiring.py` | `tests/guards/test_pdf_reader_wiring.py` |
| `tools/engines/` | `tools/pdf_readers/` |
| `tools/engines/pdfplumber_engine.py` | `tools/pdf_readers/pdfplumber_reader.py` |
| `tools/engines/fixture_engine.js` | `tools/pdf_readers/fixture_reader.js` |
| `fixtures/synthetic/` | `tests/fixtures/synthetic/` |
| `configure_engine`, `use_node_engine` | `configure_reader`, `use_node_reader` |
| `web/src/data/` (planned in ADR 0005 as `data/repo.ts`) | `web/src/persistence/`, when it is created; nothing existed to move |
| `.ruff_cache/` in the repo | `~/.cache/ruff/mpesa-analytics`, through `cache-dir` |

The Node tests and the Python tests of the PDF readers share `tests/pdf_readers/`. Their file patterns do not overlap: pytest collects `test_*.py`, and Node runs `*.test.js`.

## Alternatives considered

| Option | Tradeoff |
|---|---|
| Keep the flat core | No moves; the stages stay invisible |
| Separate `tests/pdf_reader/` (Node) and `tests/pdf_readers/` (Python) | Mirrors the toolchains; two folders one letter apart |
| Rename the `StatementPages.engine` field too | Consistent wording; changes a contract and 28 recorded files, so it is not a mechanical move |
| Move `web/tests` and `web/e2e` under `tests/` | One roof for everything; they need the front end's toolchain |

## Consequences

- `StatementPages.engine` and the manifest's `engine` key keep their names; the glossary lists them as an exception. Renaming them is a separate, logged behaviour change.
- `types.py` is an empty stub that fits no stage. It stays at the top until a change decides its fate.
- **Counts that differ, and why:** pytest has one more test, because `test_pdf_location.py` now also proves the old `fixtures/synthetic/` location fails. Ruff formats four more files: the stages' new `__init__.py`.
- The fixture bytes did not change. Their manifest paths are relative, so only its two header comment lines changed.
- ESLint now names `tests/pdf_readers/` explicitly, so the moved Node tests keep the same rules, `no-console` included.
- Earlier ADRs keep their paths as written. ADR 0005 carries a note pointing here.

## Enforcement

`.importlinter` names the new module paths. `tests/guards/test_pdf_location.py` fails a PDF anywhere except `tests/fixtures/synthetic/`, the old location included. `tests/guards/test_pdf_reader_wiring.py` checks that CI runs the Node tests from their new folder.
