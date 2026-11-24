# Contributing

Thanks for helping. Three rules come before anything else:

1. **Synthetic data only.** Never commit, attach or paste a real statement, or anything read
   from one: receipt numbers, phone numbers, names, amounts, screenshots. Test data comes from
   the synthetic generator (`tools/synth/`), and each fixture is listed with its seed in
   `tests/fixtures/synthetic/MANIFEST.toml`. The guards and the history scan reject
   statement-shaped text; do not work around them.
2. **Red first.** Write the test for the behaviour, run it and watch it fail for the reason you
   expect, then make the smallest change that passes, then run the broader suite. Say in the pull
   request what failed before your change. A test that passed at once needs a reason.
3. **Follow the standards** in `docs/CODING_STANDARDS.md`: names from `docs/glossary.md`, a
   docstring or JSDoc on every function, no silent error handling, no statement value in any
   error message, log line or network request. The pull request template carries the review
   checklist.

Changing an existing test's assertion is a recorded decision: add it to
`docs/decisions/test-edits.md`. A deliberate behaviour change goes in
`docs/decisions/behaviour-changes.md`, and a new runtime dependency needs an ADR and a size check.

## Setup

    uv sync
    npm ci
    npm ci --prefix web
    uv run python tools/vendor.py fetch     # pinned runtime, gitleaks and node
    uv run pre-commit install

## Running each suite

| Suite | Command | Needs |
|---|---|---|
| Fast checks (guards, lint, format) | `uv run pre-commit run --all-files` | |
| Python tests (core, guards, tools, release docs) | `uv run pytest` | |
| PDF reader under Node | `node --test tests/pdf_readers/*.test.js` | |
| Core under Pyodide | `node tools/run_pyodide_tests.mjs` | the wheel |
| Build the wheel and runtime | `uv build --wheel --out-dir dist && uv run python tools/vendor.py runtime --wheel dist/mpesa_core-1.0.0-py3-none-any.whl` | |
| Statement engine in Chrome | `node --test --test-concurrency=1 tests/browser/*.test.js` | runtime, system Chrome |
| Build the app | `npm run build --prefix web` | runtime |
| Web app (from `web/`) | `node --import ./tests/support/register.mjs --test tests/*.test.mjs tests/*.test.ts` | the build; the `*-chrome`, `e2e` and `remember-e2e` files need Chrome |
| Host headers (from `web/`) | `node --import ./tests/support/register.mjs --test tests/host-headers.test.mjs` | the build |
| Release tools | `node --test --test-concurrency=1 tests/release/*.test.mjs` | the build, Chrome |
| History scan | `uv run python tools/release/scan_history.py` | gitleaks |

CI (`.github/workflows/ci.yml`) runs all of these. Nothing in CI uses real data.

## Reporting

Bugs and ideas: open an issue with a template; they ask for the shape of a problem, never the
statement. Vulnerabilities: `SECURITY.md`, privately.
