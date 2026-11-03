# Architecture (CP0)

- `src/mpesa_core/`: pure Python core, shipped as a `py3-none-any` wheel. Modules are empty
  in CP0. It does no I/O; `bridge.py` is the only module allowed to touch `js` or `pyodide`.
- `engine/`: browser side, with pdf.js behind an adapter and a worker. Stubs in CP0.
- `web/`: front end. `web/probe/` holds the pandas probe; `web/public/vendor/` holds the
  runtime that `tools/vendor.py` fetches. That directory is gitignored.
- `tools/synth/`: synthetic statement generator and an independent ledger. It may not import the core (import-linter), so the fixtures are a real second opinion.
- `tools/equivalence/layout_profile.py`: prints aggregate layout numbers for a PDF, never its text.
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
