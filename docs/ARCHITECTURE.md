# Architecture (CP0)

- `src/mpesa_core/`: pure Python core, shipped as a `py3-none-any` wheel. Modules are empty
  in CP0. It does no I/O; `bridge.py` is the only module allowed to touch `js` or `pyodide`.
- `engine/`: browser side, with pdf.js behind an adapter and a worker. Stubs in CP0.
- `web/`: front end. `web/probe/` holds the pandas probe; `web/public/vendor/` holds the
  runtime that `tools/vendor.py` fetches. That directory is gitignored.
- `tools/guards/`: the guards. Configuration is in `tools/guards/guards.toml` and is always
  read from the repo, never from the tree being scanned.

## Guards

| # | Guard | Pre-commit | CI |
|---|-------|-----------|----|
| 1 | `scan_patterns.py` | yes | yes |
| 2 | `check_pdf_location.py` | yes | yes |
| 3 | `check_risky_types.py` | yes | yes |
| 4 | `check_fixture_provenance.py` | yes | yes |
| 5 | `check_secrets.py` (gitleaks) | staged, history | staged, history |
| 6 | `check_imports.py` (import-linter) | yes | yes |
| 7 | `check_core_purity.py` | yes | yes |
| 8 | `check_wheel.py` | no | yes |

The file walk prunes tooling directories such as `.venv` and the vendored runtime. Each pruned
location must also be gitignored, and anything git tracks is checked even under a pruned path.
