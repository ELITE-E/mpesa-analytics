# Coding standards: mpesa-analytics

Status: amended edition for the browser-local rewrite. Sections marked **(amended)** or **(new)** differ from the original standards carried over from mpesa-parser. Everything else is unchanged in substance.

Applies to: Python (`src/mpesa_core`, `tools`), JavaScript/TypeScript (`engine`, `web`). Tests are exempt from the docstring rule only (see 3).

## What changed from the original

| Area | Change | Why |
|---|---|---|
| 0 | New: how each rule is enforced | Rules without a check drift |
| 1.3 | Vocabulary now lives in `docs/glossary.md` and is checked | Terms must not drift between code, tests and docs |
| 3 | Tests exempt from docstrings; JS/TS uses JSDoc | Test names carry the contract |
| 5.5 | Zero recognized anchors raises `LAYOUT_UNRECOGNIZED`; never an empty result | The old extractor returned an empty frame on failure |
| 5.6 | Error messages never contain statement values | Privacy |
| 5.7 | Boundary is the Pyodide bridge and the UI, not an HTTP API | No server |
| 5.8 | Integrity applies to local storage ("remember on this device") | No database |
| 7.2 | Module moves from the old repo need a recorded architectural reason | Migration reshapes modules |
| 9.4 | Red-first must be visible in history | Cannot be proved by tooling |
| 9.5 | "Realistic" means a realistic synthetic generator; real statements are never used | Privacy |
| 10 | New runtime dependency needs an ADR and a size check | Download budget |
| 11.2 | Deliberate behaviour changes are logged in `docs/decisions/behaviour-changes.md` | Preserve-then-change discipline |
| 12 | New: privacy and data handling | Defining rule of the new system |
| 13 | Checklist gains a privacy group | |

## 0. Enforcement (new)

A rule that no check enforces is a convention. Where a tool can check a rule it runs in pre-commit and CI; the rest is checked in review with the PR template.

| Rule | Check | Where |
|---|---|---|
| Docstring on every function, method, nested function | `check_function_docstrings.py`; ruff `D`; `pydoclint` for Args/Returns/Raises | pre-commit, CI |
| No silent swallow, no bare except, `raise ... from` | ruff `BLE001`, `S110`, `E722`, `B904` | pre-commit, CI |
| No boolean positional arguments | ruff `FBT001`, `FBT002` | pre-commit, CI |
| Function size, arguments, nesting | ruff `C901` (10), `PLR0912`, `PLR0913` (5), `PLR0915` | pre-commit, CI |
| Generic and single-letter names | `check_banned_names.py` with a reasoned allowlist | pre-commit, CI |
| Domain vocabulary | `guards.toml` banned names; `docs/glossary.md` | pre-commit, CI |
| Formatting and imports | `ruff format`, import sorting, Prettier | pre-commit |
| Core purity (no I/O, env, network) | `check_core_purity.py`, import-linter | pre-commit, CI |
| No real data, no stray PDFs | pattern, PDF and risky-type guards; fixture provenance | pre-commit, CI |
| JS/TS | ESLint: jsdoc, `max-params`, `complexity`, `max-depth`, `no-empty`, `no-console` in core code | pre-commit, CI |
| Naming intent, abstraction level, reading order, comment quality, red-first | Review checklist (section 13) | PR template |

## 1. Naming

Code should communicate its intention without requiring the reader to investigate its implementation first.

1.1 **Use intention-revealing names.** Prefer `transaction_receipt_number` over `ref`, `unrecognized_event_type` over `flag`, `imported_at` over `date`, `build_transaction_rows()` over `process_data()`.

1.2 **Use meaningful and explicit names.** Avoid single-letter names outside conventional loops or comprehensions, cryptic abbreviations, and generic names (`data`, `result`, `temp`, `info`, `item`) where a specific name exists. Enforced by `check_banned_names.py`.

1.3 **Use domain vocabulary consistently (amended).** The glossary in `docs/glossary.md` is the source of truth. If the domain says statement, do not call the same thing a document, file or record. The glossary lists the "avoid" synonyms. This applies to functions, variables, classes, modules, tests, fixtures and documentation.

1.4 **Names must not misrepresent behaviour.** A function name must describe what it does. We rejected `import_mpesa_statement()` because "import" is ambiguous here, and `import_mpesa_statement` is on the banned list.

1.5 **Use pronounceable and searchable names.**

1.6 **Avoid misleading names and noise.** As explicit as necessary, not a sentence.

## 2. Functions

2.1 **One thing.** A function that reads a PDF, builds rows, normalizes, classifies and analyzes does too much. Extract when it improves clarity, responsibility or reuse, not merely to cut lines.

