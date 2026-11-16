# Architecture (CP0)

- `src/mpesa_core/`: pure Python core, shipped as a `py3-none-any` wheel. Modules are empty
  in CP0. It does no I/O; `bridge.py` is the only module allowed to touch `js` or `pyodide`.
- `pdf_reader/`: browser side. `pdfjs/adapter.js` reads a PDF into statement pages; `reader.worker.js` is the statement engine's module worker (pdf.js, then the core under Pyodide); `runtime.js` verifies and loads the runtime; `bridge.js` passes JSON text to and from `bridge.py` `run_json`; `engine_client.js` is the main thread's handle, which enforces the timeout by replacing the worker; `limits.js` holds the desktop limits.
- `web/`: front end. `web/probe/` holds the pandas probe; `web/harness/` the bare CP8a engine page and its CSP server (`serve.js`, the architecture CSP, ADR 0013); `web/public/vendor/` holds what `tools/vendor.py fetch` downloads and `web/public/runtime/<version>/` what `tools/vendor.py runtime` builds from it with a SHA-256 manifest. Both are gitignored; nothing is loaded from a CDN.
- `src/mpesa_core/` stages, in pipeline order: `extraction/` (columns, rows), `cleaning/` (canonicalize, normalize, amounts; rules in `docs/decisions/cleaning-behaviour.md`), `classification/` (classify, entity, taxonomy; rules in `docs/decisions/classification-behaviour.md`), `analysis/` (the only package allowed pandas, for v1, loaded on first use: ADR 0006; rules in `docs/decisions/analysis-behaviour.md`), `reconciliation/` (reconcile, summary, attest, identity, import_plan; rules in `docs/decisions/identity-behaviour.md` and `import-plan-behaviour.md`). `contracts.py`, `errors.py`, `pipeline.py` and `bridge.py` stay at the top (ADR 0010).
- `src/mpesa_core/extraction/columns.py`, `extraction/rows.py`, `reconciliation/reconcile.py`: statement pages to raw rows and data quality (ADR 0009).
- `tools/pdf_readers/`: records `items.json` from real pdf.js, compares it with the generator's `model.json`, profiles a PDF as counts only, and holds `pdfplumber_reader.py`, the dev-only second PDF reader for the differential test. `extract_pages_cli.mjs` writes one PDF's statement pages outside the repo.
- `tools/synth/`: synthetic statement generator and an independent ledger. It may not import the core (import-linter), so the fixtures are a real second opinion.
- `tools/equivalence/layout_profile.py`: prints aggregate layout numbers for a PDF, never its text.
- `tools/equivalence/export_baseline.py`, `compare.py`: the owner's old-against-new check on a real statement. Counts and PASS or FAIL only.
- `tests/pdf_readers/`: the Node tests of the pdf.js adapter (`*.test.js`) and the Python tests of both PDF readers. `tests/fixtures/synthetic/`: the generated fixtures.
- `tests/core/`: runs under CPython and, from the built wheel, under Pyodide. A skipped test fails the run unless `tests/skip_allowlist.toml` gives a reason.
- `tools/guards/`: the guards. Configuration is in `tools/guards/guards.toml` and is always
  read from the repo, never from the tree being scanned.

## Guards

| # | Guard | Pre-commit | CI |
|---|-------|-----------|----|
| 1 | `scan_patterns.py` | yes | yes |
| 2 | `check_pdf_location.py` | yes | yes |
| 3 | `check_risky_types.py` | yes | yes |
| 4 | `check_fixture_provenance.py` | yes | yes |
| 5 | `check_secrets.py` (gitleaks) | staged | staged, history |
| 6 | `check_imports.py` (import-linter) | yes | yes |
| 7 | `check_core_purity.py` | yes | yes |
| 8 | `check_wheel.py` | no | yes |
| - | `check_function_docstrings.py` | yes | yes |
| - | `check_banned_names.py` | yes | yes |
| - | ruff lint and format, pydoclint | yes | yes |
| - | ESLint, Prettier | yes | yes |
| - | Guard tests, Pyodide import check | no | yes |

`tools/guards/error_message_safety.py` is a test helper rather than a guard (ADR 0004).

The file walk prunes tooling directories such as `.venv` and the vendored runtime. Each pruned
location must also be gitignored, and anything git tracks is checked even under a pruned path.

For maintainers: `docs/TOUR.md` follows one invented transaction through every stage, `docs/DEBUGGING.md` shows how to run one stage and which test covers it, and `docs/PORT_MAP.md` maps each old mpesa-parser function to its new home.
