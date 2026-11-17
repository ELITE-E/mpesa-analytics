# 0014. Lint the web app with its own ESLint 9; the rest of the repo keeps ESLint 10

Status: Accepted (CP8b, owner decision 2026-11-17)
Date: 2026-11-17

## Context

The ported Next.js app (`web/src`, `web/tests`) came with its own lint setup: `web/eslint.config.mjs` loads `eslint-config-next`, which brings `eslint-plugin-react` 7.37.5. The app's `package.json` pins ESLint 9.39.5, the version that plugin supports.

The repo's own lint runs ESLint 10.14.0 from the root. ESLint 10 looks up a config starting from each file's folder, so it began using `web/eslint.config.mjs` for every file under `web/`. Under ESLint 10 that plugin crashes on its first rule (`context.getFilename()` was removed), and the commit hook failed with `TypeError: contextOrFilename.getFilename is not a function`. The same lookup would also have taken `web/harness`, `web/probe` and `web/scripts` away from the root config and its JSDoc rules.

## Decision

Two lint scopes, each with one config:

- **Root ESLint 10**, always run with `--config eslint.config.mjs`, so one config applies to every file it lints. The root config ignores the app (`web/src/**`, `web/tests/**`) and the app's own config files. It still lints `web/harness`, `web/probe` and `web/scripts`, with the repo's JSDoc and naming rules.
- **The web app's ESLint 9**, run from `web/` with `web/eslint.config.mjs` (Next.js core web vitals and TypeScript). That config ignores `public/` (vendored and generated files) and the folders the root lints.

`tools/guards/run_node_tool.py` gains a `web-eslint` tool that runs from `web/`. Pre-commit has an `eslint (web app)` hook and CI an `ESLint (web app)` step, after `npm ci --prefix web`.

## Alternatives considered

| Option | Tradeoff |
|---|---|
| Two scopes (chosen) | Small change; ported files stay unchanged; ESLint 10 never loads the React plugin. Two ESLint versions in the repo, and ESLint 9 is end-of-life |
| One ESLint 10, a hand-written React/hooks config instead of `eslint-config-next` | One tool; needs plugin versions that support ESLint 10 and likely new findings across the ported code: many edits |
| Downgrade the root to ESLint 9 | One version; a tooling change for the whole repo, onto an end-of-life release |

## Consequences

- The ported app follows Next's lint rules, not the repo's JSDoc rule; new files written for CP8b carry JSDoc anyway. Retrofitting the ported files is a separate task.
- When `eslint-config-next` supports ESLint 10, merge back to one ESLint (cp8-notes).

## Enforcement

`tests/guards/test_node_tool.py`: the web ESLint runs from `web/` and is version 9; pre-commit and CI run it; the root always passes `--config`; the two configs split `web/` between them. `tests/guards/test_js_lint.py` runs the root ESLint with its config on the real repo.
