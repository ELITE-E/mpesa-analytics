## What and why

<!-- One paragraph. Link the checkpoint (CP0 to CP10) or the log entry (behaviour-changes.md). -->

## Evidence (red first)

- [ ] The failing test was written first. Paste the failing output, or name the commit that contains the test before the implementation:

## Behaviour

- [ ] No behaviour change, or the change has an entry in `docs/decisions/behaviour-changes.md`: ID ____
- [ ] No existing test was edited, or the edit is recorded in `docs/decisions/test-edits.md`

## Privacy

- [ ] No real data in code, tests, fixtures, comments or docs
- [ ] No statement values in errors, logs or console output
- [ ] No new network access or runtime dependency without an ADR
- [ ] Core code has no I/O, environment or network access
- [ ] Guards pass in CI, not only locally

## Review checklist

**1. Naming**
- [ ] Names reveal intention and domain meaning
- [ ] Names are explicit without unnecessary verbosity
- [ ] No misleading names, cryptic abbreviations or ambiguous generic names
- [ ] Domain vocabulary matches `docs/glossary.md`

**2. Functions**
- [ ] Every function has one cohesive responsibility
- [ ] Functions operate at one abstraction level
- [ ] Functions are small enough to understand
- [ ] Arguments are minimal and meaningful
- [ ] No hidden or surprising side effects
- [ ] Commands and queries are separated where appropriate
- [ ] Control flow is straightforward, with minimal nesting
- [ ] High-level workflow reads top to bottom

**3. Documentation and comments**
- [ ] Every implementation function has a meaningful docstring
- [ ] Docstrings describe purpose, inputs, returns, side effects and relevant exceptions
- [ ] Comments explain why, not what
- [ ] Comments are accurate and necessary
- [ ] Code communicates intent without relying on comments

**4. Error handling**
- [ ] Failures are not silently swallowed
- [ ] Exceptions are caught at the appropriate boundary
- [ ] Original causes are preserved when exceptions are wrapped
- [ ] Error messages are meaningful and carry no statement values
- [ ] Invalid states and violated invariants are handled explicitly
- [ ] Sensitive details are not exposed at the bridge or UI boundary

**5. Formatting and structure**
- [ ] Formatting and imports are consistent
- [ ] Whitespace improves readability
- [ ] Lines and expressions are reasonably readable
- [ ] Related functions and code are grouped logically
- [ ] High-level functions appear before lower-level helpers where appropriate

**6. Architecture and abstraction**
- [ ] Classes and modules have cohesive responsibilities
- [ ] Existing module boundaries are respected unless a recorded change is justified (ADR 0005)
- [ ] No premature abstractions or unnecessary indirection
- [ ] Genuine duplication is addressed without merging distinct business rules
- [ ] External dependencies and side effects have clear boundaries

**7. Tests and verification**
- [ ] Tests describe observable behaviour
- [ ] Happy paths, failures and edge cases are covered
- [ ] Tests protect existing contracts
- [ ] New behaviour has a failing test contract before implementation
- [ ] Fixtures are realistic synthetic data
- [ ] Focused tests and broader relevant checks pass

**8. Change discipline**
- [ ] The problem is supported by evidence
- [ ] The change is minimal and justified
- [ ] Unrelated refactoring is excluded
- [ ] Existing behaviour is preserved unless a change is explicitly approved and logged
- [ ] The change can be reviewed and verified independently