2.2 **Small enough to understand.** No magic line count. Can I understand it quickly? One responsibility? Straightforward flow? The lint limits (complexity 10, 5 arguments) are smell detectors, not the standard.

2.3 **One level of abstraction.** For example:

```python
def analyze_statement(statement_pages):
    """..."""
    rows = build_transaction_rows(statement_pages)
    canonical_rows = canonicalize_rows(rows)
    classified_rows = classify_rows(canonical_rows)
    return summarize_statement(classified_rows)
```

2.4 **Read top to bottom (newspaper rule).** High-level functions appear before the helpers they call. Checked in review.

2.5 **Minimize arguments.** Too many arguments means too many responsibilities or a missing domain object. Do not bundle unrelated arguments into a class.

2.6 **No hidden side effects (amended).** In `mpesa_core` there are no side effects at all: no files, network, environment, globals or printing. This is enforced by `check_core_purity.py`. Side effects live in `bridge.py`, `engine/` and `web/`, and are named and documented.

2.7 **Separate commands from queries.**

2.8 **No obscuring boolean arguments.** `process_statement(statement, True, False)` is rejected by lint. Use keyword-only arguments or separate operations.

2.9 **Avoid unnecessary nesting.** Guard clauses and early returns.

2.10 **Avoid cleverness.**

## 3. Documentation and docstrings

Mandatory: **every implementation function has a meaningful docstring.** That includes public, private and helper functions, methods, nested functions, new functions and modified functions. Test functions are exempt (amended): their names describe the behaviour they pin down.

A docstring explains the contract, not the name. It states:
- 3.1 Purpose.
- 3.2 Inputs: meaning, shape, constraints.
- 3.3 Return value, including the distinction between outcomes.
- 3.4 Side effects, or that there are none.
- 3.5 Exceptions the caller should expect.

```python
def build_transaction_rows(statement_pages):
    """Build raw transaction rows from extracted statement pages.

    Args:
        statement_pages: Pages of positioned text items from the PDF engine.

    Returns:
        Transaction rows in print order, one per receipt anchor.

    Raises:
        LayoutUnrecognizedError: If no receipt/date anchor rows are found.

    Side Effects:
        None.
    """
```

The docstring must reflect the actual implementation; never document behaviour the function does not guarantee. `pydoclint` checks sections against the code. JS/TS uses JSDoc with the same contents (`@param`, `@returns`, `@throws`).

3.6 **Avoid redundant comments.** Document the contract and important decisions, not every line.

## 4. Comments

4.1 **Explain why, not what.** `# Require three occurrences to avoid treating isolated transactions as recurring.`

4.2 **Prefer expressive code** to explanatory comments: extract a well-named predicate such as `is_completed_with_valid_receipt`.

4.3 **Comments must remain accurate.** Update them when behaviour changes.

4.4 **Do not excuse bad code with comments.**

4.5 **Avoid comment noise.** Comment business rules, constraints and non-obvious reasoning.

## 5. Error handling and exceptions

5.1 **Do not silently swallow exceptions.** `except Exception: pass` is rejected by lint.

5.2 **Exceptions for exceptional conditions,** not ordinary control flow. Violated contracts are reported clearly.

5.3 **Catch at the appropriate level.** An extraction function reports extraction failures; a boundary translates them for the user. Do not catch at every layer only to re-raise.

5.4 **Do not lose the original error.** `raise ExtractionError("...") from error`.

5.5 **Fail explicitly when invariants are violated (amended).** Do not invent a fallback that makes failure look like success. In particular, if layout calibration finds no anchor rows, the engine raises `LAYOUT_UNRECOGNIZED`; it never returns an empty result. A row with neither a valid inflow nor outflow gets no arbitrary direction.

5.6 **Meaningful error messages, without statement values (amended).** A message says what failed, where, and which operation was affected, using positions and counts (page number, row index, column, expected vs found counts). **It never contains statement text, names, phone numbers, amounts or receipt numbers**, because messages end up in consoles, logs and bug reports. See ADR 0004.

5.7 **Do not expose internals at boundaries (amended).** The boundaries are the Pyodide bridge and the UI. Nothing from a statement is written to the console or sent over the network. The no-leak end-to-end test checks this.

5.8 **Preserve integrity of stored data (amended).** There is no database. By default nothing is stored. When the user opts in to "Remember on this device", a failed save must leave no partial records, and "delete all" must remove everything the app stored. Both have tests.

## 6. Formatting and layout

6.1 Consistency over preference: `ruff format` and Prettier decide. 6.2 Keep related code together; imports at top; high-level before low-level. 6.3 No visual noise. 6.4 Whitespace shows structure. 6.5 Keep lines readable; use intermediate variables. 6.6 Make control flow obvious.

