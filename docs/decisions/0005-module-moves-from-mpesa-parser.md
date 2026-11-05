# 0005. Module moves from mpesa-parser

Status: Proposed
Date: 2026-11-02

## Context

Standard 7.2 says module boundaries are respected, and a move needs a clear architectural reason. The browser rewrite moves and splits modules because the core must be pure Python (no files, environment, network or clock) and must run unchanged under CPython and Pyodide. This ADR records each move and its reason. Check the table against `INVENTORY.md` of the migration plan before accepting; the plan's module list is authoritative where they differ.

## Decision

| Old (mpesa-parser) | New (mpesa-analytics) | Reason |
|---|---|---|
| `src/extract.py` (pdfplumber `extract_table`) | `engine/pdfjs/adapter.js` (extract) and `mpesa_core/columns.py` + `rows.py` (build rows) | The PDF engine is replaceable and outside the core; row building becomes pure code over statement pages |
| pdfplumber path | `tools/engines/pdfplumber_engine.py` (dev and CI only) | Differential check, through the same row builder; not shipped, too slow in the browser |
| `src/clean.py` | `mpesa_core/canonicalize.py` | Works on row records instead of frames; same rules |
| `src/utils.py` (`parse_currency`) | `mpesa_core/` (utility module) | Keeps 0.0 for blank; no raw-value logging |
| `src/engine.py` (classifier) | `mpesa_core/classify.py` | Returns diagnostics instead of writing logs; rule order preserved |
| `src/normalize.py` | `mpesa_core/normalize.py` | Unchanged in purpose; docstring scrubbed |
| `src/entity.py` | `mpesa_core/entity.py` | Unchanged in purpose |
| `src/security.py` (attestation) | `mpesa_core/attest.py` | Same purpose, no I/O |
| identity logic (`test_transaction_identity`) | `mpesa_core/identity.py` | Local store needs the same identity rules |
| `src/analytics/*` | `mpesa_core/analytics/*` | Same domains; one module per domain |
| `src/pipeline.py` | `mpesa_core/pipeline.py` (`run`) | Composition only, no persistence |
| none | `mpesa_core/reconcile.py`, `bridge.py`, `contracts.py`, `errors.py` | New: reconciliation, the Pyodide boundary, typed contracts |

**Dropped, with reason:** `src/api/`, `src/services/`, `src/persistence/` (server and database), authentication, `src/app.py` (Streamlit), `src/logs.py` as a file writer (the core returns diagnostics). The frontend moves from Next.js to a static Vite + React app; `lib/api.ts` becomes `data/repo.ts` with the same exported surface.

## Alternatives considered

| Option | Tradeoff |
|---|---|
| Copy modules unchanged | Brings I/O, logging and pandas semantics into the core and breaks purity |
| Move only what must move (chosen) | More reasoning per module; each move is justified above |

## Consequences

Tests follow their modules. Ported tests keep their assertions (standard 9.3). Rewritten tests keep the assertion's meaning; changes are recorded in `test-edits.md`.

## Enforcement

`.importlinter` layers and `check_core_purity.py` fail the build if a moved module regains I/O or a forbidden import.