## 7. Classes, modules and responsibilities

7.1 **Single responsibility.** Keep clear distinctions between PDF extraction (`engine/`), row building, canonicalization, classification, analytics, bridge and storage. `import-linter` enforces the layers in `mpesa_core`.

7.2 **Respect module boundaries (amended).** Do not move code between modules because another arrangement looks nicer. The rewrite from mpesa-parser does move code (for example `clean` to `canonicalize`, `extract` split into engine and `build_rows`); each such move has a recorded architectural reason in ADR 0005 (pure core, no I/O).

7.3 **Avoid unnecessary abstractions.** No wrapper classes for one trivial function, no frameworks for one use case, no forwarding layers.

7.4 **Avoid premature decomposition.** Modularity, not fragmentation.

7.5 **Keep related data and behaviour together** where it helps cohesion; simple operations stay functions.

## 8. Duplication and abstraction

8.1 Centralize genuinely shared business rules. 8.2 Do not merge code that looks alike but means different things (two calculations using `paid_out` may differ financially). 8.3 Abstract around domain concepts, not syntax. 8.4 Abstractions must be understandable without a chain of indirection.

## 9. Tests and contracts

Tests are executable contracts, not optional verification.

9.1 **Describe observable behaviour.** For example: a failed save leaves no partial records; a statement with no recognizable layout raises `LAYOUT_UNRECOGNIZED`; two rows with the same second keep their print order.

9.2 **Test failures and edge cases:** valid, invalid, empty, missing, boundary, duplicate, conflicting inputs, failures partway through, and cleanup.

9.3 **Protect existing behaviour (amended).** Ported tests keep their original assertions. A test rewritten for the new seam keeps the assertion's meaning; if the assertion must change, that is a recorded decision, not a quiet edit.

9.4 **Red first (amended).** Workflow: define the behaviour, write the test, watch it fail for the expected reason, implement the smallest change, run the focused tests, run the broader suite. History must show the test before the implementation (separate commits, or a note in the PR with the failing output). No module is ported until its listed tests exist and fail.

9.5 **Test real domain behaviour (amended).** Use realistic data and meaningful edge cases, but **never real statements**. Realism comes from the synthetic generator, which is checked against a real statement by aggregate layout profiles only (`layout_profile`, medians and distributions). Mock only genuine external dependencies; do not mock the extractor or the core to hide integration problems. The same tests run under CPython and Pyodide.

9.6 **Readable tests:** scenario, input, expected behaviour, outcome. Names describe behaviour.

9.7 **Do not change tests to make broken code pass (amended).** A failing test is evidence. Decide whether the test, the implementation or the contract is wrong. Any edit to an existing test is recorded in `docs/decisions/test-edits.md` with the old assertion, the new assertion and the reason.

## 10. Dependencies and external boundaries

10.1 **Keep dependencies purposeful (amended).** `mpesa_core` runtime dependencies are minimal and listed in ADR 0006. Adding one needs an ADR and a download-size check against the budget, because the app ships to the user's browser. Dev tools stay in the dev group and never enter the wheel.

10.2 **Understand dependency behaviour.** PDF text engines, wasm runtimes and dataframe libraries are not interchangeable. Record the assumptions that matter (for example, behaviour differences found in tests).

10.3 **Isolate external boundaries:** the PDF engine, the Pyodide bridge, browser storage.

10.4 **No dependency changes during refactoring** without a separate justification.

## 11. Simplicity, maintainability and change discipline

11.1 Readability before cleverness.

11.2 **Preserve behaviour during cleanup (amended).** A deliberate behaviour change is a separate, explicitly approved change: its own failing test, its own change, and an entry in `docs/decisions/behaviour-changes.md`. The known planned ones are D-01 (silent zeros without pyarrow), D-02 and D-07.

11.3 Make minimal, justified refactors. 11.4 One focused change at a time: establish the problem, inspect, define the test, change, verify. 11.5 Work from evidence; do not declare code defective without the execution path and observable behaviour. 11.6 First make it work, then clean it up. 11.7 Do not turn Clean Code into ceremony.

## 12. Privacy and data handling (new)

12.1 The repository contains no real statements, names, phone numbers or amounts. Test data is generated from a seed and checked by fixture provenance.
12.2 No statement value appears in an error message, log line, console output or network request (5.6, 5.7).
12.3 `mpesa_core` has no I/O, environment or network access. Only `bridge.py` talks to the outside.
12.4 Nothing leaves the device. The deployed policy allows only same-origin requests, verified by CSP and the no-leak test.
12.5 Equivalence checks against real statements run only on the owner's machine, take paths as arguments, and print counts and pass/fail.

## 13. Code review checklist

**1. Naming**
- [ ] Names reveal intention and domain meaning.
- [ ] Names are explicit without unnecessary verbosity.
- [ ] No misleading names, cryptic abbreviations or ambiguous generic names.
- [ ] Domain vocabulary matches `docs/glossary.md`.

**2. Functions**
- [ ] Every function has one cohesive responsibility.
- [ ] Functions operate at one abstraction level.
- [ ] Functions are small enough to understand.
- [ ] Arguments are minimal and meaningful.
- [ ] No hidden or surprising side effects.
- [ ] Commands and queries are separated where appropriate.
- [ ] Control flow is straightforward, with minimal nesting.
- [ ] High-level workflow reads top to bottom.

**3. Documentation and comments**
- [ ] Every implementation function has a meaningful docstring.
- [ ] Docstrings describe purpose, inputs, returns, side effects and relevant exceptions.
- [ ] Comments explain why, not what.
- [ ] Comments are accurate and necessary.
- [ ] Code communicates intent without relying on comments.

**4. Error handling**
- [ ] Failures are not silently swallowed.
- [ ] Exceptions are caught at the appropriate boundary.
- [ ] Original causes are preserved when exceptions are wrapped.
- [ ] Error messages are meaningful.
- [ ] Invalid states and violated invariants are handled explicitly.
- [ ] Sensitive details are not exposed at the bridge or UI boundary.

**5. Formatting and structure**
- [ ] Formatting and imports are consistent.
- [ ] Whitespace improves readability.
- [ ] Lines and expressions are reasonably readable.
- [ ] Related functions and code are grouped logically.
- [ ] High-level functions appear before lower-level helpers where appropriate.

**6. Architecture and abstraction**
- [ ] Classes and modules have cohesive responsibilities.
- [ ] Existing module boundaries are respected unless a recorded change is justified.
- [ ] No premature abstractions or unnecessary indirection.
- [ ] Genuine duplication is addressed without merging distinct business rules.
- [ ] External dependencies and side effects have clear boundaries.

**7. Tests and verification**
- [ ] Tests describe observable behaviour.
- [ ] Happy paths, failures and edge cases are covered.
- [ ] Tests protect existing contracts.
- [ ] New behaviour has a failing test contract before implementation.
- [ ] Fixtures are realistic synthetic data.
- [ ] Focused tests and broader relevant checks pass.

**8. Change discipline**
- [ ] The problem is supported by evidence.
- [ ] The change is minimal and justified.
- [ ] Unrelated refactoring is excluded.
- [ ] Existing behaviour is preserved unless a change is explicitly approved and logged.
- [ ] The change can be reviewed and verified independently.

**9. Privacy (new)**
- [ ] No real data in code, tests, fixtures, comments or docs.
- [ ] No statement values in errors, logs or console output.
- [ ] No new network access or runtime dependency without an ADR.
- [ ] Core code has no I/O, environment or network access.
- [ ] Guards pass in CI, not only locally.

## 14. The principles that matter most

1. Readability is paramount.
2. Names communicate intention.
3. Every function has one responsibility.
4. Every implementation function has a meaningful docstring.
5. Functions read top to bottom.
6. Comments explain why, not what.
7. Handle errors explicitly; never hide failures or violate domain invariants.
8. Tests define and protect behaviour.
9. Refactor minimally and deliberately; preserve behaviour.
10. Simplicity beats cleverness.
11. Statement data never leaves the device and never enters the repository. (new)

## 15. Referenced documents (new)

| Document | Path | Purpose |
|---|---|---|
| Glossary | `docs/glossary.md` | One word per domain concept (1.3) |
| Decision index and ADR template | `docs/decisions/README.md` | How decisions are recorded |
| ADR 0004 | `docs/decisions/0004-error-messages-carry-no-statement-values.md` | Error messages carry no statement values (5.6) |
| ADR 0005 | `docs/decisions/0005-module-moves-from-mpesa-parser.md` | Reasons for module moves (7.2) |
| ADR 0006 | `docs/decisions/0006-runtime-dependencies.md` | Runtime dependencies and the size budget (10.1) |
| Behaviour changes log | `docs/decisions/behaviour-changes.md` | Deliberate behaviour changes (11.2) |
| Test edits log | `docs/decisions/test-edits.md` | Edits to existing tests (9.7) |
| PR template | `.github/pull_request_template.md` | The review checklist (13) |
| Guard configuration | `tools/guards/guards.toml` | Banned names and declared fake ranges (0, 1.2, 1.3) |
| Guard scripts | `tools/guards/check_*.py` | Mechanical checks listed in section 0 |

---

We are not following every Clean Code recommendation mechanically. We are producing code that another competent developer can read, reason about, test, maintain and safely change.
